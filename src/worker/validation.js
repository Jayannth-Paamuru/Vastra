import {
  EXPENSE_CATEGORIES,
  INSTALLMENT_PAYMENT_MODES,
  INVENTORY_STATUSES,
  PAYMENT_MODES,
  todayISO
} from '../shared/constants.js';

export const MAX_PHOTO_BYTES = 150 * 1024; // 150 KB strict cap
export const MAX_PHOTOS_PER_ITEM = 3;
const DATA_URL_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/;

export class ValidationError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

export function cleanString(value, maxLen = 200) {
  if (value === null || value === undefined) return '';
  return String(value).trim().slice(0, maxLen);
}

export function normalizeEmail(raw) {
  const email = cleanString(raw, 254).toLowerCase();
  if (!email) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    throw new ValidationError('Please enter a valid email address.');
  }
  return email;
}

export function normalizePhone(raw, countryCode = '+91') {
  const input = cleanString(raw, 30);
  if (!input) return null;

  let digits = input.replace(/[^\d+]/g, '');
  if (!digits.startsWith('+')) {
    const cc = cleanString(countryCode || '+91', 6).replace(/[^\d+]/g, '');
    const prefix = cc.startsWith('+') ? cc : `+${cc || '91'}`;
    digits = digits.replace(/^0+/, '');
    digits = `${prefix}${digits}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(digits)) {
    throw new ValidationError(
      'Please enter a valid mobile number with country code (e.g., +919876543210).'
    );
  }
  return digits;
}

export function parseNonNegativeNumber(value, fieldLabel) {
  if (value === '' || value === null || value === undefined) {
    throw new ValidationError(`${fieldLabel} is required.`);
  }
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw new ValidationError(`${fieldLabel} must be a valid non-negative number.`);
  }
  return Number(num.toFixed(2));
}

export function parsePositiveNumber(value, fieldLabel) {
  const num = parseNonNegativeNumber(value, fieldLabel);
  if (num <= 0) {
    throw new ValidationError(`${fieldLabel} must be greater than zero.`);
  }
  return num;
}

export function parseNonNegativeInt(value, fieldLabel, min = 0) {
  if (value === '' || value === null || value === undefined) {
    throw new ValidationError(`${fieldLabel} is required.`);
  }
  const num = Number(value);
  if (!Number.isInteger(num) || num < min) {
    throw new ValidationError(`${fieldLabel} must be a whole number of at least ${min}.`);
  }
  return num;
}

export function parseIsoDate(value, fallback = todayISO()) {
  const str = cleanString(value, 20);
  if (!str) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw new ValidationError('Date must be in YYYY-MM-DD format.');
  }
  return str;
}

export function validatePhotoDataUrl(dataUrl, label = 'Photo') {
  if (!dataUrl) return null;
  if (typeof dataUrl !== 'string') {
    throw new ValidationError(`${label} must be a valid base64 image data URL.`);
  }
  const match = dataUrl.trim().match(DATA_URL_RE);
  if (!match) {
    throw new ValidationError(`${label} must be a JPEG, PNG, or WebP image.`);
  }
  const b64 = match[2].replace(/\s+/g, '');
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const decodedBytes = Math.floor((b64.length * 3) / 4) - padding;
  if (decodedBytes <= 0 || decodedBytes > MAX_PHOTO_BYTES) {
    throw new ValidationError(`${label} exceeds the 150 KB compressed limit.`);
  }
  return `data:${match[1]};base64,${b64}`;
}

export function validateInventoryPayload(body, { isUpdate = false } = {}) {
  const item_name = cleanString(body.item_name, 160);
  const sku = cleanString(body.sku, 64);
  if (!sku) {
    throw new ValidationError('SKU is required.');
  }

  const type = cleanString(body.type, 64);
  if (!type) {
    throw new ValidationError('Clothing type is required.');
  }

  const sub_type = cleanString(body.sub_type, 80);
  const color = cleanString(body.color, 64);
  const pattern = cleanString(body.pattern, 64);
  const fabric = cleanString(body.fabric, 64);
  const series_code = cleanString(body.series_code, 64);

  const resolvedName =
    item_name ||
    [color, sub_type || type, sku].filter(Boolean).join(' ').trim() ||
    sku;

  const quantity = parseNonNegativeInt(body.quantity ?? 1, 'Quantity', 0);
  const purchase_cost = parseNonNegativeNumber(body.purchase_cost, 'Purchase cost');
  const selling_price = parseNonNegativeNumber(body.selling_price, 'Selling price');
  const purchase_date = parseIsoDate(body.purchase_date, todayISO());
  const selling_date = body.selling_date ? parseIsoDate(body.selling_date, null) : null;

  let status = cleanString(body.status || 'In Stock', 24);
  if (!INVENTORY_STATUSES.includes(status)) {
    throw new ValidationError(`Status must be one of: ${INVENTORY_STATUSES.join(', ')}.`);
  }
  if (quantity === 0 && status === 'In Stock') {
    status = 'Sold';
  }

  let photos = undefined;
  if (Array.isArray(body.photos)) {
    if (body.photos.length > MAX_PHOTOS_PER_ITEM) {
      throw new ValidationError(`You can upload at most ${MAX_PHOTOS_PER_ITEM} photos per item.`);
    }
    photos = body.photos
      .map((p, idx) => validatePhotoDataUrl(p, `Photo ${idx + 1}`))
      .filter(Boolean);
  }

  let thumbnail_data_url = undefined;
  if (body.thumbnail_data_url !== undefined) {
    thumbnail_data_url = body.thumbnail_data_url
      ? validatePhotoDataUrl(body.thumbnail_data_url, 'Thumbnail')
      : null;
  } else if (!isUpdate && photos && photos.length > 0) {
    thumbnail_data_url = photos[0];
  }

  return {
    sku,
    series_code,
    item_name: resolvedName,
    type,
    sub_type,
    color,
    pattern,
    fabric,
    size: cleanString(body.size || 'Free Size', 32),
    supplier_name: cleanString(body.supplier_name, 120),
    quantity,
    purchase_cost,
    selling_price,
    purchase_date,
    selling_date,
    status,
    thumbnail_data_url,
    photos,
    notes: cleanString(body.notes, 1000)
  };
}

export function validateSalePayload(body, item) {
  const quantity_sold = parseNonNegativeInt(body.quantity_sold ?? 1, 'Quantity sold', 1);
  if (quantity_sold > item.quantity) {
    throw new ValidationError(`Only ${item.quantity} unit(s) available in stock.`);
  }
  const selling_price = parseNonNegativeNumber(
    body.selling_price !== undefined && body.selling_price !== ''
      ? body.selling_price
      : item.selling_price,
    'Selling price'
  );
  const sale_date = parseIsoDate(body.sale_date, todayISO());
  const payment_mode = cleanString(body.payment_mode || 'UPI', 32);
  if (!PAYMENT_MODES.includes(payment_mode)) {
    throw new ValidationError(`Payment mode must be one of: ${PAYMENT_MODES.join(', ')}.`);
  }

  const totalOrderAmount = Number((selling_price * quantity_sold).toFixed(2));
  let amount_paid;
  if (payment_mode === 'EMI') {
    const rawPaid =
      body.amount_paid !== undefined && body.amount_paid !== '' ? body.amount_paid : 0;
    amount_paid = parseNonNegativeNumber(rawPaid, 'Initial payment (advance)');
    if (amount_paid > totalOrderAmount) {
      throw new ValidationError('Initial payment cannot exceed total sale amount.');
    }
  } else {
    amount_paid = totalOrderAmount;
  }

  const balance_due = Number(Math.max(0, totalOrderAmount - amount_paid).toFixed(2));
  const payment_status =
    balance_due <= 0 ? 'Paid' : amount_paid > 0 ? 'Partial' : 'Pending';
  const next_due_date =
    balance_due > 0 && body.next_due_date ? parseIsoDate(body.next_due_date, null) : null;

  return {
    quantity_sold,
    selling_price,
    sale_date,
    customer_name: cleanString(body.customer_name, 120),
    customer_phone: cleanString(body.customer_phone, 30),
    payment_mode,
    amount_paid,
    balance_due,
    payment_status,
    next_due_date,
    notes: cleanString(body.notes, 500)
  };
}

export function validateInstallmentPayload(body, currentBalanceDue) {
  const amount = parsePositiveNumber(body.amount, 'Installment amount');
  if (amount > currentBalanceDue + 0.01) {
    throw new ValidationError(
      `Installment amount exceeds remaining balance due (${currentBalanceDue}).`
    );
  }
  const clampedAmount = Number(Math.min(amount, currentBalanceDue).toFixed(2));
  const payment_date = parseIsoDate(body.payment_date, todayISO());
  const modeRaw = cleanString(body.payment_mode || 'UPI', 32);
  const payment_mode = INSTALLMENT_PAYMENT_MODES.includes(modeRaw) ? modeRaw : 'UPI';
  const next_due_date = body.next_due_date ? parseIsoDate(body.next_due_date, null) : null;
  const notes = cleanString(body.notes, 300);

  return {
    amount: clampedAmount,
    payment_date,
    payment_mode,
    next_due_date,
    notes
  };
}

export function validateReturnPayload(body, sale) {
  const totalSold = Number(sale.quantity_sold) || 1;
  const alreadyReturned = Number(sale.returned_qty) || 0;
  const maxReturnable = Math.max(0, totalSold - alreadyReturned);

  if (maxReturnable <= 0) {
    throw new ValidationError('All units from this sale have already been returned.');
  }

  const return_qty = parseNonNegativeInt(body.return_qty ?? 1, 'Return quantity', 1);
  if (return_qty > maxReturnable) {
    throw new ValidationError(`Only ${maxReturnable} unit(s) eligible for return on this sale.`);
  }

  const maxRefund = Number((Number(sale.selling_price) * return_qty).toFixed(2));
  const refund_amount =
    body.refund_amount !== undefined && body.refund_amount !== ''
      ? parseNonNegativeNumber(body.refund_amount, 'Refund amount')
      : maxRefund;

  if (refund_amount > maxRefund + 0.01) {
    throw new ValidationError(`Refund amount cannot exceed ${maxRefund}.`);
  }

  const return_date = parseIsoDate(body.return_date, todayISO());
  const modeRaw = cleanString(body.payment_mode || sale.payment_mode || 'UPI', 32);
  const payment_mode = INSTALLMENT_PAYMENT_MODES.includes(modeRaw) ? modeRaw : 'Cash';
  const reason = cleanString(body.reason, 300);
  const log_expense = body.log_expense !== false && refund_amount > 0;

  return {
    return_qty,
    refund_amount: Number(Math.min(refund_amount, maxRefund).toFixed(2)),
    return_date,
    payment_mode,
    reason,
    log_expense
  };
}

export function validateExpensePayload(body) {
  const title = cleanString(body.title, 160);
  const category = cleanString(body.category || 'Miscellaneous', 80);
  if (!EXPENSE_CATEGORIES.includes(category) && !category) {
    throw new ValidationError('Please select a valid expense category.');
  }
  const resolvedTitle = title || category;
  const amount = parsePositiveNumber(body.amount, 'Expense amount');
  const expense_date = parseIsoDate(body.expense_date, todayISO());
  const modeRaw = cleanString(body.payment_mode || 'UPI', 32);
  const payment_mode = INSTALLMENT_PAYMENT_MODES.includes(modeRaw) ? modeRaw : 'UPI';
  const vendor_name = cleanString(body.vendor_name, 120);
  const related_sku = cleanString(body.related_sku, 64);
  const notes = cleanString(body.notes, 600);

  return {
    expense_date,
    category: category || 'Miscellaneous',
    title: resolvedTitle,
    amount,
    payment_mode,
    vendor_name,
    related_sku,
    notes
  };
}
