import {
  daysBetween,
  getDateRangeForPeriod,
  shiftDaysISO,
  todayISO
} from '../shared/constants.js';
import {
  computeMonthlySummary,
  generateFullReportXlsx,
  generateInventoryCsv,
  generateInventoryXlsx,
  generateSalesCsv,
  generateSalesXlsx
} from '../shared/export.js';
import {
  clearUserStore,
  enqueueMutation,
  getQueuedMutations,
  getSnapshot,
  removeQueuedMutation,
  setSnapshot
} from './db.js';

function isBrowserOnline() {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

function isNetworkFailure(err) {
  if (!isBrowserOnline()) return true;
  if (!err) return false;
  if (err.isHttpError) return false;
  return err.name === 'TypeError' || /network|failed to fetch|load failed/i.test(err.message || '');
}

export async function apiRequest(url, { method = 'GET', body = undefined } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json'
    }
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const err = new Error(data?.error || `Request failed (${response.status})`);
    err.status = response.status;
    err.isHttpError = true;
    throw err;
  }

  return data;
}

// --- Offline Fallback Computations from Cached Snapshots ---

function buildDashboardFromCache(inventory = [], allSales = [], period = 'all-time') {
  const { start, end } = getDateRangeForPeriod(period);
  const periodSales = allSales.filter((s) => {
    if (start && s.sale_date < start) return false;
    if (end && s.sale_date > end) return false;
    return true;
  });

  const inStockItems = inventory.filter((i) => i.status === 'In Stock' && Number(i.quantity) > 0);
  const totalStockQty = inStockItems.reduce((sum, i) => sum + Number(i.quantity), 0);
  const totalUniqueSkus = inStockItems.length;
  const totalInventoryValue = Number(
    inStockItems
      .reduce((sum, i) => sum + Number(i.quantity) * Number(i.purchase_cost), 0)
      .toFixed(2)
  );
  const totalRevenue = Number(
    periodSales
      .reduce((sum, s) => sum + Number(s.selling_price) * Number(s.quantity_sold), 0)
      .toFixed(2)
  );
  const totalCogs = Number(
    periodSales
      .reduce((sum, s) => sum + Number(s.purchase_cost) * Number(s.quantity_sold), 0)
      .toFixed(2)
  );
  const totalProfit = Number(
    periodSales.reduce((sum, s) => sum + Number(s.profit), 0).toFixed(2)
  );
  const profitMargin =
    totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(1)) : 0;

  const buildDailySeries = (days) => {
    const map = new Map();
    for (let i = days - 1; i >= 0; i -= 1) {
      const iso = shiftDaysISO(-i);
      map.set(iso, { date: iso, revenue: 0, profit: 0, units: 0 });
    }
    for (const s of allSales) {
      const entry = map.get(s.sale_date);
      if (entry) {
        entry.revenue = Number(
          (entry.revenue + Number(s.selling_price) * Number(s.quantity_sold)).toFixed(2)
        );
        entry.profit = Number((entry.profit + Number(s.profit)).toFixed(2));
        entry.units += Number(s.quantity_sold);
      }
    }
    return Array.from(map.values());
  };

  const stockByTypeMap = new Map();
  for (const item of inStockItems) {
    const val = Number(item.quantity) * Number(item.purchase_cost);
    const cur = stockByTypeMap.get(item.type) || { label: item.type, value: 0, units: 0 };
    cur.value = Number((cur.value + val).toFixed(2));
    cur.units += Number(item.quantity);
    stockByTypeMap.set(item.type, cur);
  }

  const payMap = new Map();
  for (const s of periodSales) {
    const rev = Number(s.selling_price) * Number(s.quantity_sold);
    const cur = payMap.get(s.payment_mode) || { label: s.payment_mode, value: 0, count: 0 };
    cur.value = Number((cur.value + rev).toFixed(2));
    cur.count += 1;
    payMap.set(s.payment_mode, cur);
  }

  const agingStock = inStockItems
    .map((i) => ({ ...i, age_days: daysBetween(i.purchase_date) }))
    .filter((i) => i.age_days > 60)
    .sort((a, b) => b.age_days - a.age_days)
    .slice(0, 10);

  return {
    success: true,
    period,
    kpis: {
      totalStockQty,
      totalUniqueSkus,
      totalInventoryValue,
      totalRevenue,
      totalCogs,
      totalProfit,
      profitMargin,
      salesCount: periodSales.length,
      unitsSold: periodSales.reduce((sum, s) => sum + Number(s.quantity_sold), 0)
    },
    charts: {
      revenueProfit7d: buildDailySeries(7),
      revenueProfit30d: buildDailySeries(30),
      stockByType: Array.from(stockByTypeMap.values()).sort((a, b) => b.value - a.value),
      salesByPaymentMode: Array.from(payMap.values()).sort((a, b) => b.value - a.value)
    },
    recentSales: allSales.slice(0, 5),
    agingStock
  };
}

function buildAnalyticsFromCache(inventory = [], sales = []) {
  const patternByItemId = new Map(inventory.map((i) => [i.id, i.pattern]));
  const trendMap = new Map();
  for (let i = 29; i >= 0; i -= 1) {
    const iso = shiftDaysISO(-i);
    trendMap.set(iso, { date: iso, revenue: 0, profit: 0 });
  }
  for (const s of sales) {
    const entry = trendMap.get(s.sale_date);
    if (entry) {
      entry.revenue = Number(
        (entry.revenue + Number(s.selling_price) * Number(s.quantity_sold)).toFixed(2)
      );
      entry.profit = Number((entry.profit + Number(s.profit)).toFixed(2));
    }
  }

  const catMap = new Map();
  const subTypeMap = new Map();
  const colorMap = new Map();
  const patternMap = new Map();

  const bump = (map, label, qty, rev, profit) => {
    const cur = map.get(label) || { label, units: 0, revenue: 0, profit: 0 };
    cur.units += qty;
    cur.revenue = Number((cur.revenue + rev).toFixed(2));
    cur.profit = Number((cur.profit + profit).toFixed(2));
    map.set(label, cur);
  };

  for (const s of sales) {
    const qty = Number(s.quantity_sold) || 1;
    const rev = Number(s.selling_price) * qty;
    const cogs = Number(s.purchase_cost) * qty;
    const profit = Number(s.profit);

    const cat = catMap.get(s.type) || { type: s.type, units: 0, revenue: 0, cogs: 0, profit: 0 };
    cat.units += qty;
    cat.revenue = Number((cat.revenue + rev).toFixed(2));
    cat.cogs = Number((cat.cogs + cogs).toFixed(2));
    cat.profit = Number((cat.profit + profit).toFixed(2));
    catMap.set(s.type, cat);

    if (s.sub_type) bump(subTypeMap, s.sub_type, qty, rev, profit);
    if (s.color) bump(colorMap, s.color, qty, rev, profit);
    const pat = s.item_id ? patternByItemId.get(s.item_id) : '';
    if (pat) bump(patternMap, pat, qty, rev, profit);
  }

  const sortTop = (map) =>
    Array.from(map.values())
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
      .slice(0, 6);

  return {
    success: true,
    trend30d: Array.from(trendMap.values()),
    categoryProfitability: Array.from(catMap.values())
      .map((c) => ({
        ...c,
        margin: c.revenue > 0 ? Number(((c.profit / c.revenue) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.profit - a.profit),
    topSubTypes: sortTop(subTypeMap),
    topColors: sortTop(colorMap),
    topPatterns: sortTop(patternMap),
    monthlySummary: computeMonthlySummary(sales)
  };
}

// --- Offline-Aware Readers ---

export async function fetchInventoryCached(userId) {
  if (isBrowserOnline()) {
    try {
      const res = await apiRequest('/api/inventory');
      const items = res.items || [];
      await setSnapshot(userId, 'inventory', items);
      return { items, offline: false };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }
  const cached = (await getSnapshot(userId, 'inventory')) || [];
  return { items: cached, offline: true };
}

export async function fetchInventoryItemCached(userId, itemId) {
  if (isBrowserOnline() && !String(itemId).startsWith('offline-')) {
    try {
      const res = await apiRequest(`/api/inventory/${encodeURIComponent(itemId)}`);
      if (res.item) {
        await setSnapshot(userId, `item:${itemId}`, res.item);
        return res.item;
      }
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }
  const detail = await getSnapshot(userId, `item:${itemId}`);
  if (detail) return detail;
  const list = (await getSnapshot(userId, 'inventory')) || [];
  return list.find((i) => i.id === itemId) || null;
}

export async function fetchSalesCached(userId) {
  if (isBrowserOnline()) {
    try {
      const res = await apiRequest('/api/sales');
      const sales = res.sales || [];
      await setSnapshot(userId, 'sales', sales);
      return { sales, offline: false };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }
  const cached = (await getSnapshot(userId, 'sales')) || [];
  return { sales: cached, offline: true };
}

export async function fetchDashboardCached(userId, period = 'all-time') {
  if (isBrowserOnline()) {
    try {
      const res = await apiRequest(`/api/dashboard?period=${encodeURIComponent(period)}`);
      await setSnapshot(userId, `dashboard:${period}`, res);
      return { data: res, offline: false };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }
  const [inv, sales, cachedDash] = await Promise.all([
    getSnapshot(userId, 'inventory'),
    getSnapshot(userId, 'sales'),
    getSnapshot(userId, `dashboard:${period}`)
  ]);
  if (inv || sales) {
    return { data: buildDashboardFromCache(inv || [], sales || [], period), offline: true };
  }
  return { data: cachedDash || buildDashboardFromCache([], [], period), offline: true };
}

export async function fetchAnalyticsCached(userId) {
  if (isBrowserOnline()) {
    try {
      const res = await apiRequest('/api/analytics');
      await setSnapshot(userId, 'analytics', res);
      return { data: res, offline: false };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }
  const [inv, sales, cachedAnalytics] = await Promise.all([
    getSnapshot(userId, 'inventory'),
    getSnapshot(userId, 'sales'),
    getSnapshot(userId, 'analytics')
  ]);
  if (inv || sales) {
    return { data: buildAnalyticsFromCache(inv || [], sales || []), offline: true };
  }
  return { data: cachedAnalytics || buildAnalyticsFromCache([], []), offline: true };
}

// --- Offline-Aware Mutations (Add Item, Edit Item, Mark Sold) ---

export async function saveInventoryItemOfflineAware(userId, payload, { editId = null } = {}) {
  const isEdit = Boolean(editId);

  if (isBrowserOnline() && !String(editId || '').startsWith('offline-')) {
    try {
      const res = await apiRequest(
        isEdit ? `/api/inventory/${encodeURIComponent(editId)}` : '/api/inventory',
        { method: isEdit ? 'PUT' : 'POST', body: payload }
      );
      const list = (await getSnapshot(userId, 'inventory')) || [];
      const nextList = isEdit
        ? list.map((i) => (i.id === editId ? res.item : i))
        : [res.item, ...list];
      await setSnapshot(userId, 'inventory', nextList);
      await setSnapshot(userId, `item:${res.item.id}`, res.item);
      return { item: res.item, queued: false };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }

  // Offline optimistic update + queue
  const nowIso = new Date().toISOString();
  const itemId = isEdit ? editId : `offline-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const optimisticItem = {
    ...payload,
    id: itemId,
    user_id: userId,
    created_at: nowIso,
    updated_at: nowIso,
    _pendingSync: true
  };

  const list = (await getSnapshot(userId, 'inventory')) || [];
  const nextList = isEdit
    ? list.map((i) => (i.id === editId ? { ...i, ...optimisticItem } : i))
    : [optimisticItem, ...list];
  await setSnapshot(userId, 'inventory', nextList);
  await setSnapshot(userId, `item:${itemId}`, optimisticItem);

  await enqueueMutation(userId, {
    type: isEdit ? 'update_inventory' : 'create_inventory',
    itemId,
    payload
  });

  return { item: optimisticItem, queued: true };
}

export async function sellItemOfflineAware(userId, item, salePayload) {
  if (isBrowserOnline() && !String(item.id).startsWith('offline-')) {
    try {
      const res = await apiRequest(`/api/inventory/${encodeURIComponent(item.id)}/sell`, {
        method: 'POST',
        body: salePayload
      });
      const list = (await getSnapshot(userId, 'inventory')) || [];
      await setSnapshot(
        userId,
        'inventory',
        list.map((i) => (i.id === item.id ? res.item : i))
      );
      const sales = (await getSnapshot(userId, 'sales')) || [];
      await setSnapshot(userId, 'sales', [res.sale, ...sales]);
      return { item: res.item, sale: res.sale, queued: false };
    } catch (err) {
      if (!isNetworkFailure(err)) throw err;
    }
  }

  // Offline optimistic sale + stock decrement
  const qtySold = Number(salePayload.quantity_sold) || 1;
  if (qtySold > Number(item.quantity)) {
    throw new Error(`Only ${item.quantity} unit(s) available in stock.`);
  }

  const nextQty = Number(item.quantity) - qtySold;
  const nextStatus = nextQty === 0 ? 'Sold' : item.status;
  const unitPrice = Number(salePayload.selling_price ?? item.selling_price);
  const profit = Number(((unitPrice - Number(item.purchase_cost)) * qtySold).toFixed(2));
  const nowIso = new Date().toISOString();

  const updatedItem = {
    ...item,
    quantity: nextQty,
    status: nextStatus,
    selling_date: nextQty === 0 ? salePayload.sale_date || todayISO() : item.selling_date,
    updated_at: nowIso,
    _pendingSync: true
  };

  const optimisticSale = {
    id: `offline-sale-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    user_id: userId,
    item_id: item.id,
    sku: item.sku,
    item_name: item.item_name,
    type: item.type,
    sub_type: item.sub_type || '',
    color: item.color || '',
    quantity_sold: qtySold,
    purchase_cost: Number(item.purchase_cost),
    selling_price: unitPrice,
    profit,
    sale_date: salePayload.sale_date || todayISO(),
    customer_name: salePayload.customer_name || '',
    customer_phone: salePayload.customer_phone || '',
    payment_mode: salePayload.payment_mode || 'UPI',
    notes: salePayload.notes || '',
    created_at: nowIso,
    _pendingSync: true
  };

  const list = (await getSnapshot(userId, 'inventory')) || [];
  await setSnapshot(
    userId,
    'inventory',
    list.map((i) => (i.id === item.id ? updatedItem : i))
  );
  const sales = (await getSnapshot(userId, 'sales')) || [];
  await setSnapshot(userId, 'sales', [optimisticSale, ...sales]);

  await enqueueMutation(userId, {
    type: 'sell_inventory',
    itemId: item.id,
    payload: salePayload
  });

  return { item: updatedItem, sale: optimisticSale, queued: true };
}

// --- Queue Replay Engine ---

export async function getPendingSyncCount(userId) {
  const queue = await getQueuedMutations(userId);
  return queue.length;
}

export async function replaySyncQueue(userId, fetcher = apiRequest) {
  const queue = await getQueuedMutations(userId);
  let synced = 0;
  let failed = 0;
  const tempIdMap = new Map();

  for (const entry of queue) {
    try {
      const resolvedId = tempIdMap.get(entry.itemId) || entry.itemId;

      if (entry.type === 'create_inventory') {
        const res = await fetcher('/api/inventory', {
          method: 'POST',
          body: entry.payload
        });
        if (res?.item?.id && entry.itemId) {
          tempIdMap.set(entry.itemId, res.item.id);
        }
      } else if (entry.type === 'update_inventory') {
        await fetcher(`/api/inventory/${encodeURIComponent(resolvedId)}`, {
          method: 'PUT',
          body: entry.payload
        });
      } else if (entry.type === 'sell_inventory') {
        await fetcher(`/api/inventory/${encodeURIComponent(resolvedId)}/sell`, {
          method: 'POST',
          body: entry.payload
        });
      }

      await removeQueuedMutation(entry.id);
      synced += 1;
    } catch (err) {
      failed += 1;
      if (isNetworkFailure(err)) {
        break;
      }
    }
  }

  // Refresh server snapshots after successful syncs
  if (synced > 0 && fetcher === apiRequest && isBrowserOnline()) {
    await Promise.allSettled([
      fetchInventoryCached(userId),
      fetchSalesCached(userId)
    ]);
  }

  return { synced, failed };
}

export async function clearUserOfflineData(userId) {
  await clearUserStore(userId);
}

// --- Online & Offline Excel (.xlsx) / CSV Export ---

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadReportOfflineAware(userId, type = 'full', format = 'xlsx') {
  const stamp = todayISO();
  const filename =
    type === 'inventory'
      ? `vastraledger-inventory-${stamp}.${format}`
      : type === 'sales'
        ? `vastraledger-sales-${stamp}.${format}`
        : `vastraledger-boutique-report-${stamp}.${format}`;

  // Try live server export when online
  if (isBrowserOnline()) {
    try {
      const res = await fetch(
        `/api/export?type=${encodeURIComponent(type)}&format=${encodeURIComponent(format)}`,
        { credentials: 'same-origin' }
      );
      if (res.ok) {
        const blob = await res.blob();
        triggerBrowserDownload(blob, filename);
        return { filename, offline: false };
      }
    } catch {
      // Fall through to offline generation from IndexedDB
    }
  }

  // Offline generation using identical shared OpenXML / CSV engine
  const [items, sales] = await Promise.all([
    getSnapshot(userId, 'inventory'),
    getSnapshot(userId, 'sales')
  ]);
  const safeItems = items || [];
  const safeSales = sales || [];

  let blob;
  if (format === 'csv') {
    const csv = type === 'sales' ? generateSalesCsv(safeSales) : generateInventoryCsv(safeItems);
    blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  } else {
    const bytes =
      type === 'inventory'
        ? generateInventoryXlsx(safeItems)
        : type === 'sales'
          ? generateSalesXlsx(safeSales)
          : generateFullReportXlsx(safeItems, safeSales);
    blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
  }

  triggerBrowserDownload(blob, filename);
  return { filename, offline: true };
}
