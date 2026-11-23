export const PRIMARY_CLOTHING_CATEGORIES = ['Sarees', 'Dresses', 'Others'];

export const CLOTHING_TYPES = [
  'Sarees',
  'Dresses',
  'Kurti',
  'Lehenga',
  'Dress Material',
  'Blouse',
  'Dupatta',
  'Gown',
  'Co-ord Set',
  'Others'
];

export const SUB_TYPE_PRESETS_BY_CATEGORY = {
  Sarees: [
    'Kanjeevaram',
    'Banarasi',
    'Pochampally Ikat',
    'Gadwal',
    'Uppada',
    'Dharmavaram',
    'Narayanpet',
    'Mangalagiri',
    'Mysore Silk',
    'Tussar Silk',
    'Chanderi',
    'Maheshwari',
    'Paithani',
    'Organza',
    'Georgette',
    'Cotton Handloom',
    'Linen'
  ],
  Dresses: [
    'Anarkali',
    'Straight Kurti',
    'A-Line Kurti',
    'Lehenga Set',
    'Sharara Set',
    'Gharara Set',
    'Salwar Suit',
    'Indo-Western Gown',
    'Co-ord Set',
    'Unstitched Suit'
  ],
  Others: [
    'Readymade Blouse',
    'Blouse Piece',
    'Dupatta / Stole',
    'Petticoat / Inskirt',
    'Kids Ethnic',
    'Accessories'
  ]
};

export const SUB_TYPE_PRESETS = [
  ...new Set([
    ...SUB_TYPE_PRESETS_BY_CATEGORY.Sarees,
    ...SUB_TYPE_PRESETS_BY_CATEGORY.Dresses,
    ...SUB_TYPE_PRESETS_BY_CATEGORY.Others
  ])
];

export const PATTERN_PRESETS = [
  'Zari Border',
  'Temple Border',
  'Kaddi Border',
  'Floral',
  'Paisley / Butta',
  'Checks / Stripes',
  'Bandhani',
  'Kalamkari',
  'Block Print',
  'Embroidered',
  'Mirror Work',
  'Sequins',
  'Plain / Solid'
];

export const DRESS_ALPHA_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', 'Free Size'];
export const DRESS_NUMERIC_SIZES = ['30', '32', '34', '36', '38', '40', '42', '44', '46', '48', '50', 'Free Size'];
export const SIZE_OPTIONS = [...new Set([...DRESS_ALPHA_SIZES, ...DRESS_NUMERIC_SIZES])];

export const INVENTORY_STATUSES = ['In Stock', 'Reserved', 'Sold'];
export const PAYMENT_MODES = ['UPI', 'Cash', 'Card', 'Bank Transfer', 'EMI'];
export const INSTALLMENT_PAYMENT_MODES = ['UPI', 'Cash', 'Card', 'Bank Transfer'];

export const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 Days' },
  { value: 'this-month', label: 'This Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'this-year', label: 'This Year' },
  { value: 'all-time', label: 'All Time' }
];

export const VALID_PERIODS = new Set(PERIOD_OPTIONS.map((p) => p.value));

export const COUNTRY_CODES = [
  { code: '+91', label: 'India (+91)' },
  { code: '+1', label: 'USA / Canada (+1)' },
  { code: '+44', label: 'UK (+44)' },
  { code: '+971', label: 'UAE (+971)' },
  { code: '+65', label: 'Singapore (+65)' },
  { code: '+61', label: 'Australia (+61)' },
  { code: '+60', label: 'Malaysia (+60)' }
];

export const SPA_EXACT_ROUTES = new Set([
  '/',
  '/login',
  '/signup',
  '/inventory',
  '/inventory/new',
  '/sales',
  '/analytics',
  '/settings'
]);

export function isValidSpaRoute(pathname) {
  if (SPA_EXACT_ROUTES.has(pathname)) return true;
  if (/^\/inventory\/[^/]+\/edit$/.test(pathname)) return true;
  return false;
}

export function todayISO(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function shiftDaysISO(daysDelta, baseDate = new Date()) {
  const d = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate() + daysDelta);
  return todayISO(d);
}

export function getDateRangeForPeriod(period, now = new Date()) {
  const end = todayISO(now);
  switch (period) {
    case 'today':
      return { start: end, end };
    case '7d':
      return { start: shiftDaysISO(-6, now), end };
    case 'this-month': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: todayISO(first), end };
    }
    case 'last-month': {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: todayISO(first), end: todayISO(last) };
    }
    case 'this-year': {
      const first = new Date(now.getFullYear(), 0, 1);
      return { start: todayISO(first), end };
    }
    case 'all-time':
    default:
      return { start: null, end: null };
  }
}

export function daysBetween(startIso, endIso = todayISO()) {
  if (!startIso) return 0;
  const a = new Date(`${startIso}T00:00:00Z`);
  const b = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

export function formatINR(amount, symbol = '₹') {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2
  });
  return `${symbol}${formatted}`;
}

export function calculateMarginPercent(cost, price) {
  const c = Number(cost) || 0;
  const p = Number(price) || 0;
  if (p <= 0) return 0;
  return Number((((p - c) / p) * 100).toFixed(1));
}

export function generateSeriesSkus(baseSku, pieceCount) {
  const clean = String(baseSku || '').trim();
  const count = Math.max(1, Math.min(50, Number(pieceCount) || 1));
  if (!clean) return [];
  if (count === 1) return [clean];
  return Array.from({ length: count }, (_, idx) => `${clean}-${idx + 1}`);
}
