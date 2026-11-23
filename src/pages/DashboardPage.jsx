import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  IndianRupee,
  Package,
  Plus,
  Receipt,
  RotateCcw,
  TrendingUp,
  Wallet
} from 'lucide-react';
import { DonutChart, RevenueProfitBarChart } from '../components/Charts.jsx';
import {
  CLOTHING_TYPES,
  formatINR,
  PAYMENT_MODES,
  PERIOD_OPTIONS
} from '../shared/constants.js';
import { apiRequest } from '../offline/sync.js';

export default function DashboardPage({ user, onPeriodChange, navigate, refreshKey }) {
  const [period, setPeriod] = useState(user?.selected_period || 'all-time');
  const [slicerType, setSlicerType] = useState('All');
  const [slicerPayment, setSlicerPayment] = useState('All');
  const [slicerStock, setSlicerStock] = useState('all');
  const [chartWindow, setChartWindow] = useState('7d');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPeriod(user?.selected_period || 'all-time');
  }, [user?.selected_period]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = new URLSearchParams({ period });
    if (slicerType !== 'All') params.set('type', slicerType);
    if (slicerPayment !== 'All') params.set('payment_mode', slicerPayment);
    if (slicerStock !== 'all') params.set('stock_status', slicerStock);

    apiRequest(`/api/dashboard?${params.toString()}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user.id, period, slicerType, slicerPayment, slicerStock, refreshKey]);

  const handleSelectPeriod = async (nextPeriod) => {
    setPeriod(nextPeriod);
    await onPeriodChange(nextPeriod);
  };

  const hasSlicers = slicerType !== 'All' || slicerPayment !== 'All' || slicerStock !== 'all';
  const resetSlicers = () => {
    setSlicerType('All');
    setSlicerPayment('All');
    setSlicerStock('all');
  };

  const currency = user?.currency_symbol || '₹';

  if (loading && !data) {
    return (
      <div>
        <div className="kpi-grid">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="skeleton" style={{ height: 126 }} />
          ))}
        </div>
        <div className="charts-grid">
          <div className="skeleton" style={{ height: 300 }} />
          <div className="skeleton" style={{ height: 300 }} />
          <div className="skeleton" style={{ height: 300 }} />
        </div>
      </div>
    );
  }

  const kpis = data?.kpis || {
    totalStockQty: 0,
    totalUniqueSkus: 0,
    totalInventoryValue: 0,
    totalRevenue: 0,
    totalCogs: 0,
    totalProfit: 0,
    profitMargin: 0,
    salesCount: 0,
    unitsSold: 0,
    totalEmiReceivable: 0
  };
  const charts = data?.charts || {
    revenueProfit7d: [],
    revenueProfit30d: [],
    stockByType: [],
    salesByPaymentMode: []
  };
  const recentSales = data?.recentSales || [];
  const agingStock = data?.agingStock || [];
  const barSeries = chartWindow === '30d' ? charts.revenueProfit30d : charts.revenueProfit7d;

  return (
    <div>
      {/* Period & Slicers Bar */}
      <div className="slicer-bar">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            color: 'var(--text-secondary)',
            fontSize: 13
          }}
        >
          <Calendar size={16} color="var(--accent)" />
          <span>Showing revenue &amp; profit metrics for:</span>
        </div>

        <div className="slicer-controls">
          <select
            className="select"
            aria-label="Global date period"
            style={{ width: 'auto', minWidth: 155, padding: '8px 12px' }}
            value={period}
            onChange={(e) => handleSelectPeriod(e.target.value)}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <select
            className="select"
            aria-label="Category slicer"
            style={{ width: 'auto', minWidth: 140, padding: '8px 12px' }}
            value={slicerType}
            onChange={(e) => setSlicerType(e.target.value)}
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
            aria-label="Payment mode slicer"
            style={{ width: 'auto', minWidth: 140, padding: '8px 12px' }}
            value={slicerPayment}
            onChange={(e) => setSlicerPayment(e.target.value)}
          >
            <option value="All">All Payments</option>
            {PAYMENT_MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>

          <select
            className="select"
            aria-label="Stock slicer"
            style={{ width: 'auto', minWidth: 132, padding: '8px 12px' }}
            value={slicerStock}
            onChange={(e) => setSlicerStock(e.target.value)}
          >
            <option value="all">All Stock</option>
            <option value="in-stock">In Stock</option>
            <option value="low-stock">Low Stock (≤ 2)</option>
            <option value="aging">Aging (&gt; 60d)</option>
          </select>

          {hasSlicers && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={resetSlicers}>
              <RotateCcw size={13} />
              <span>Reset</span>
            </button>
          )}
        </div>
      </div>

      {/* 4 KPI Summary Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Items In Stock</span>
            <div className="kpi-icon">
              <Package size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{kpis.totalStockQty.toLocaleString('en-IN')}</div>
          <div className="kpi-foot tabular">
            <span>{kpis.totalUniqueSkus} unique SKUs available</span>
          </div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Inventory Value (Cost)</span>
            <div className="kpi-icon" style={{ color: 'var(--blue)' }}>
              <Wallet size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{formatINR(kpis.totalInventoryValue, currency)}</div>
          <div className="kpi-foot">At purchase cost across in-stock pieces</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-top">
            <span className="kpi-label">Total Revenue</span>
            <div className="kpi-icon" style={{ color: 'var(--emerald)' }}>
              <IndianRupee size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{formatINR(kpis.totalRevenue, currency)}</div>
          <div className="kpi-foot tabular">
            {kpis.salesCount > 0
              ? `${kpis.unitsSold} unit(s) across ${kpis.salesCount} sale(s)`
              : 'No sales in selected period'}
          </div>
        </div>

        <div className="kpi-card hero">
          <div className="kpi-top">
            <span className="kpi-label">Total Net Profit</span>
            <div className="kpi-icon">
              <TrendingUp size={18} />
            </div>
          </div>
          <div className="kpi-value tabular">{formatINR(kpis.totalProfit, currency)}</div>
          <div className="kpi-foot tabular">
            {kpis.totalRevenue > 0 ? (
              <span>
                Margin: <strong>{kpis.profitMargin}%</strong> · COGS{' '}
                {formatINR(kpis.totalCogs, currency)}
              </span>
            ) : (
              <span>Selling price minus purchase cost</span>
            )}
          </div>
        </div>
      </div>

      {/* 3 Responsive SVG Charts */}
      <div className="charts-grid">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Revenue vs. Net Profit</h2>
              <p className="card-subtitle">Daily sales performance</p>
            </div>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-btn ${chartWindow === '7d' ? 'active' : ''}`}
                onClick={() => setChartWindow('7d')}
              >
                7 Days
              </button>
              <button
                type="button"
                className={`segmented-btn ${chartWindow === '30d' ? 'active' : ''}`}
                onClick={() => setChartWindow('30d')}
              >
                30 Days
              </button>
            </div>
          </div>
          <RevenueProfitBarChart data={barSeries} currency={currency} />
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Stock Value by Type</h2>
              <p className="card-subtitle">In-stock purchase cost</p>
            </div>
          </div>
          <DonutChart
            data={charts.stockByType}
            currency={currency}
            emptyTitle="No stock cataloged yet"
            emptyHint="Add sarees, kurtis, or lehengas to see category value."
          />
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Sales by Payment Mode</h2>
              <p className="card-subtitle">Selected period breakdown</p>
            </div>
          </div>
          <DonutChart
            data={charts.salesByPaymentMode}
            currency={currency}
            emptyTitle="No sales recorded yet"
            emptyHint="UPI, Cash, Card, Bank Transfer, and EMI shares appear here."
          />
        </div>
      </div>

      {/* Quick Panels: Recent Sales & Aging Stock */}
      <div className="two-col-grid">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Sales</h2>
              <p className="card-subtitle">Last 5 recorded transactions</p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => navigate('/sales')}
            >
              View Ledger
            </button>
          </div>

          {recentSales.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <Receipt size={22} />
              </div>
              <div style={{ fontWeight: 600 }}>No sales yet</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Add items to your boutique catalog and mark them as sold when a customer purchases.
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                style={{ marginTop: 4 }}
                onClick={() => navigate('/inventory/new')}
              >
                <Plus size={15} />
                <span>Add First Item</span>
              </button>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Date</th>
                    <th>Mode</th>
                    <th style={{ textAlign: 'right' }}>Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{s.item_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {s.sku} · Qty {s.quantity_sold}
                          {s.customer_name ? ` · ${s.customer_name}` : ''}
                        </div>
                      </td>
                      <td className="tabular" style={{ whiteSpace: 'nowrap' }}>
                        {s.sale_date}
                      </td>
                      <td>
                        <span className="badge badge-neutral">{s.payment_mode}</span>
                      </td>
                      <td
                        className="tabular"
                        style={{
                          textAlign: 'right',
                          fontWeight: 700,
                          color: Number(s.profit) >= 0 ? 'var(--emerald)' : 'var(--danger)'
                        }}
                      >
                        {formatINR(s.profit, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Aging Stock Alert</h2>
              <p className="card-subtitle">Items in stock for over 60 days</p>
            </div>
            <span className={`badge ${agingStock.length > 0 ? 'badge-amber' : 'badge-green'}`}>
              {agingStock.length} flagged
            </span>
          </div>

          {agingStock.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" style={{ color: 'var(--emerald)' }}>
                <AlertTriangle size={22} />
              </div>
              <div style={{ fontWeight: 600 }}>All stock is fresh</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Any in-stock garment older than 60 days from its purchase date will be highlighted
                here.
              </div>
            </div>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Cost</th>
                    <th style={{ textAlign: 'right' }}>Age</th>
                  </tr>
                </thead>
                <tbody>
                  {agingStock.map((item) => (
                    <tr key={item.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{item.item_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {item.sku} · {item.type}
                        </div>
                      </td>
                      <td className="tabular">{item.quantity}</td>
                      <td className="tabular">{formatINR(item.purchase_cost, currency)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <span className="badge badge-amber tabular">{item.age_days}d</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
