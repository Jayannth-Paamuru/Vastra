import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Copy,
  Edit3,
  Grid,
  Image as ImageIcon,
  List,
  Package,
  Plus,
  RotateCcw,
  Search,
  Trash2
} from 'lucide-react';
import Modal from '../components/Modal.jsx';
import {
  calculateMarginPercent,
  CLOTHING_TYPES,
  formatINR,
  INVENTORY_STATUSES,
  PATTERN_PRESETS,
  PAYMENT_MODES,
  SUB_TYPE_PRESETS,
  todayISO
} from '../shared/constants.js';
import { apiRequest, fetchInventoryCached, sellItemOfflineAware } from '../offline/sync.js';

export default function InventoryPage({
  user,
  navigate,
  onDuplicate,
  onToast,
  onSyncStateChange,
  refreshKey
}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('grid');

  // Filters
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('All');
  const [type, setType] = useState('All');
  const [subType, setSubType] = useState('All');
  const [color, setColor] = useState('All');
  const [pattern, setPattern] = useState('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState('newest');

  // Sell / EMI Modal
  const [sellTarget, setSellTarget] = useState(null);
  const [sellForm, setSellForm] = useState({
    quantity_sold: 1,
    selling_price: '',
    sale_date: todayISO(),
    customer_name: '',
    customer_phone: '',
    payment_mode: 'UPI',
    amount_paid: '',
    next_due_date: '',
    notes: ''
  });
  const [sellBusy, setSellBusy] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const currency = user?.currency_symbol || '₹';

  const loadItems = async () => {
    setLoading(true);
    try {
      const res = await fetchInventoryCached(user.id);
      setItems(res.items || []);
    } catch (err) {
      onToast(err.message || 'Failed to load inventory.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadItems();
  }, [user.id, refreshKey]);

  const dynamicSubTypes = useMemo(() => {
    const set = new Set(SUB_TYPE_PRESETS);
    items.forEach((i) => {
      if (i.sub_type) set.add(i.sub_type);
    });
    return Array.from(set).sort();
  }, [items]);

  const dynamicColors = useMemo(() => {
    const set = new Set();
    items.forEach((i) => {
      if (i.color) set.add(i.color);
    });
    return Array.from(set).sort();
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const minP = minPrice !== '' ? Number(minPrice) : null;
    const maxP = maxPrice !== '' ? Number(maxPrice) : null;

    const list = items.filter((item) => {
      if (status !== 'All' && item.status !== status) return false;
      if (type !== 'All' && item.type !== type) return false;
      if (subType !== 'All' && item.sub_type !== subType) return false;
      if (color !== 'All' && (item.color || '').toLowerCase() !== color.toLowerCase()) return false;
      if (pattern !== 'All' && item.pattern !== pattern) return false;
      if (minP !== null && Number.isFinite(minP) && Number(item.selling_price) < minP) return false;
      if (maxP !== null && Number.isFinite(maxP) && Number(item.selling_price) > maxP) return false;

      if (q) {
        const hay = [
          item.sku,
          item.series_code,
          item.item_name,
          item.type,
          item.sub_type,
          item.color,
          item.pattern,
          item.fabric,
          item.size,
          item.supplier_name,
          item.notes,
          item.sold_info?.customer_name,
          item.sold_info?.sale_date
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...list];
    sorted.sort((a, b) => {
      if (sortBy === 'oldest') {
        return (a.purchase_date || '').localeCompare(b.purchase_date || '');
      }
      if (sortBy === 'price-asc') {
        return Number(a.selling_price) - Number(b.selling_price);
      }
      if (sortBy === 'price-desc') {
        return Number(b.selling_price) - Number(a.selling_price);
      }
      if (sortBy === 'margin-desc') {
        return (
          calculateMarginPercent(b.purchase_cost, b.selling_price) -
          calculateMarginPercent(a.purchase_cost, a.selling_price)
        );
      }
      return (
        (b.purchase_date || '').localeCompare(a.purchase_date || '') ||
        (b.created_at || '').localeCompare(a.created_at || '')
      );
    });
    return sorted;
  }, [items, search, status, type, subType, color, pattern, minPrice, maxPrice, sortBy]);

  const hasActiveFilters =
    search !== '' ||
    status !== 'All' ||
    type !== 'All' ||
    subType !== 'All' ||
    color !== 'All' ||
    pattern !== 'All' ||
    minPrice !== '' ||
    maxPrice !== '';

  const clearFilters = () => {
    setSearch('');
    setStatus('All');
    setType('All');
    setSubType('All');
    setColor('All');
    setPattern('All');
    setMinPrice('');
    setMaxPrice('');
    setSortBy('newest');
  };

  const openSellModal = (item) => {
    const defaultTotal = Number(item.selling_price || 0);
    setSellTarget(item);
    setSellForm({
      quantity_sold: 1,
      selling_price: String(item.selling_price),
      sale_date: todayISO(),
      customer_name: '',
      customer_phone: '',
      payment_mode: 'UPI',
      amount_paid: String(defaultTotal),
      next_due_date: '',
      notes: ''
    });
  };

  const handlePaymentModeChange = (nextMode) => {
    const total =
      Number(sellForm.selling_price || 0) * Math.max(1, Number(sellForm.quantity_sold || 1));
    setSellForm((f) => ({
      ...f,
      payment_mode: nextMode,
      amount_paid: nextMode === 'EMI' ? '' : String(total)
    }));
  };

  const handleConfirmSell = async (e) => {
    e.preventDefault();
    if (!sellTarget) return;
    setSellBusy(true);
    try {
      const qty = Number(sellForm.quantity_sold);
      const price = Number(sellForm.selling_price);
      const totalAmt = price * qty;
      const paidAmt =
        sellForm.payment_mode === 'EMI'
          ? Number(sellForm.amount_paid === '' ? 0 : sellForm.amount_paid)
          : totalAmt;

      const res = await sellItemOfflineAware(user.id, sellTarget, {
        ...sellForm,
        quantity_sold: qty,
        selling_price: price,
        amount_paid: paidAmt,
        next_due_date:
          sellForm.payment_mode === 'EMI' && sellForm.next_due_date ? sellForm.next_due_date : null
      });

      const nextSoldInfo = res.item?.sold_info || {
        sale_date: sellForm.sale_date,
        customer_name: sellForm.customer_name.trim() || 'Walk-in Customer',
        customer_phone: sellForm.customer_phone.trim() || '',
        selling_price: price,
        quantity_sold: qty,
        payment_mode: sellForm.payment_mode,
        balance_due: Math.max(0, Number((totalAmt - paidAmt).toFixed(2)))
      };

      setItems((prev) =>
        prev.map((i) =>
          i.id === sellTarget.id ? { ...res.item, sold_info: nextSoldInfo } : i
        )
      );
      setSellTarget(null);
      onSyncStateChange();
      onToast(
        res.queued
          ? 'Sale saved offline — will sync automatically when back online.'
          : sellForm.payment_mode === 'EMI'
            ? `EMI sale recorded for ${sellTarget.item_name}.`
            : `Sale recorded for ${sellTarget.item_name}.`,
        'success'
      );
    } catch (err) {
      onToast(err.message || 'Could not record sale.', 'error');
    } finally {
      setSellBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await apiRequest(`/api/inventory/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' });
      setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
      setDeleteTarget(null);
      onToast('Item removed from inventory.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not delete item while offline.', 'error');
    } finally {
      setDeleteBusy(false);
    }
  };

  const statusBadge = (s) => {
    if (s === 'In Stock') return 'badge-green';
    if (s === 'Reserved') return 'badge-amber';
    return 'badge-neutral';
  };

  const sellTotal =
    Number(sellForm.selling_price || 0) * Math.max(1, Number(sellForm.quantity_sold || 1));
  const sellPaid = sellForm.payment_mode === 'EMI' ? Number(sellForm.amount_paid || 0) : sellTotal;
  const sellBalanceDue = Math.max(0, Number((sellTotal - sellPaid).toFixed(2)));
  const sellProfit = sellTarget
    ? Number(
        ((Number(sellForm.selling_price || 0) - Number(sellTarget.purchase_cost)) *
          Math.max(1, Number(sellForm.quantity_sold || 1))).toFixed(2)
      )
    : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Search & Filters */}
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="filter-bar" style={{ justifyContent: 'space-between' }}>
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <Search
              size={16}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 13, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 38 }}
              type="search"
              placeholder="Search SKU (e.g. 52-1), series, name, color, fabric, size..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="segmented" aria-label="View mode">
              <button
                type="button"
                className={`segmented-btn ${viewMode === 'grid' ? 'active' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                <Grid size={15} />
                <span>Cards</span>
              </button>
              <button
                type="button"
                className={`segmented-btn ${viewMode === 'table' ? 'active' : ''}`}
                onClick={() => setViewMode('table')}
              >
                <List size={15} />
                <span>Table</span>
              </button>
            </div>
          </div>
        </div>

        <div className="filter-bar">
          <select
            className="select"
            style={{ width: 'auto', minWidth: 126 }}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value="All">All Statuses</option>
            {INVENTORY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 134 }}
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by type"
          >
            <option value="All">All Types</option>
            {CLOTHING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 138 }}
            value={subType}
            onChange={(e) => setSubType(e.target.value)}
            aria-label="Filter by sub-type"
          >
            <option value="All">All Sub-Types</option>
            {dynamicSubTypes.map((st) => (
              <option key={st} value={st}>
                {st}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 126 }}
            value={color}
            onChange={(e) => setColor(e.target.value)}
            aria-label="Filter by color"
          >
            <option value="All">All Colors</option>
            {dynamicColors.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 132 }}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            aria-label="Filter by pattern"
          >
            <option value="All">All Patterns</option>
            {PATTERN_PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <input
            className="input"
            style={{ width: 112 }}
            type="number"
            min="0"
            placeholder="Min ₹"
            value={minPrice}
            onChange={(e) => setMinPrice(e.target.value)}
            aria-label="Minimum selling price"
          />
          <input
            className="input"
            style={{ width: 112 }}
            type="number"
            min="0"
            placeholder="Max ₹"
            value={maxPrice}
            onChange={(e) => setMaxPrice(e.target.value)}
            aria-label="Maximum selling price"
          />

          <select
            className="select"
            style={{ width: 'auto', minWidth: 162 }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            aria-label="Sort items"
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="price-asc">Price Low–High</option>
            <option value="price-desc">Price High–Low</option>
            <option value="margin-desc">Highest Profit Margin</option>
          </select>

          {hasActiveFilters && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>
              <RotateCcw size={14} />
              <span>Clear All</span>
            </button>
          )}
        </div>

        <div style={{ fontSize: 13, color: 'var(--text-muted)' }} className="tabular">
          Showing <strong>{filteredItems.length}</strong> of {items.length} item(s)
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="inventory-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 320 }} />
          ))}
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="card">
          <div className="empty-state">
            <div className="empty-icon">
              <Package size={24} />
            </div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {items.length === 0 ? 'Your boutique inventory is empty' : 'No items match your filters'}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', maxWidth: 380 }}>
              {items.length === 0
                ? 'Start cataloging sarees, dresses, and other boutique items with custom SKUs or series (like 52-1, 52-2).'
                : 'Try adjusting your search keywords, category, or price range.'}
            </div>
            <div style={{ marginTop: 6, display: 'flex', gap: 10 }}>
              {items.length === 0 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => navigate('/inventory/new')}
                >
                  <Plus size={16} />
                  <span>Add First Item</span>
                </button>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={clearFilters}>
                  Clear All Filters
                </button>
              )}
            </div>
          </div>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="inventory-grid">
          {filteredItems.map((item) => {
            const margin = calculateMarginPercent(item.purchase_cost, item.selling_price);
            const isSoldOut = item.status === 'Sold' || Number(item.quantity) <= 0;
            const soldInfo = item.sold_info;

            return (
              <article
                key={item.id}
                className={`product-card ${isSoldOut ? 'is-sold-out' : ''}`}
                tabIndex={isSoldOut ? 0 : undefined}
              >
                {isSoldOut && (
                  <div className="sold-hover-details" role="region" aria-label="Sold out details">
                    <div
                      style={{
                        fontWeight: 800,
                        fontSize: 12,
                        color: 'var(--amber)',
                        marginBottom: 4
                      }}
                    >
                      SOLD OUT SUMMARY
                    </div>
                    <div className="sold-hover-row">
                      <span className="sold-hover-label">Sold On</span>
                      <span className="sold-hover-val tabular">
                        {soldInfo?.sale_date || item.selling_date || '—'}
                      </span>
                    </div>
                    <div className="sold-hover-row">
                      <span className="sold-hover-label">Sold To</span>
                      <span className="sold-hover-val">
                        {soldInfo?.customer_name || 'Walk-in Customer'}
                        {soldInfo?.customer_phone ? ` (${soldInfo.customer_phone})` : ''}
                      </span>
                    </div>
                    {soldInfo?.selling_price !== undefined && (
                      <div className="sold-hover-row">
                        <span className="sold-hover-label">Sold At</span>
                        <span className="sold-hover-val tabular">
                          {formatINR(soldInfo.selling_price, currency)}
                          {soldInfo.payment_mode ? ` · ${soldInfo.payment_mode}` : ''}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="product-thumb">
                  {item.thumbnail_data_url ? (
                    <img src={item.thumbnail_data_url} alt={item.item_name} loading="lazy" />
                  ) : (
                    <ImageIcon size={34} color="var(--text-muted)" />
                  )}
                  <div className="product-thumb-badges">
                    <span className={`badge ${statusBadge(item.status)}`}>
                      {isSoldOut ? 'Sold Out' : item.status}
                    </span>
                    {item._pendingSync && <span className="badge badge-blue">Pending Sync</span>}
                  </div>
                </div>

                <div className="product-body">
                  <div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>
                      SKU: {item.sku} · Qty {item.quantity}
                      {item.size ? ` · ${item.size}` : ''}
                    </div>
                    <h3 className="product-title">{item.item_name}</h3>
                  </div>

                  <div className="product-meta">
                    <span className="badge badge-violet">{item.type}</span>
                    {item.sub_type && <span className="badge badge-neutral">{item.sub_type}</span>}
                    {item.color && <span className="badge badge-neutral">{item.color}</span>}
                    {item.pattern && <span className="badge badge-neutral">{item.pattern}</span>}
                  </div>

                  <div className="product-pricing tabular">
                    <div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Selling Price</div>
                      <div style={{ fontSize: 18, fontWeight: 800 }}>
                        {formatINR(item.selling_price, currency)}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Cost {formatINR(item.purchase_cost, currency)}
                      </div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--emerald)' }}>
                        {margin}% margin
                      </div>
                    </div>
                  </div>

                  <div className="product-actions">
                    <button
                      type="button"
                      className="btn btn-emerald btn-sm"
                      style={{ flex: 1 }}
                      disabled={isSoldOut}
                      onClick={() => openSellModal(item)}
                    >
                      <CheckCircle2 size={14} />
                      <span>{isSoldOut ? 'Sold Out' : 'Mark Sold'}</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-icon"
                      title="Edit item"
                      aria-label={`Edit ${item.item_name}`}
                      onClick={() => navigate(`/inventory/${item.id}/edit`)}
                    >
                      <Edit3 size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-icon"
                      title="Duplicate item"
                      aria-label={`Duplicate ${item.item_name}`}
                      onClick={() => onDuplicate(item)}
                    >
                      <Copy size={15} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-icon"
                      title="Delete item"
                      aria-label={`Delete ${item.item_name}`}
                      onClick={() => setDeleteTarget(item)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th>Color / Size</th>
                  <th>Qty</th>
                  <th>Cost</th>
                  <th>Price</th>
                  <th>Margin</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const margin = calculateMarginPercent(item.purchase_cost, item.selling_price);
                  const isSoldOut = item.status === 'Sold' || Number(item.quantity) <= 0;
                  return (
                    <tr key={item.id}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: 8,
                              background: 'var(--bg-subtle)',
                              overflow: 'hidden',
                              display: 'grid',
                              placeItems: 'center',
                              flexShrink: 0
                            }}
                          >
                            {item.thumbnail_data_url ? (
                              <img
                                src={item.thumbnail_data_url}
                                alt=""
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            ) : (
                              <ImageIcon size={16} color="var(--text-muted)" />
                            )}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600 }}>{item.item_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.sku}</div>
                            {isSoldOut && item.sold_info && (
                              <div style={{ fontSize: 11.5, color: 'var(--amber)' }}>
                                Sold {item.sold_info.sale_date} to {item.sold_info.customer_name}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td>
                        <div>{item.type}</div>
                        {item.sub_type && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.sub_type}</div>
                        )}
                      </td>
                      <td>
                        <div>{item.color || '—'}</div>
                        {item.size && (
                          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.size}</div>
                        )}
                      </td>
                      <td className="tabular">{item.quantity}</td>
                      <td className="tabular">{formatINR(item.purchase_cost, currency)}</td>
                      <td className="tabular" style={{ fontWeight: 700 }}>
                        {formatINR(item.selling_price, currency)}
                      </td>
                      <td className="tabular" style={{ color: 'var(--emerald)', fontWeight: 600 }}>
                        {margin}%
                      </td>
                      <td>
                        <span className={`badge ${statusBadge(item.status)}`}>
                          {isSoldOut ? 'Sold Out' : item.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button
                            type="button"
                            className="btn btn-emerald btn-sm"
                            disabled={isSoldOut}
                            onClick={() => openSellModal(item)}
                          >
                            Sell
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-icon"
                            onClick={() => navigate(`/inventory/${item.id}/edit`)}
                            aria-label="Edit"
                          >
                            <Edit3 size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-icon"
                            onClick={() => onDuplicate(item)}
                            aria-label="Duplicate"
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-icon"
                            onClick={() => setDeleteTarget(item)}
                            aria-label="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Mark as Sold & EMI Modal */}
      <Modal
        open={Boolean(sellTarget)}
        title={`Record Sale — ${sellTarget?.item_name || ''}`}
        onClose={() => setSellTarget(null)}
      >
        {sellTarget && (
          <form onSubmit={handleConfirmSell} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div
              style={{
                padding: '10px 13px',
                borderRadius: 11,
                background: 'var(--bg-subtle)',
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between'
              }}
              className="tabular"
            >
              <span>
                SKU: <strong>{sellTarget.sku}</strong>
              </span>
              <span>
                Available: <strong>{sellTarget.quantity}</strong> · Cost:{' '}
                <strong>{formatINR(sellTarget.purchase_cost, currency)}</strong>
              </span>
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="sell-qty">
                  Quantity Sold
                </label>
                <input
                  id="sell-qty"
                  className="input"
                  type="number"
                  min="1"
                  max={sellTarget.quantity}
                  required
                  value={sellForm.quantity_sold}
                  onChange={(e) => {
                    const nextQty = e.target.value;
                    const nextTotal =
                      Number(sellForm.selling_price || 0) * Math.max(1, Number(nextQty || 1));
                    setSellForm((f) => ({
                      ...f,
                      quantity_sold: nextQty,
                      amount_paid: f.payment_mode === 'EMI' ? f.amount_paid : String(nextTotal)
                    }));
                  }}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="sell-price">
                  Unit Selling Price ({currency})
                </label>
                <input
                  id="sell-price"
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={sellForm.selling_price}
                  onChange={(e) => {
                    const nextPrice = e.target.value;
                    const nextTotal =
                      Number(nextPrice || 0) * Math.max(1, Number(sellForm.quantity_sold || 1));
                    setSellForm((f) => ({
                      ...f,
                      selling_price: nextPrice,
                      amount_paid: f.payment_mode === 'EMI' ? f.amount_paid : String(nextTotal)
                    }));
                  }}
                />
              </div>
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="sell-date">
                  Sale Date
                </label>
                <input
                  id="sell-date"
                  className="input"
                  type="date"
                  required
                  value={sellForm.sale_date}
                  onChange={(e) => setSellForm((f) => ({ ...f, sale_date: e.target.value }))}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="sell-mode">
                  Payment Mode
                </label>
                <select
                  id="sell-mode"
                  className="select"
                  value={sellForm.payment_mode}
                  onChange={(e) => handlePaymentModeChange(e.target.value)}
                >
                  {PAYMENT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {sellForm.payment_mode === 'EMI' && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: 'var(--amber-soft)',
                  border: '1px solid rgba(217, 119, 6, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--amber)' }}>
                  EMI / Partial Installment Plan (Total: {formatINR(sellTotal, currency)})
                </div>
                <div className="form-grid-2">
                  <div className="field">
                    <label className="field-label" htmlFor="sell-paid">
                      Paid Today ({currency})
                    </label>
                    <input
                      id="sell-paid"
                      className="input"
                      type="number"
                      step="0.01"
                      min="0"
                      max={sellTotal}
                      placeholder="e.g. 500"
                      value={sellForm.amount_paid}
                      onChange={(e) => setSellForm((f) => ({ ...f, amount_paid: e.target.value }))}
                    />
                  </div>

                  <div className="field">
                    <label className="field-label" htmlFor="sell-due-date">
                      Next Installment Date
                    </label>
                    <input
                      id="sell-due-date"
                      className="input"
                      type="date"
                      value={sellForm.next_due_date}
                      onChange={(e) => setSellForm((f) => ({ ...f, next_due_date: e.target.value }))}
                    />
                  </div>
                </div>
                <div
                  style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--text-primary)' }}
                  className="tabular"
                >
                  Remaining Balance Due: {formatINR(sellBalanceDue, currency)}
                </div>
              </div>
            )}

            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="sell-customer">
                  Customer Name {sellForm.payment_mode === 'EMI' ? '(Recommended)' : ''}
                </label>
                <input
                  id="sell-customer"
                  className="input"
                  type="text"
                  placeholder="Customer name"
                  value={sellForm.customer_name}
                  onChange={(e) => setSellForm((f) => ({ ...f, customer_name: e.target.value }))}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="sell-phone">
                  Customer Phone
                </label>
                <input
                  id="sell-phone"
                  className="input"
                  type="tel"
                  placeholder="Mobile number"
                  value={sellForm.customer_phone}
                  onChange={(e) => setSellForm((f) => ({ ...f, customer_phone: e.target.value }))}
                />
              </div>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="sell-notes">
                Notes / Schedule
              </label>
              <input
                id="sell-notes"
                className="input"
                type="text"
                placeholder="e.g. ₹500 today, ₹1000 next week, ₹500 next month"
                value={sellForm.notes}
                onChange={(e) => setSellForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>

            <div
              style={{
                padding: '10px 13px',
                borderRadius: 11,
                background: 'var(--emerald-soft)',
                color: 'var(--emerald)',
                fontWeight: 700,
                fontSize: 13,
                display: 'flex',
                justifyContent: 'space-between'
              }}
              className="tabular"
            >
              <span>Total Order: {formatINR(sellTotal, currency)}</span>
              <span>Est. Profit: {formatINR(sellProfit, currency)}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSellTarget(null)}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn-emerald" disabled={sellBusy}>
                {sellBusy ? 'Recording...' : 'Confirm Sale'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(deleteTarget)}
        title="Delete Inventory Item"
        onClose={() => setDeleteTarget(null)}
        maxWidth={420}
      >
        <p style={{ marginTop: 0, color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
          Are you sure you want to delete <strong>{deleteTarget?.item_name}</strong> (
          <span className="tabular">{deleteTarget?.sku}</span>)? Existing sales history will remain
          in your Sales Ledger.
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setDeleteTarget(null)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={deleteBusy}
            onClick={handleDelete}
          >
            {deleteBusy ? 'Deleting...' : 'Delete Item'}
          </button>
        </div>
      </Modal>
    </div>
  );
}
