import {
  daysBetween,
  getDateRangeForPeriod,
  PAYMENT_MODES,
  shiftDaysISO,
  todayISO,
  VALID_PERIODS
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
  getAuthenticatedUser,
  getSessionSecret,
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleSignup
} from './auth.js';
import {
  cleanString,
  parseIsoDate,
  validateExpensePayload,
  validateInstallmentPayload,
  validateInventoryPayload,
  validateReturnPayload,
  validateSalePayload,
  ValidationError
} from './validation.js';

function jsonResponse(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders
    }
  });
}

async function requireAuth(request, env) {
  const auth = await getAuthenticatedUser(request, env);
  if (!auth) {
    throw new ValidationError('Authentication required. Please log in.', 401);
  }
  return auth;
}

export async function routeApiRequest(request, env, url) {
  const { pathname, searchParams } = url;
  const method = request.method.toUpperCase();

  // --- Health (unauthenticated) ---
  if (pathname === '/api/health' && method === 'GET') {
    let databaseOk = false;
    try {
      const ping = await env.DB.prepare('SELECT 1 AS ok').first();
      databaseOk = Number(ping?.ok) === 1;
    } catch {
      databaseOk = false;
    }
    return jsonResponse({
      success: true,
      status: databaseOk ? 'ok' : 'degraded',
      database: databaseOk,
      sessionSecret: Boolean(getSessionSecret(env)),
      timestamp: new Date().toISOString()
    });
  }

  // --- Auth Endpoints ---
  if (pathname === '/api/auth/signup' && method === 'POST') {
    const result = await handleSignup(request, env);
    return jsonResponse(result.data, result.status, { 'Set-Cookie': result.cookie });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const result = await handleLogin(request, env);
    return jsonResponse(result.data, result.status, { 'Set-Cookie': result.cookie });
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const result = await handleLogout(request, env);
    return jsonResponse(result.data, result.status, { 'Set-Cookie': result.cookie });
  }

  if (pathname === '/api/auth/session' && method === 'GET') {
    const auth = await getAuthenticatedUser(request, env);
    if (!auth) {
      return jsonResponse({ success: true, authenticated: false, user: null });
    }
    return jsonResponse({ success: true, authenticated: true, user: auth.user });
  }

  if (pathname === '/api/auth/change-password' && method === 'POST') {
    const auth = await requireAuth(request, env);
    const result = await handleChangePassword(request, env, auth);
    return jsonResponse(result.data, result.status);
  }

  // --- Business Endpoints Require Auth (unknown /api/* falls through to 404) ---
  const isBusinessRoute =
    pathname === '/api/settings' ||
    pathname === '/api/inventory' ||
    /^\/api\/inventory\/[^/]+(\/sell)?$/.test(pathname) ||
    pathname === '/api/sales' ||
    /^\/api\/sales\/[^/]+(\/installments|\/return)?$/.test(pathname) ||
    pathname === '/api/expenses' ||
    /^\/api\/expenses\/[^/]+$/.test(pathname) ||
    pathname === '/api/dashboard' ||
    pathname === '/api/analytics' ||
    pathname === '/api/export';

  if (!isBusinessRoute) {
    return jsonResponse({ success: false, error: `Unknown API route: ${pathname}` }, 404);
  }

  const auth = await requireAuth(request, env);
  const userId = auth.user.id;

  // --- Settings ---
  if (pathname === '/api/settings' && method === 'GET') {
    const settings = await env.DB.prepare(
      `SELECT u.id, u.full_name, u.email, u.phone,
              COALESCE(st.business_name, u.business_name) AS business_name,
              COALESCE(st.currency_symbol, '₹') AS currency_symbol,
              COALESCE(st.selected_period, 'all-time') AS selected_period,
              COALESCE(st.theme_preference, 'system') AS theme_preference,
              st.updated_at
       FROM users u
       LEFT JOIN store_settings st ON st.user_id = u.id
       WHERE u.id = ?`
    )
      .bind(userId)
      .first();

    return jsonResponse({ success: true, settings });
  }

  if (pathname === '/api/settings' && method === 'PUT') {
    const body = await request.json();
    const current = await env.DB.prepare(
      `SELECT u.full_name, COALESCE(st.business_name, u.business_name) AS business_name,
              COALESCE(st.currency_symbol, '₹') AS currency_symbol,
              COALESCE(st.selected_period, 'all-time') AS selected_period,
              COALESCE(st.theme_preference, 'system') AS theme_preference
       FROM users u
       LEFT JOIN store_settings st ON st.user_id = u.id
       WHERE u.id = ?`
    )
      .bind(userId)
      .first();

    const full_name =
      body.full_name !== undefined ? cleanString(body.full_name, 100) : current.full_name;
    if (!full_name || full_name.length < 2) {
      throw new ValidationError('Full name must be at least 2 characters.');
    }

    const business_name =
      body.business_name !== undefined
        ? cleanString(body.business_name, 120) || 'VastraLedger'
        : current.business_name;

    const selected_period =
      body.selected_period !== undefined
        ? cleanString(body.selected_period, 32)
        : current.selected_period;
    if (!VALID_PERIODS.has(selected_period)) {
      throw new ValidationError('Invalid date period selection.');
    }

    const theme_preference =
      body.theme_preference !== undefined
        ? cleanString(body.theme_preference, 16)
        : current.theme_preference;
    if (!['system', 'light', 'dark'].includes(theme_preference)) {
      throw new ValidationError('Theme must be system, light, or dark.');
    }

    const currency_symbol =
      body.currency_symbol !== undefined
        ? cleanString(body.currency_symbol, 6) || '₹'
        : current.currency_symbol;

    const nowIso = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE users SET full_name = ?, business_name = ?, updated_at = ? WHERE id = ?`
    )
      .bind(full_name, business_name, nowIso, userId)
      .run();

    await env.DB.prepare(
      `INSERT INTO store_settings (user_id, business_name, currency_symbol, selected_period, theme_preference, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         business_name = excluded.business_name,
         currency_symbol = excluded.currency_symbol,
         selected_period = excluded.selected_period,
         theme_preference = excluded.theme_preference,
         updated_at = excluded.updated_at`
    )
      .bind(userId, business_name, currency_symbol, selected_period, theme_preference, nowIso)
      .run();

    return jsonResponse({
      success: true,
      settings: {
        id: userId,
        full_name,
        email: auth.user.email,
        phone: auth.user.phone,
        business_name,
        currency_symbol,
        selected_period,
        theme_preference,
        updated_at: nowIso
      }
    });
  }

  // --- Inventory Collection ---
  if (pathname === '/api/inventory' && method === 'GET') {
    const clauses = ['user_id = ?'];
    const params = [userId];

    const search = cleanString(searchParams.get('search'), 120);
    if (search) {
      const like = `%${search}%`;
      clauses.push(
        `(sku LIKE ? OR series_code LIKE ? OR item_name LIKE ? OR type LIKE ? OR sub_type LIKE ? OR color LIKE ? OR pattern LIKE ? OR fabric LIKE ? OR supplier_name LIKE ? OR notes LIKE ?)`
      );
      params.push(like, like, like, like, like, like, like, like, like, like);
    }

    const status = cleanString(searchParams.get('status'), 32);
    if (status && status !== 'All') {
      clauses.push('status = ?');
      params.push(status);
    }

    const type = cleanString(searchParams.get('type'), 64);
    if (type && type !== 'All') {
      clauses.push('type = ?');
      params.push(type);
    }

    const subType = cleanString(searchParams.get('sub_type'), 80);
    if (subType && subType !== 'All') {
      clauses.push('sub_type = ?');
      params.push(subType);
    }

    const color = cleanString(searchParams.get('color'), 64);
    if (color && color !== 'All') {
      clauses.push('LOWER(color) = LOWER(?)');
      params.push(color);
    }

    const pattern = cleanString(searchParams.get('pattern'), 64);
    if (pattern && pattern !== 'All') {
      clauses.push('pattern = ?');
      params.push(pattern);
    }

    const minPriceRaw = searchParams.get('min_price');
    if (minPriceRaw !== null && minPriceRaw !== '') {
      const minPrice = Number(minPriceRaw);
      if (Number.isFinite(minPrice) && minPrice >= 0) {
        clauses.push('selling_price >= ?');
        params.push(minPrice);
      }
    }

    const maxPriceRaw = searchParams.get('max_price');
    if (maxPriceRaw !== null && maxPriceRaw !== '') {
      const maxPrice = Number(maxPriceRaw);
      if (Number.isFinite(maxPrice) && maxPrice >= 0) {
        clauses.push('selling_price <= ?');
        params.push(maxPrice);
      }
    }

    const sortMap = {
      newest: 'purchase_date DESC, created_at DESC',
      oldest: 'purchase_date ASC, created_at ASC',
      'price-asc': 'selling_price ASC',
      'price-desc': 'selling_price DESC',
      'margin-desc':
        'CASE WHEN selling_price > 0 THEN ((selling_price - purchase_cost) / selling_price) ELSE 0 END DESC'
    };
    const orderBy = sortMap[searchParams.get('sort')] || sortMap.newest;

    const sql = `SELECT id, user_id, sku, series_code, item_name, type, sub_type, color, pattern, fabric, size,
                        supplier_name, quantity, purchase_cost, selling_price, purchase_date,
                        selling_date, status, thumbnail_data_url, notes, created_at, updated_at
                 FROM inventory
                 WHERE ${clauses.join(' AND ')}
                 ORDER BY ${orderBy}`;

    const [invRes, salesRes] = await Promise.all([
      env.DB.prepare(sql).bind(...params).all(),
      env.DB.prepare(
        `SELECT item_id, sku, sale_date, customer_name, customer_phone, selling_price,
                quantity_sold, payment_mode, amount_paid, balance_due, payment_status, sale_status
         FROM sales
         WHERE user_id = ?
         ORDER BY sale_date DESC, created_at DESC`
      )
        .bind(userId)
        .all()
    ]);

    const latestSaleByItemId = new Map();
    const latestSaleBySku = new Map();
    for (const s of salesRes.results || []) {
      if (s.item_id && !latestSaleByItemId.has(s.item_id)) {
        latestSaleByItemId.set(s.item_id, s);
      }
      if (s.sku && !latestSaleBySku.has(s.sku)) {
        latestSaleBySku.set(s.sku, s);
      }
    }

    const items = (invRes.results || []).map((item) => {
      const matchedSale =
        (item.id && latestSaleByItemId.get(item.id)) ||
        (item.sku && latestSaleBySku.get(item.sku)) ||
        null;

      const isSoldOut = item.status === 'Sold' || Number(item.quantity) <= 0;

      return {
        ...item,
        sold_info: matchedSale
          ? {
              sale_date: matchedSale.sale_date || item.selling_date || '',
              customer_name: matchedSale.customer_name || 'Walk-in Customer',
              customer_phone: matchedSale.customer_phone || '',
              selling_price: Number(matchedSale.selling_price ?? item.selling_price),
              quantity_sold: Number(matchedSale.quantity_sold ?? 1),
              payment_mode: matchedSale.payment_mode || '',
              balance_due: Number(matchedSale.balance_due ?? 0),
              sale_status: matchedSale.sale_status || 'Completed'
            }
          : isSoldOut
            ? {
                sale_date: item.selling_date || 'Date not recorded',
                customer_name: 'Walk-in Customer',
                customer_phone: '',
                selling_price: Number(item.selling_price),
                quantity_sold: 1,
                payment_mode: '',
                balance_due: 0,
                sale_status: 'Completed'
              }
            : null
      };
    });

    return jsonResponse({ success: true, items });
  }

  if (pathname === '/api/inventory' && method === 'POST') {
    const body = await request.json();
    const data = validateInventoryPayload(body);

    const existingSku = await env.DB.prepare(
      `SELECT id FROM inventory WHERE user_id = ? AND sku = ?`
    )
      .bind(userId, data.sku)
      .first();
    if (existingSku) {
      throw new ValidationError(`SKU "${data.sku}" already exists in your inventory.`, 409);
    }

    const itemId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO inventory (
         id, user_id, sku, series_code, item_name, type, sub_type, color, pattern, fabric, size,
         supplier_name, quantity, purchase_cost, selling_price, purchase_date,
         selling_date, status, thumbnail_data_url, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        itemId,
        userId,
        data.sku,
        data.series_code,
        data.item_name,
        data.type,
        data.sub_type,
        data.color,
        data.pattern,
        data.fabric,
        data.size,
        data.supplier_name,
        data.quantity,
        data.purchase_cost,
        data.selling_price,
        data.purchase_date,
        data.selling_date,
        data.status,
        data.thumbnail_data_url || null,
        data.notes,
        nowIso,
        nowIso
      )
      .run();

    if (Array.isArray(data.photos) && data.photos.length > 0) {
      for (let i = 0; i < data.photos.length; i += 1) {
        await env.DB.prepare(
          `INSERT INTO item_photos (id, item_id, user_id, photo_data_url, sort_order, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
          .bind(crypto.randomUUID(), itemId, userId, data.photos[i], i, nowIso)
          .run();
      }
    }

    const created = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
      .bind(itemId, userId)
      .first();

    return jsonResponse({ success: true, item: { ...created, photos: data.photos || [] } }, 201);
  }

  // --- Single Inventory Item & Sell ---
  const sellMatch = pathname.match(/^\/api\/inventory\/([^/]+)\/sell$/);
  if (sellMatch && method === 'POST') {
    const itemId = decodeURIComponent(sellMatch[1]);
    const item = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
      .bind(itemId, userId)
      .first();

    if (!item) {
      throw new ValidationError('Inventory item not found.', 404);
    }
    if (item.quantity <= 0) {
      throw new ValidationError('This item has 0 quantity in stock and cannot be sold.', 400);
    }

    const body = await request.json();
    const saleInput = validateSalePayload(body, item);

    const newQuantity = item.quantity - saleInput.quantity_sold;
    const newStatus = newQuantity === 0 ? 'Sold' : item.status;
    const newSellingDate = newQuantity === 0 ? saleInput.sale_date : item.selling_date;
    const profit = Number(
      ((saleInput.selling_price - Number(item.purchase_cost)) * saleInput.quantity_sold).toFixed(2)
    );

    const saleId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE inventory
       SET quantity = ?, status = ?, selling_date = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(newQuantity, newStatus, newSellingDate, nowIso, itemId, userId)
      .run();

    await env.DB.prepare(
      `INSERT INTO sales (
         id, user_id, item_id, sku, item_name, type, sub_type, color,
         quantity_sold, purchase_cost, selling_price, profit, sale_date,
         customer_name, customer_phone, payment_mode,
         amount_paid, balance_due, payment_status, next_due_date,
         sale_status, returned_qty, refund_amount, returned_at, return_reason,
         notes, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        saleId,
        userId,
        item.id,
        item.sku,
        item.item_name,
        item.type,
        item.sub_type,
        item.color,
        saleInput.quantity_sold,
        item.purchase_cost,
        saleInput.selling_price,
        profit,
        saleInput.sale_date,
        saleInput.customer_name,
        saleInput.customer_phone,
        saleInput.payment_mode,
        saleInput.amount_paid,
        saleInput.balance_due,
        saleInput.payment_status,
        saleInput.next_due_date,
        'Completed',
        0,
        0,
        null,
        '',
        saleInput.notes,
        nowIso
      )
      .run();

    if (saleInput.amount_paid > 0) {
      await env.DB.prepare(
        `INSERT INTO sale_installments (id, sale_id, user_id, amount, payment_date, payment_mode, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          crypto.randomUUID(),
          saleId,
          userId,
          saleInput.amount_paid,
          saleInput.sale_date,
          saleInput.payment_mode === 'EMI' ? 'Cash' : saleInput.payment_mode,
          saleInput.payment_mode === 'EMI' ? 'Initial advance / first installment' : 'Full payment',
          nowIso
        )
        .run();
    }

    const updatedItem = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
      .bind(itemId, userId)
      .first();
    const createdSale = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
      .bind(saleId, userId)
      .first();

    const soldInfo = {
      sale_date: createdSale.sale_date,
      customer_name: createdSale.customer_name || 'Walk-in Customer',
      customer_phone: createdSale.customer_phone || '',
      selling_price: Number(createdSale.selling_price),
      quantity_sold: Number(createdSale.quantity_sold),
      payment_mode: createdSale.payment_mode || '',
      balance_due: Number(createdSale.balance_due || 0),
      sale_status: createdSale.sale_status || 'Completed'
    };

    return jsonResponse(
      {
        success: true,
        item: { ...updatedItem, sold_info: soldInfo },
        sale: createdSale
      },
      201
    );
  }

  const itemMatch = pathname.match(/^\/api\/inventory\/([^/]+)$/);
  if (itemMatch) {
    const itemId = decodeURIComponent(itemMatch[1]);

    if (method === 'GET') {
      const item = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
        .bind(itemId, userId)
        .first();
      if (!item) {
        throw new ValidationError('Inventory item not found.', 404);
      }
      const photosRes = await env.DB.prepare(
        `SELECT id, photo_data_url, sort_order FROM item_photos
         WHERE item_id = ? AND user_id = ?
         ORDER BY sort_order ASC`
      )
        .bind(itemId, userId)
        .all();

      return jsonResponse({
        success: true,
        item: {
          ...item,
          photos: (photosRes.results || []).map((p) => p.photo_data_url)
        }
      });
    }

    if (method === 'PUT') {
      const existing = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
        .bind(itemId, userId)
        .first();
      if (!existing) {
        throw new ValidationError('Inventory item not found.', 404);
      }

      const body = await request.json();
      const data = validateInventoryPayload(body, { isUpdate: true });

      if (data.sku !== existing.sku) {
        const dup = await env.DB.prepare(
          `SELECT id FROM inventory WHERE user_id = ? AND sku = ? AND id != ?`
        )
          .bind(userId, data.sku, itemId)
          .first();
        if (dup) {
          throw new ValidationError(`SKU "${data.sku}" already exists in your inventory.`, 409);
        }
      }

      const nowIso = new Date().toISOString();
      const nextThumbnail =
        data.thumbnail_data_url !== undefined
          ? data.thumbnail_data_url
          : existing.thumbnail_data_url;

      await env.DB.prepare(
        `UPDATE inventory
         SET sku = ?, series_code = ?, item_name = ?, type = ?, sub_type = ?, color = ?, pattern = ?,
             fabric = ?, size = ?, supplier_name = ?, quantity = ?, purchase_cost = ?,
             selling_price = ?, purchase_date = ?, selling_date = ?, status = ?,
             thumbnail_data_url = ?, notes = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
        .bind(
          data.sku,
          data.series_code,
          data.item_name,
          data.type,
          data.sub_type,
          data.color,
          data.pattern,
          data.fabric,
          data.size,
          data.supplier_name,
          data.quantity,
          data.purchase_cost,
          data.selling_price,
          data.purchase_date,
          data.selling_date,
          data.status,
          nextThumbnail,
          data.notes,
          nowIso,
          itemId,
          userId
        )
        .run();

      if (data.photos !== undefined) {
        await env.DB.prepare(`DELETE FROM item_photos WHERE item_id = ? AND user_id = ?`)
          .bind(itemId, userId)
          .run();
        for (let i = 0; i < data.photos.length; i += 1) {
          await env.DB.prepare(
            `INSERT INTO item_photos (id, item_id, user_id, photo_data_url, sort_order, created_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
            .bind(crypto.randomUUID(), itemId, userId, data.photos[i], i, nowIso)
            .run();
        }
      }

      const updated = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
        .bind(itemId, userId)
        .first();
      const photosRes = await env.DB.prepare(
        `SELECT photo_data_url FROM item_photos WHERE item_id = ? AND user_id = ? ORDER BY sort_order ASC`
      )
        .bind(itemId, userId)
        .all();

      return jsonResponse({
        success: true,
        item: { ...updated, photos: (photosRes.results || []).map((p) => p.photo_data_url) }
      });
    }

    if (method === 'DELETE') {
      const existing = await env.DB.prepare(`SELECT id FROM inventory WHERE id = ? AND user_id = ?`)
        .bind(itemId, userId)
        .first();
      if (!existing) {
        throw new ValidationError('Inventory item not found.', 404);
      }
      await env.DB.prepare(`DELETE FROM inventory WHERE id = ? AND user_id = ?`)
        .bind(itemId, userId)
        .run();
      return jsonResponse({ success: true, deletedId: itemId });
    }
  }

  // --- Return Sold Item (Restores Stock + Adjusts Sale + Optional Refund Expense) ---
  const returnMatch = pathname.match(/^\/api\/sales\/([^/]+)\/return$/);
  if (returnMatch && method === 'POST') {
    const saleId = decodeURIComponent(returnMatch[1]);
    const sale = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
      .bind(saleId, userId)
      .first();

    if (!sale) {
      throw new ValidationError('Sale record not found.', 404);
    }

    const body = await request.json();
    const retInput = validateReturnPayload(body, sale);
    const nowIso = new Date().toISOString();

    const prevReturnedQty = Number(sale.returned_qty) || 0;
    const nextReturnedQty = prevReturnedQty + retInput.return_qty;
    const totalSoldQty = Number(sale.quantity_sold) || 1;
    const remainingActiveQty = Math.max(0, totalSoldQty - nextReturnedQty);
    const nextSaleStatus =
      remainingActiveQty === 0 ? 'Returned' : 'Partially Returned';

    const prevRefund = Number(sale.refund_amount) || 0;
    const nextRefund = Number((prevRefund + retInput.refund_amount).toFixed(2));

    const nextProfit = Number(
      ((Number(sale.selling_price) - Number(sale.purchase_cost)) * remainingActiveQty).toFixed(2)
    );

    const nextAmountPaid = Number(
      Math.max(0, Number(sale.amount_paid ?? Number(sale.selling_price) * totalSoldQty) - retInput.refund_amount).toFixed(2)
    );
    const nextBalanceDue = Number(
      Math.max(0, Number(sale.selling_price) * remainingActiveQty - nextAmountPaid).toFixed(2)
    );
    const nextPaymentStatus =
      nextBalanceDue <= 0 ? 'Paid' : nextAmountPaid > 0 ? 'Partial' : 'Pending';

    await env.DB.prepare(
      `UPDATE sales
       SET sale_status = ?, returned_qty = ?, refund_amount = ?, returned_at = ?, return_reason = ?,
           profit = ?, amount_paid = ?, balance_due = ?, payment_status = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(
        nextSaleStatus,
        nextReturnedQty,
        nextRefund,
        retInput.return_date,
        retInput.reason || sale.return_reason || '',
        nextProfit,
        nextAmountPaid,
        nextBalanceDue,
        nextPaymentStatus,
        saleId,
        userId
      )
      .run();

    // Restore stock back into inventory
    if (sale.item_id) {
      const inv = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
        .bind(sale.item_id, userId)
        .first();
      if (inv) {
        const restoredQty = Number(inv.quantity) + retInput.return_qty;
        const restoredStatus = restoredQty > 0 && inv.status === 'Sold' ? 'In Stock' : inv.status;
        await env.DB.prepare(
          `UPDATE inventory
           SET quantity = ?, status = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`
        )
          .bind(restoredQty, restoredStatus, nowIso, inv.id, userId)
          .run();
      }
    }

    // Optionally log refund payout in manual expenses
    let createdExpense = null;
    if (retInput.log_expense && retInput.refund_amount > 0) {
      const expId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO expenses (
           id, user_id, expense_date, category, title, amount, payment_mode,
           vendor_name, related_sku, notes, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          expId,
          userId,
          retInput.return_date,
          'Customer Return Refund',
          `Return Refund — ${sale.item_name} (${retInput.return_qty} pc)`,
          retInput.refund_amount,
          retInput.payment_mode,
          sale.customer_name || 'Walk-in Customer',
          sale.sku,
          retInput.reason || 'Customer returned item',
          nowIso,
          nowIso
        )
        .run();

      createdExpense = await env.DB.prepare(`SELECT * FROM expenses WHERE id = ? AND user_id = ?`)
        .bind(expId, userId)
        .first();
    }

    const updatedSale = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
      .bind(saleId, userId)
      .first();

    return jsonResponse({ success: true, sale: updatedSale, expense: createdExpense }, 201);
  }

  // --- EMI Installments on a Sale ---
  const installmentMatch = pathname.match(/^\/api\/sales\/([^/]+)\/installments$/);
  if (installmentMatch && method === 'POST') {
    const saleId = decodeURIComponent(installmentMatch[1]);
    const sale = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
      .bind(saleId, userId)
      .first();

    if (!sale) {
      throw new ValidationError('Sale record not found.', 404);
    }

    const activeQty = Math.max(
      0,
      (Number(sale.quantity_sold) || 1) - (Number(sale.returned_qty) || 0)
    );
    const totalSaleValue = Number((Number(sale.selling_price) * activeQty).toFixed(2));
    const currentPaid = Number(sale.amount_paid ?? totalSaleValue);
    const currentDue =
      sale.balance_due !== null && sale.balance_due !== undefined
        ? Number(sale.balance_due)
        : Number(Math.max(0, totalSaleValue - currentPaid).toFixed(2));

    if (currentDue <= 0) {
      throw new ValidationError('This sale is already paid in full.', 400);
    }

    const body = await request.json();
    const instInput = validateInstallmentPayload(body, currentDue);

    const nextPaid = Number(Math.min(totalSaleValue, currentPaid + instInput.amount).toFixed(2));
    const nextDue = Number(Math.max(0, totalSaleValue - nextPaid).toFixed(2));
    const nextStatus = nextDue <= 0 ? 'Paid' : 'Partial';
    const nextDueDate =
      nextDue > 0 ? instInput.next_due_date || sale.next_due_date || null : null;
    const nowIso = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO sale_installments (id, sale_id, user_id, amount, payment_date, payment_mode, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        crypto.randomUUID(),
        saleId,
        userId,
        instInput.amount,
        instInput.payment_date,
        instInput.payment_mode,
        instInput.notes,
        nowIso
      )
      .run();

    await env.DB.prepare(
      `UPDATE sales
       SET amount_paid = ?, balance_due = ?, payment_status = ?, next_due_date = ?
       WHERE id = ? AND user_id = ?`
    )
      .bind(nextPaid, nextDue, nextStatus, nextDueDate, saleId, userId)
      .run();

    const updatedSale = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
      .bind(saleId, userId)
      .first();

    return jsonResponse({ success: true, sale: updatedSale }, 201);
  }

  // --- Sales Ledger ---
  if (pathname === '/api/sales' && method === 'GET') {
    const clauses = ['user_id = ?'];
    const params = [userId];

    const search = cleanString(searchParams.get('search'), 120);
    if (search) {
      const like = `%${search}%`;
      clauses.push(
        `(customer_name LIKE ? OR customer_phone LIKE ? OR sku LIKE ? OR item_name LIKE ?)`
      );
      params.push(like, like, like, like);
    }

    const startDate = cleanString(searchParams.get('start_date'), 20);
    if (startDate) {
      clauses.push('sale_date >= ?');
      params.push(startDate);
    }

    const endDate = cleanString(searchParams.get('end_date'), 20);
    if (endDate) {
      clauses.push('sale_date <= ?');
      params.push(endDate);
    }

    const type = cleanString(searchParams.get('type'), 64);
    if (type && type !== 'All') {
      clauses.push('type = ?');
      params.push(type);
    }

    const paymentMode = cleanString(searchParams.get('payment_mode'), 32);
    if (paymentMode && paymentMode !== 'All') {
      clauses.push('payment_mode = ?');
      params.push(paymentMode);
    }

    const paymentStatus = cleanString(searchParams.get('payment_status'), 32);
    if (paymentStatus && paymentStatus !== 'All') {
      clauses.push('payment_status = ?');
      params.push(paymentStatus);
    }

    const res = await env.DB.prepare(
      `SELECT * FROM sales WHERE ${clauses.join(' AND ')} ORDER BY sale_date DESC, created_at DESC`
    )
      .bind(...params)
      .all();

    return jsonResponse({ success: true, sales: res.results || [] });
  }

  const saleMatch = pathname.match(/^\/api\/sales\/([^/]+)$/);
  if (saleMatch) {
    const saleId = decodeURIComponent(saleMatch[1]);

    if (method === 'PUT') {
      const existing = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
        .bind(saleId, userId)
        .first();
      if (!existing) {
        throw new ValidationError('Sale record not found.', 404);
      }

      const body = await request.json();
      const payment_mode =
        body.payment_mode !== undefined ? cleanString(body.payment_mode, 32) : existing.payment_mode;
      if (!PAYMENT_MODES.includes(payment_mode)) {
        throw new ValidationError(`Payment mode must be one of: ${PAYMENT_MODES.join(', ')}.`);
      }

      const notes = body.notes !== undefined ? cleanString(body.notes, 500) : existing.notes;
      const customer_name =
        body.customer_name !== undefined
          ? cleanString(body.customer_name, 120)
          : existing.customer_name;
      const customer_phone =
        body.customer_phone !== undefined
          ? cleanString(body.customer_phone, 30)
          : existing.customer_phone;
      const next_due_date =
        body.next_due_date !== undefined
          ? body.next_due_date
            ? parseIsoDate(body.next_due_date, null)
            : null
          : existing.next_due_date;

      await env.DB.prepare(
        `UPDATE sales SET payment_mode = ?, notes = ?, customer_name = ?, customer_phone = ?, next_due_date = ?
         WHERE id = ? AND user_id = ?`
      )
        .bind(payment_mode, notes, customer_name, customer_phone, next_due_date, saleId, userId)
        .run();

      const updated = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
        .bind(saleId, userId)
        .first();
      return jsonResponse({ success: true, sale: updated });
    }

    if (method === 'DELETE') {
      const existing = await env.DB.prepare(`SELECT * FROM sales WHERE id = ? AND user_id = ?`)
        .bind(saleId, userId)
        .first();
      if (!existing) {
        throw new ValidationError('Sale record not found.', 404);
      }

      const restoreStock = searchParams.get('restoreStock') === 'true';
      if (restoreStock && existing.item_id) {
        const inv = await env.DB.prepare(`SELECT * FROM inventory WHERE id = ? AND user_id = ?`)
          .bind(existing.item_id, userId)
          .first();
        if (inv) {
          const activeSold = Math.max(
            0,
            (Number(existing.quantity_sold) || 1) - (Number(existing.returned_qty) || 0)
          );
          const restoredQty = Number(inv.quantity) + activeSold;
          const restoredStatus = inv.status === 'Sold' ? 'In Stock' : inv.status;
          await env.DB.prepare(
            `UPDATE inventory SET quantity = ?, status = ?, selling_date = NULL, updated_at = ?
             WHERE id = ? AND user_id = ?`
          )
            .bind(restoredQty, restoredStatus, new Date().toISOString(), inv.id, userId)
            .run();
        }
      }

      await env.DB.prepare(`DELETE FROM sales WHERE id = ? AND user_id = ?`)
        .bind(saleId, userId)
        .run();

      return jsonResponse({ success: true, deletedId: saleId, restoredStock: restoreStock });
    }
  }

  // --- Manual Boutique Expenses ---
  if (pathname === '/api/expenses' && method === 'GET') {
    const clauses = ['user_id = ?'];
    const params = [userId];

    const search = cleanString(searchParams.get('search'), 120);
    if (search) {
      const like = `%${search}%`;
      clauses.push(`(title LIKE ? OR category LIKE ? OR vendor_name LIKE ? OR related_sku LIKE ? OR notes LIKE ?)`);
      params.push(like, like, like, like, like);
    }

    const category = cleanString(searchParams.get('category'), 80);
    if (category && category !== 'All') {
      clauses.push('category = ?');
      params.push(category);
    }

    const startDate = cleanString(searchParams.get('start_date'), 20);
    if (startDate) {
      clauses.push('expense_date >= ?');
      params.push(startDate);
    }

    const endDate = cleanString(searchParams.get('end_date'), 20);
    if (endDate) {
      clauses.push('expense_date <= ?');
      params.push(endDate);
    }

    const res = await env.DB.prepare(
      `SELECT * FROM expenses WHERE ${clauses.join(' AND ')} ORDER BY expense_date DESC, created_at DESC`
    )
      .bind(...params)
      .all();

    return jsonResponse({ success: true, expenses: res.results || [] });
  }

  if (pathname === '/api/expenses' && method === 'POST') {
    const body = await request.json();
    const data = validateExpensePayload(body);
    const expId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    await env.DB.prepare(
      `INSERT INTO expenses (
         id, user_id, expense_date, category, title, amount, payment_mode,
         vendor_name, related_sku, notes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        expId,
        userId,
        data.expense_date,
        data.category,
        data.title,
        data.amount,
        data.payment_mode,
        data.vendor_name,
        data.related_sku,
        data.notes,
        nowIso,
        nowIso
      )
      .run();

    const created = await env.DB.prepare(`SELECT * FROM expenses WHERE id = ? AND user_id = ?`)
      .bind(expId, userId)
      .first();

    return jsonResponse({ success: true, expense: created }, 201);
  }

  const expenseMatch = pathname.match(/^\/api\/expenses\/([^/]+)$/);
  if (expenseMatch) {
    const expenseId = decodeURIComponent(expenseMatch[1]);

    if (method === 'PUT') {
      const existing = await env.DB.prepare(`SELECT * FROM expenses WHERE id = ? AND user_id = ?`)
        .bind(expenseId, userId)
        .first();
      if (!existing) {
        throw new ValidationError('Expense entry not found.', 404);
      }

      const body = await request.json();
      const data = validateExpensePayload(body);
      const nowIso = new Date().toISOString();

      await env.DB.prepare(
        `UPDATE expenses
         SET expense_date = ?, category = ?, title = ?, amount = ?, payment_mode = ?,
             vendor_name = ?, related_sku = ?, notes = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
        .bind(
          data.expense_date,
          data.category,
          data.title,
          data.amount,
          data.payment_mode,
          data.vendor_name,
          data.related_sku,
          data.notes,
          nowIso,
          expenseId,
          userId
        )
        .run();

      const updated = await env.DB.prepare(`SELECT * FROM expenses WHERE id = ? AND user_id = ?`)
        .bind(expenseId, userId)
        .first();

      return jsonResponse({ success: true, expense: updated });
    }

    if (method === 'DELETE') {
      const existing = await env.DB.prepare(`SELECT id FROM expenses WHERE id = ? AND user_id = ?`)
        .bind(expenseId, userId)
        .first();
      if (!existing) {
        throw new ValidationError('Expense entry not found.', 404);
      }

      await env.DB.prepare(`DELETE FROM expenses WHERE id = ? AND user_id = ?`)
        .bind(expenseId, userId)
        .run();

      return jsonResponse({ success: true, deletedId: expenseId });
    }
  }

  // --- Dashboard (with Slicer Support) ---
  if (pathname === '/api/dashboard' && method === 'GET') {
    const requestedPeriod = searchParams.get('period');
    const period =
      requestedPeriod && VALID_PERIODS.has(requestedPeriod)
        ? requestedPeriod
        : auth.user.selected_period || 'all-time';
    const { start, end } = getDateRangeForPeriod(period);

    const slicerType = cleanString(searchParams.get('type'), 64);
    const slicerPayment = cleanString(searchParams.get('payment_mode'), 32);
    const slicerStockStatus = cleanString(searchParams.get('stock_status'), 32);

    const invRes = await env.DB.prepare(
      `SELECT id, sku, series_code, item_name, type, sub_type, color, quantity, purchase_cost, selling_price, purchase_date, status
       FROM inventory WHERE user_id = ?`
    )
      .bind(userId)
      .all();
    const allInventory = invRes.results || [];

    const filteredInventory = allInventory.filter((i) => {
      if (slicerType && slicerType !== 'All' && i.type !== slicerType) return false;
      if (slicerStockStatus === 'in-stock' && !(i.status === 'In Stock' && Number(i.quantity) > 0)) {
        return false;
      }
      if (
        slicerStockStatus === 'low-stock' &&
        !(i.status === 'In Stock' && Number(i.quantity) > 0 && Number(i.quantity) <= 2)
      ) {
        return false;
      }
      if (
        slicerStockStatus === 'aging' &&
        !(i.status === 'In Stock' && Number(i.quantity) > 0 && daysBetween(i.purchase_date) > 60)
      ) {
        return false;
      }
      return true;
    });

    const allSalesRes = await env.DB.prepare(
      `SELECT * FROM sales WHERE user_id = ? ORDER BY sale_date DESC, created_at DESC`
    )
      .bind(userId)
      .all();
    const allSales = allSalesRes.results || [];

    const periodSales = allSales.filter((s) => {
      if (start && s.sale_date < start) return false;
      if (end && s.sale_date > end) return false;
      if (slicerType && slicerType !== 'All' && s.type !== slicerType) return false;
      if (slicerPayment && slicerPayment !== 'All' && s.payment_mode !== slicerPayment) return false;
      return true;
    });

    const allExpensesRes = await env.DB.prepare(
      `SELECT * FROM expenses WHERE user_id = ? ORDER BY expense_date DESC, created_at DESC`
    )
      .bind(userId)
      .all();
    const periodExpenses = (allExpensesRes.results || []).filter((e) => {
      if (start && e.expense_date < start) return false;
      if (end && e.expense_date > end) return false;
      if (slicerPayment && slicerPayment !== 'All' && e.payment_mode !== slicerPayment) return false;
      return true;
    });

    const totalExpenses = Number(
      periodExpenses.reduce((sum, e) => sum + Number(e.amount || 0), 0).toFixed(2)
    );

    const inStockItems = filteredInventory.filter(
      (i) => i.status === 'In Stock' && Number(i.quantity) > 0
    );
    const totalStockQty = inStockItems.reduce((sum, i) => sum + Number(i.quantity), 0);
    const totalUniqueSkus = inStockItems.length;
    const totalInventoryValue = Number(
      inStockItems
        .reduce((sum, i) => sum + Number(i.quantity) * Number(i.purchase_cost), 0)
        .toFixed(2)
    );

    const totalRevenue = Number(
      periodSales
        .reduce((sum, s) => {
          const activeQty = Math.max(
            0,
            (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
          );
          return sum + Number(s.selling_price) * activeQty;
        }, 0)
        .toFixed(2)
    );
    const totalCogs = Number(
      periodSales
        .reduce((sum, s) => {
          const activeQty = Math.max(
            0,
            (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
          );
          return sum + Number(s.purchase_cost) * activeQty;
        }, 0)
        .toFixed(2)
    );
    const totalProfit = Number(
      periodSales.reduce((sum, s) => sum + Number(s.profit), 0).toFixed(2)
    );
    const profitMargin =
      totalRevenue > 0 ? Number(((totalProfit / totalRevenue) * 100).toFixed(1)) : 0;

    const totalEmiReceivable = Number(
      allSales
        .reduce((sum, s) => {
          const activeQty = Math.max(
            0,
            (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
          );
          const billed = Number(s.selling_price) * activeQty;
          const paid = Number(s.amount_paid ?? billed);
          const due =
            s.balance_due !== null && s.balance_due !== undefined
              ? Number(s.balance_due)
              : Math.max(0, billed - paid);
          return sum + due;
        }, 0)
        .toFixed(2)
    );

    const buildDailySeries = (days) => {
      const map = new Map();
      for (let i = days - 1; i >= 0; i -= 1) {
        const iso = shiftDaysISO(-i);
        map.set(iso, { date: iso, revenue: 0, profit: 0, units: 0 });
      }
      for (const s of periodSales) {
        const entry = map.get(s.sale_date);
        if (entry) {
          const activeQty = Math.max(
            0,
            (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
          );
          entry.revenue = Number(
            (entry.revenue + Number(s.selling_price) * activeQty).toFixed(2)
          );
          entry.profit = Number((entry.profit + Number(s.profit)).toFixed(2));
          entry.units += activeQty;
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
      const activeQty = Math.max(
        0,
        (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
      );
      const rev = Number(s.selling_price) * activeQty;
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

    return jsonResponse({
      success: true,
      period,
      kpis: {
        totalStockQty,
        totalUniqueSkus,
        totalInventoryValue,
        totalRevenue,
        totalCogs,
        totalProfit,
        totalExpenses,
        profitMargin,
        salesCount: periodSales.length,
        unitsSold: periodSales.reduce(
          (sum, s) =>
            sum + Math.max(0, (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)),
          0
        ),
        totalEmiReceivable
      },
      charts: {
        revenueProfit7d: buildDailySeries(7),
        revenueProfit30d: buildDailySeries(30),
        stockByType: Array.from(stockByTypeMap.values()).sort((a, b) => b.value - a.value),
        salesByPaymentMode: Array.from(payMap.values()).sort((a, b) => b.value - a.value)
      },
      recentSales: periodSales.slice(0, 5),
      agingStock
    });
  }

  // --- Analytics ---
  if (pathname === '/api/analytics' && method === 'GET') {
    const salesRes = await env.DB.prepare(
      `SELECT * FROM sales WHERE user_id = ? ORDER BY sale_date DESC, created_at DESC`
    )
      .bind(userId)
      .all();
    const sales = salesRes.results || [];

    const invRes = await env.DB.prepare(`SELECT id, pattern FROM inventory WHERE user_id = ?`)
      .bind(userId)
      .all();
    const patternByItemId = new Map((invRes.results || []).map((i) => [i.id, i.pattern]));

    const trendMap = new Map();
    for (let i = 29; i >= 0; i -= 1) {
      const iso = shiftDaysISO(-i);
      trendMap.set(iso, { date: iso, revenue: 0, profit: 0 });
    }
    for (const s of sales) {
      const entry = trendMap.get(s.sale_date);
      if (entry) {
        const activeQty = Math.max(
          0,
          (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
        );
        entry.revenue = Number(
          (entry.revenue + Number(s.selling_price) * activeQty).toFixed(2)
        );
        entry.profit = Number((entry.profit + Number(s.profit)).toFixed(2));
      }
    }

    const catMap = new Map();
    const subTypeMap = new Map();
    const colorMap = new Map();
    const patternMap = new Map();

    const bump = (map, key, qty, rev, profit) => {
      const label = cleanString(key, 80) || 'Unspecified';
      const cur = map.get(label) || { label, units: 0, revenue: 0, profit: 0 };
      cur.units += qty;
      cur.revenue = Number((cur.revenue + rev).toFixed(2));
      cur.profit = Number((cur.profit + profit).toFixed(2));
      map.set(label, cur);
    };

    for (const s of sales) {
      const qty = Math.max(
        0,
        (Number(s.quantity_sold) || 1) - (Number(s.returned_qty) || 0)
      );
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
      const pattern = s.item_id ? patternByItemId.get(s.item_id) : '';
      if (pattern) bump(patternMap, pattern, qty, rev, profit);
    }

    const categoryProfitability = Array.from(catMap.values())
      .map((c) => ({
        ...c,
        margin: c.revenue > 0 ? Number(((c.profit / c.revenue) * 100).toFixed(1)) : 0
      }))
      .sort((a, b) => b.profit - a.profit);

    const sortTop = (map) =>
      Array.from(map.values())
        .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
        .slice(0, 6);

    return jsonResponse({
      success: true,
      trend30d: Array.from(trendMap.values()),
      categoryProfitability,
      topSubTypes: sortTop(subTypeMap),
      topColors: sortTop(colorMap),
      topPatterns: sortTop(patternMap),
      monthlySummary: computeMonthlySummary(sales)
    });
  }

  // --- Export (.xlsx & .csv) ---
  if (pathname === '/api/export' && method === 'GET') {
    const type = searchParams.get('type') || 'full';
    const format = searchParams.get('format') || 'xlsx';
    const dateStamp = todayISO();

    const [invRes, salesRes] = await Promise.all([
      env.DB.prepare(
        `SELECT * FROM inventory WHERE user_id = ? ORDER BY purchase_date DESC, created_at DESC`
      )
        .bind(userId)
        .all(),
      env.DB.prepare(
        `SELECT * FROM sales WHERE user_id = ? ORDER BY sale_date DESC, created_at DESC`
      )
        .bind(userId)
        .all()
    ]);

    const items = invRes.results || [];
    const sales = salesRes.results || [];

    if (format === 'csv') {
      if (type === 'sales') {
        const csv = generateSalesCsv(sales);
        return new Response(csv, {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="vastraledger-sales-${dateStamp}.csv"`,
            'Cache-Control': 'no-store'
          }
        });
      }
      const csv = generateInventoryCsv(items);
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="vastraledger-inventory-${dateStamp}.csv"`,
          'Cache-Control': 'no-store'
        }
      });
    }

    if (format === 'xlsx') {
      let bytes;
      let filename;
      if (type === 'inventory') {
        bytes = generateInventoryXlsx(items);
        filename = `vastraledger-inventory-${dateStamp}.xlsx`;
      } else if (type === 'sales') {
        bytes = generateSalesXlsx(sales);
        filename = `vastraledger-sales-${dateStamp}.xlsx`;
      } else {
        bytes = generateFullReportXlsx(items, sales);
        filename = `vastraledger-boutique-report-${dateStamp}.xlsx`;
      }

      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store'
        }
      });
    }

    throw new ValidationError('Invalid export format. Use csv or xlsx.');
  }

  return jsonResponse({ success: false, error: `Unknown API route: ${pathname}` }, 404);
}
