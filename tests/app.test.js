import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import worker from '../src/worker/index.js';
import { createMockAssets, createTestD1 } from './d1-shim.js';
import {
  generateFullReportXlsx,
  generateInventoryCsv,
  sanitizeSpreadsheetText
} from '../src/shared/export.js';
import {
  clearUserOfflineData,
  getPendingSyncCount,
  replaySyncQueue,
  saveInventoryItemOfflineAware,
  sellItemOfflineAware
} from '../src/offline/sync.js';

const TEST_SECRET = 'test-session-secret-key-at-least-32-chars-long';
const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

let db;
let env;

beforeEach(() => {
  db = createTestD1();
  env = {
    DB: db,
    SESSION_SECRET: TEST_SECRET,
    ASSETS: createMockAssets()
  };
});

afterEach(() => {
  db?.close();
});

async function callWorker(path, { method = 'GET', body, cookie, ip = '198.51.100.10' } = {}) {
  const headers = new Headers({
    Accept: 'application/json',
    'CF-Connecting-IP': ip
  });
  if (cookie) headers.set('Cookie', cookie);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const req = new Request(`https://vastraledger.test${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });

  const res = await worker.fetch(req, env);
  const setCookie = res.headers.get('Set-Cookie') || '';
  const cookiePair = setCookie ? setCookie.split(';')[0] : '';
  const contentType = res.headers.get('Content-Type') || '';
  const data = contentType.includes('application/json') ? await res.json() : null;

  return { res, data, setCookie, cookiePair };
}

async function signupUser({ full_name, email, phone, password = 'StrongPassword1!' }) {
  const out = await callWorker('/api/auth/signup', {
    method: 'POST',
    body: { full_name, email, phone, password }
  });
  expect(out.res.status).toBe(201);
  return { user: out.data.user, cookie: out.cookiePair, setCookie: out.setCookie };
}

describe('VastraLedger — Auth, Security & Rate Limiting', () => {
  it('sets HttpOnly, Secure, SameSite=Lax cookie on signup and rejects duplicate email/phone', async () => {
    const a = await signupUser({ full_name: 'Ananya', email: 'ananya@boutique.in' });
    expect(a.setCookie).toContain('HttpOnly');
    expect(a.setCookie).toContain('Secure');
    expect(a.setCookie).toContain('SameSite=Lax');

    const dupEmail = await callWorker('/api/auth/signup', {
      method: 'POST',
      body: { full_name: 'Clone', email: 'ANANYA@boutique.in', password: 'StrongPassword1!' }
    });
    expect(dupEmail.res.status).toBe(409);

    const p1 = await signupUser({ full_name: 'Priya', phone: '9876543210' });
    expect(p1.user.phone).toBe('+919876543210');

    const dupPhone = await callWorker('/api/auth/signup', {
      method: 'POST',
      body: { full_name: 'Priya 2', phone: '+919876543210', password: 'StrongPassword1!' }
    });
    expect(dupPhone.res.status).toBe(409);
  });

  it('supports password change and rate-limits repeated failed logins', async () => {
    const { cookie } = await signupUser({ full_name: 'Meera', email: 'meera@boutique.in' });

    const changeRes = await callWorker('/api/auth/change-password', {
      method: 'POST',
      cookie,
      body: { current_password: 'StrongPassword1!', new_password: 'NewPassword2@' }
    });
    expect(changeRes.res.status).toBe(200);

    // 8 failed attempts trigger 429 on the 9th
    for (let i = 0; i < 8; i += 1) {
      const fail = await callWorker('/api/auth/login', {
        method: 'POST',
        ip: '203.0.113.55',
        body: { mode: 'email', email: 'meera@boutique.in', password: 'WrongPassword!' }
      });
      expect(fail.res.status).toBe(401);
    }

    const blocked = await callWorker('/api/auth/login', {
      method: 'POST',
      ip: '203.0.113.55',
      body: { mode: 'email', email: 'meera@boutique.in', password: 'NewPassword2@' }
    });
    expect(blocked.res.status).toBe(429);
  });
});

describe('VastraLedger — Multi-User Isolation', () => {
  it('prevents User B from viewing, editing, selling, or deleting User A inventory', async () => {
    const userA = await signupUser({ full_name: 'User A', email: 'a@boutique.in' });
    const userB = await signupUser({ full_name: 'User B', email: 'b@boutique.in' });

    const created = await callWorker('/api/inventory', {
      method: 'POST',
      cookie: userA.cookie,
      body: {
        sku: 'SAR-2026-001',
        item_name: 'Crimson Kanjeevaram Saree',
        type: 'Saree',
        sub_type: 'Kanjeevaram',
        color: 'Crimson',
        quantity: 2,
        purchase_cost: 4500,
        selling_price: 7200
      }
    });
    expect(created.res.status).toBe(201);
    const itemId = created.data.item.id;

    // User B gets empty list
    const listB = await callWorker('/api/inventory', { cookie: userB.cookie });
    expect(listB.data.items).toHaveLength(0);

    // User B cannot GET, PUT, SELL, or DELETE User A's item
    const getB = await callWorker(`/api/inventory/${itemId}`, { cookie: userB.cookie });
    expect(getB.res.status).toBe(404);

    const putB = await callWorker(`/api/inventory/${itemId}`, {
      method: 'PUT',
      cookie: userB.cookie,
      body: {
        sku: 'SAR-2026-001',
        item_name: 'Hacked',
        type: 'Saree',
        quantity: 1,
        purchase_cost: 100,
        selling_price: 200
      }
    });
    expect(putB.res.status).toBe(404);

    const sellB = await callWorker(`/api/inventory/${itemId}/sell`, {
      method: 'POST',
      cookie: userB.cookie,
      body: { quantity_sold: 1, selling_price: 7200, payment_mode: 'UPI' }
    });
    expect(sellB.res.status).toBe(404);

    const delB = await callWorker(`/api/inventory/${itemId}`, {
      method: 'DELETE',
      cookie: userB.cookie
    });
    expect(delB.res.status).toBe(404);
  });
});

describe('VastraLedger — Inventory Validation, Search & Mark as Sold', () => {
  it('rejects negative prices, NaN, invalid photo MIME types, and >150 KB photos', async () => {
    const { cookie } = await signupUser({ full_name: 'Kavya', email: 'kavya@boutique.in' });

    const neg = await callWorker('/api/inventory', {
      method: 'POST',
      cookie,
      body: {
        sku: 'KUR-001',
        item_name: 'Cotton Kurti',
        type: 'Kurti',
        quantity: 1,
        purchase_cost: -100,
        selling_price: 900
      }
    });
    expect(neg.res.status).toBe(400);

    const nanPrice = await callWorker('/api/inventory', {
      method: 'POST',
      cookie,
      body: {
        sku: 'KUR-002',
        item_name: 'Cotton Kurti',
        type: 'Kurti',
        quantity: 1,
        purchase_cost: 500,
        selling_price: 'not-a-number'
      }
    });
    expect(nanPrice.res.status).toBe(400);

    const badMime = await callWorker('/api/inventory', {
      method: 'POST',
      cookie,
      body: {
        sku: 'KUR-003',
        item_name: 'SVG Test',
        type: 'Kurti',
        quantity: 1,
        purchase_cost: 500,
        selling_price: 900,
        photos: ['data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=']
      }
    });
    expect(badMime.res.status).toBe(400);

    // > 150 KB payload (~160 KB decoded)
    const oversized = `data:image/jpeg;base64,${'A'.repeat(220000)}`;
    const tooBig = await callWorker('/api/inventory', {
      method: 'POST',
      cookie,
      body: {
        sku: 'KUR-004',
        item_name: 'Oversized Photo',
        type: 'Kurti',
        quantity: 1,
        purchase_cost: 500,
        selling_price: 900,
        photos: [oversized]
      }
    });
    expect(tooBig.res.status).toBe(400);
  });

  it('decrements stock on Mark as Sold, calculates exact profit, and supports multi-filter search', async () => {
    const { cookie } = await signupUser({ full_name: 'Divya', email: 'divya@boutique.in' });

    const created = await callWorker('/api/inventory', {
      method: 'POST',
      cookie,
      body: {
        sku: 'SAR-2026-101',
        item_name: 'Banarasi Silk Zari Saree',
        type: 'Saree',
        sub_type: 'Banarasi',
        color: 'Royal Blue',
        pattern: 'Zari Border',
        quantity: 2,
        purchase_cost: 3000,
        selling_price: 4500,
        photos: [TINY_PNG_DATA_URL]
      }
    });
    expect(created.res.status).toBe(201);
    const id = created.data.item.id;

    // Multi-filter search
    const searchRes = await callWorker(
      '/api/inventory?type=Saree&sub_type=Banarasi&color=royal%20blue&min_price=4000',
      { cookie }
    );
    expect(searchRes.data.items).toHaveLength(1);

    // Sell 1 of 2 -> quantity becomes 1, stays In Stock
    const sale1 = await callWorker(`/api/inventory/${id}/sell`, {
      method: 'POST',
      cookie,
      body: { quantity_sold: 1, selling_price: 4500, payment_mode: 'UPI', customer_name: 'Lakshmi' }
    });
    expect(sale1.res.status).toBe(201);
    expect(sale1.data.item.quantity).toBe(1);
    expect(sale1.data.item.status).toBe('In Stock');
    expect(sale1.data.sale.profit).toBe(1500);

    // Sell remaining 1 -> quantity becomes 0, status becomes Sold
    const sale2 = await callWorker(`/api/inventory/${id}/sell`, {
      method: 'POST',
      cookie,
      body: { quantity_sold: 1, selling_price: 4800, payment_mode: 'Cash' }
    });
    expect(sale2.res.status).toBe(201);
    expect(sale2.data.item.quantity).toBe(0);
    expect(sale2.data.item.status).toBe('Sold');
    expect(sale2.data.sale.profit).toBe(1800);

    // Dashboard reflects exact KPIs
    const dash = await callWorker('/api/dashboard?period=all-time', { cookie });
    expect(dash.data.kpis.totalRevenue).toBe(9300);
    expect(dash.data.kpis.totalProfit).toBe(3300);
  });
});

describe('VastraLedger — CSV & Excel (.xlsx) Exports', () => {
  it('prepends UTF-8 BOM, sanitizes formula injection, and generates a valid multi-sheet .xlsx ZIP', () => {
    expect(sanitizeSpreadsheetText('=SUM(A1:A5)')).toBe("'=SUM(A1:A5)");

    const items = [
      {
        sku: 'SAR-001',
        item_name: '=CMD|Test',
        type: 'Saree',
        sub_type: 'Silk',
        color: 'Gold',
        pattern: 'Zari Border',
        fabric: 'Silk',
        size: 'Free Size',
        supplier_name: 'Looms',
        quantity: 2,
        purchase_cost: 2000,
        selling_price: 3500,
        purchase_date: '2026-10-01',
        status: 'In Stock',
        notes: ''
      }
    ];
    const sales = [
      {
        sale_date: '2026-11-01',
        sku: 'SAR-001',
        item_name: 'Silk Saree',
        type: 'Saree',
        sub_type: 'Silk',
        color: 'Gold',
        quantity_sold: 1,
        purchase_cost: 2000,
        selling_price: 3500,
        profit: 1500,
        customer_name: 'Sita',
        customer_phone: '',
        payment_mode: 'UPI',
        notes: ''
      }
    ];

    const csv = generateInventoryCsv(items);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain("'=CMD|Test");

    const xlsxBytes = generateFullReportXlsx(items, sales);
    expect(xlsxBytes).toBeInstanceOf(Uint8Array);
    // Valid ZIP local file header magic bytes: PK\x03\x04
    expect(xlsxBytes[0]).toBe(0x50);
    expect(xlsxBytes[1]).toBe(0x4b);
    expect(xlsxBytes[2]).toBe(0x03);
    expect(xlsxBytes[3]).toBe(0x04);

    const decodedText = new TextDecoder().decode(xlsxBytes);
    expect(decodedText).toContain('xl/worksheets/sheet1.xml');
    expect(decodedText).toContain('xl/worksheets/sheet2.xml');
    expect(decodedText).toContain('xl/worksheets/sheet3.xml');
    expect(decodedText).toContain('Monthly Summary');
  });
});

describe('VastraLedger — Cloudflare Worker SPA & 404 Routing', () => {
  it('serves HTML for valid SPA routes and real 404s for missing assets & unknown routes', async () => {
    const validSpa = await callWorker('/inventory');
    expect(validSpa.res.status).toBe(200);
    expect(validSpa.res.headers.get('Content-Type')).toContain('text/html');
    expect(validSpa.res.headers.get('Cache-Control')).toContain('no-store');

    const missingAsset = await callWorker('/assets/missing-chunk.js');
    expect(missingAsset.res.status).toBe(404);

    const unknownPage = await callWorker('/non-existent-route');
    expect(unknownPage.res.status).toBe(404);

    const unknownApi = await callWorker('/api/does-not-exist');
    expect(unknownApi.res.status).toBe(404);
    expect(unknownApi.data.success).toBe(false);

    const health = await callWorker('/api/health');
    expect(health.res.status).toBe(200);
    expect(health.data.database).toBe(true);
    expect(health.data.sessionSecret).toBe(true);
  });
});

describe('VastraLedger — Offline Sync Queue Replay', () => {
  it('queues offline create + sell mutations and replays them in order when back online', async () => {
    const userId = 'offline-test-user';
    await clearUserOfflineData(userId);

    const originalNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      value: { onLine: false },
      configurable: true
    });

    try {
      const created = await saveInventoryItemOfflineAware(userId, {
        sku: 'OFF-2026-001',
        item_name: 'Offline Organza Saree',
        type: 'Saree',
        quantity: 2,
        purchase_cost: 1200,
        selling_price: 2000
      });
      expect(created.queued).toBe(true);

      const sold = await sellItemOfflineAware(userId, created.item, {
        quantity_sold: 1,
        selling_price: 2000,
        payment_mode: 'UPI'
      });
      expect(sold.queued).toBe(true);
      expect(sold.item.quantity).toBe(1);
      expect(await getPendingSyncCount(userId)).toBe(2);

      // Replay against mock online fetcher
      const calls = [];
      const mockFetcher = async (url, opts) => {
        calls.push({ url, method: opts.method });
        if (url === '/api/inventory' && opts.method === 'POST') {
          return { item: { id: 'real-server-id-1' } };
        }
        return { success: true };
      };

      const replay = await replaySyncQueue(userId, mockFetcher);
      expect(replay.synced).toBe(2);
      expect(replay.failed).toBe(0);
      expect(await getPendingSyncCount(userId)).toBe(0);
      expect(calls[0]).toEqual({ url: '/api/inventory', method: 'POST' });
      expect(calls[1]).toEqual({ url: '/api/inventory/real-server-id-1/sell', method: 'POST' });
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true
      });
      await clearUserOfflineData(userId);
    }
  });
});
