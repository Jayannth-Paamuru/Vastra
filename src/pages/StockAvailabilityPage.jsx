import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Layers, Package, RotateCcw, Search } from 'lucide-react';
import { CLOTHING_TYPES } from '../shared/constants.js';
import { fetchInventoryCached, fetchSalesCached } from '../offline/sync.js';

function extractSeriesKey(item) {
  if (item.series_code && String(item.series_code).trim()) {
    return String(item.series_code).trim();
  }
  const sku = String(item.sku || '').trim();
  const match = sku.match(/^(.+)-(\d+)$/);
  if (match) {
    return match[1];
  }
  return sku || item.item_name || 'Item';
}

export default function StockAvailabilityPage({ user, navigate, onToast, refreshKey }) {
  const [items, setItems] = useState([]);
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([fetchInventoryCached(user.id), fetchSalesCached(user.id)])
      .then(([invRes, salesRes]) => {
        if (!active) return;
        setItems(invRes.items || []);
        setSales(salesRes.sales || []);
      })
      .catch((err) => {
        if (active) onToast(err.message || 'Failed to load stock availability.', 'error');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user.id, refreshKey, onToast]);

  const seriesGroups = useMemo(() => {
    const soldQtyBySku = new Map();
    for (const s of sales) {
      const activeSold = Math.max(
        0,
        (Number(s.quantity_sold) || 0) - (Number(s.returned_qty) || 0)
      );
      if (s.sku) {
        soldQtyBySku.set(s.sku, (soldQtyBySku.get(s.sku) || 0) + activeSold);
      }
    }

    const groupsMap = new Map();

    for (const item of items) {
      if (typeFilter !== 'All' && item.type !== typeFilter) continue;

      const seriesKey = extractSeriesKey(item);
      const availQty = Math.max(0, Number(item.quantity) || 0);
      const recordedSold = soldQtyBySku.get(item.sku) || 0;
      const inferredSold =
        recordedSold > 0
          ? recordedSold
          : item.status === 'Sold' && availQty === 0
            ? 1
            : 0;
      const totalPieces = availQty + inferredSold;

      const cur = groupsMap.get(seriesKey) || {
        seriesKey,
        type: item.type || 'Sarees',
        subType: item.sub_type || '',
        totalCount: 0,
        availableCount: 0,
        soldCount: 0,
        availableSkus: [],
        soldSkus: []
      };

      cur.totalCount += totalPieces;
      cur.availableCount += availQty;
      cur.soldCount += inferredSold;

      if (availQty > 0 && item.sku) {
        cur.availableSkus.push(item.sku);
      } else if (inferredSold > 0 && item.sku) {
        cur.soldSkus.push(item.sku);
      }

      groupsMap.set(seriesKey, cur);
    }

    const q = search.trim().toLowerCase();
    const list = Array.from(groupsMap.values()).filter((g) => {
      if (!q) return true;
      return [g.seriesKey, g.type, g.subType, ...g.availableSkus, ...g.soldSkus]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });

    list.sort((a, b) => a.seriesKey.localeCompare(b.seriesKey, undefined, { numeric: true }));
    return list;
  }, [items, sales, typeFilter, search]);

  const totals = useMemo(() => {
    return seriesGroups.reduce(
      (acc, g) => {
        acc.seriesCount += 1;
        acc.totalPieces += g.totalCount;
        acc.availablePieces += g.availableCount;
        acc.soldPieces += g.soldCount;
        return acc;
      },
      { seriesCount: 0, totalPieces: 0, availablePieces: 0, soldPieces: 0 }
    );
  }, [seriesGroups]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/')}
        >
          <ArrowLeft size={15} />
          <span>Back to Dashboard</span>
        </button>

        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => navigate('/inventory')}
        >
          <span>Open Full Inventory</span>
        </button>
      </div>

      {/* Count Summary Strip */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">SKU / Series Groups</span>
            <div className="kpi-icon">
              <Layers size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{totals.seriesCount}</div>
          <div className="kpi-foot">Numbered series &amp; items</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Total Pieces</span>
            <div className="kpi-icon" style={{ color: 'var(--blue)' }}>
              <Package size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{totals.totalPieces}</div>
          <div className="kpi-foot">Available + sold count</div>
        </div>

        <div className="kpi-card hero">
          <div className="kpi-label">Available Now</div>
          <div className="kpi-value tabular" style={{ color: 'var(--emerald)' }}>
            {totals.availablePieces}
          </div>
          <div className="kpi-foot">Ready in stock</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Sold Count</div>
          <div className="kpi-value tabular" style={{ color: 'var(--amber)' }}>
            {totals.soldPieces}
          </div>
          <div className="kpi-foot">Pieces sold out</div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card">
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: '1 1 240px' }}>
            <Search
              size={15}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              className="input"
              style={{ paddingLeft: 36 }}
              type="search"
              placeholder="Search SKU or series number (e.g. 52, 52-1)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <select
            className="select"
            style={{ width: 'auto', minWidth: 140 }}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            aria-label="Filter by clothing type"
          >
            <option value="All">All Types</option>
            {CLOTHING_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>

          {(search || typeFilter !== 'All') && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setSearch('');
                setTypeFilter('All');
              }}
            >
              <RotateCcw size={14} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* Series Count Table */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 20 }}>
            <div className="skeleton" style={{ height: 220 }} />
          </div>
        ) : seriesGroups.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <Package size={24} />
            </div>
            <div style={{ fontWeight: 700 }}>No SKU series found</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Add inventory items or series (like 52-1, 52-2) to see availability counts.
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU / Series</th>
                  <th>Type</th>
                  <th>Total Pieces</th>
                  <th>Available</th>
                  <th>Sold</th>
                  <th>Available Numbers</th>
                </tr>
              </thead>
              <tbody>
                {seriesGroups.map((g) => (
                  <tr key={g.seriesKey}>
                    <td>
                      <div style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
                        {g.seriesKey}
                      </div>
                      {g.subType && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{g.subType}</div>
                      )}
                    </td>
                    <td>
                      <span className="badge badge-violet">{g.type}</span>
                    </td>
                    <td className="tabular" style={{ fontWeight: 700 }}>
                      {g.totalCount}
                    </td>
                    <td className="tabular">
                      <span className="badge badge-green">{g.availableCount} available</span>
                    </td>
                    <td className="tabular">
                      <span className="badge badge-amber">{g.soldCount} sold</span>
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12.5 }}>
                      {g.availableSkus.length > 0 ? g.availableSkus.join(', ') : 'None'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
