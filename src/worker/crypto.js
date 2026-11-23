// Native Web Crypto API utilities (Cloudflare Workers + Node 22+ compatible)

const encoder = new TextEncoder();
export const PBKDF2_ITERATIONS = 100000;

export function bytesToHex(bytes) {
  let hex = '';
  for (let i = 0; i < bytes.length; i += 1) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function generateRandomHex(byteLength = 32) {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
}

export function constantTimeEqual(hexA, hexB) {
  if (typeof hexA !== 'string' || typeof hexB !== 'string') return false;
  const a = encoder.encode(hexA);
  const b = encoder.encode(hexB);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function hashPassword(password, saltHex = null) {
  const saltBytes = saltHex
    ? hexToBytes(saltHex)
    : (() => {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        return arr;
      })();

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    256
  );

  return {
    salt: bytesToHex(saltBytes),
    hash: bytesToHex(new Uint8Array(derivedBits))
  };
}

export async function verifyPassword(password, saltHex, expectedHashHex) {
  if (!password || !saltHex || !expectedHashHex) return false;
  try {
    const { hash } = await hashPassword(password, saltHex);
    return constantTimeEqual(hash, expectedHashHex);
  } catch {
    return false;
  }
}

export async function hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(String(message)));
  return bytesToHex(new Uint8Array(sig));
}
