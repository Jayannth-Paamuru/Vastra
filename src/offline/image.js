// Client-side garment image compression:
// Targets ~55 KB per full photo (max 720px) and ~18 KB per thumbnail (200px)
// so Cloudflare D1's 5 GB storage holds 80,000+ garment photos effortlessly.

const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const TARGET_FULL_BYTES = 60 * 1024; // ~60 KB target for ultra-efficient 5 GB D1 usage
const MAX_HARD_BYTES = 145 * 1024;   // Hard ceiling under 150 KB backend cap

function estimateDataUrlBytes(dataUrl) {
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return 0;
  const b64 = dataUrl.slice(commaIdx + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Unable to read image file. Please select a valid JPEG, PNG, or WebP photo.'));
    };
    img.src = url;
  });
}

function encodeResized(img, maxEdge, targetBytes, hardMaxBytes) {
  let currentEdge = maxEdge;

  for (let pass = 0; pass < 4; pass += 1) {
    const longest = Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height, 1);
    const scale = Math.min(1, currentEdge / longest);
    const width = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    let lastValid = null;
    for (let q = 0.78; q >= 0.34; q -= 0.08) {
      const quality = Number(q.toFixed(2));
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const size = estimateDataUrlBytes(dataUrl);
      if (size <= targetBytes) {
        return dataUrl;
      }
      if (size <= hardMaxBytes) {
        lastValid = dataUrl;
      }
    }

    if (lastValid) {
      return lastValid;
    }

    currentEdge = Math.round(currentEdge * 0.8);
  }

  throw new Error('Could not compress this image below 150 KB. Please choose a smaller photo.');
}

export async function compressImageFile(file) {
  if (!file) {
    throw new Error('No image file selected.');
  }

  const mime = (file.type || '').toLowerCase();
  const extOk = /\.(jpe?g|png|webp)$/i.test(file.name || '');
  if (mime && !ALLOWED_MIME_TYPES.has(mime) && !extOk) {
    throw new Error('Unsupported format. Please upload a JPEG, PNG, or WebP image.');
  }

  const img = await loadImageFromFile(file);
  const fullDataUrl = encodeResized(img, 720, TARGET_FULL_BYTES, MAX_HARD_BYTES);
  const thumbnailDataUrl = encodeResized(img, 200, 18 * 1024, 35 * 1024);

  return { fullDataUrl, thumbnailDataUrl };
}
