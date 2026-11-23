import React, { useEffect, useState } from 'react';
import { BarChart3, Layers, Palette, Sparkles, TrendingUp } from 'lucide-react';
import { RevenueProfitTrendChart } from '../components/Charts.jsx';
import { formatINR } from '../shared/constants.js';
import { fetchAnalyticsCached } from '../offline/sync.js';

function TopRankingCard({ title, subtitle, icon: Icon, rows, currency, emptyText }) {
  const maxUnits = Math.max(1, ...rows.map((r) => Number(r.units) || 0));

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h3 className="card-title">{title}</h3>
          <p className="card-subtitle">{subtitle}</p>
        </div>
        <div className="kpi-icon">
          <Icon size={17} />
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ padding: '22px 8px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map((row) => {
            const pct = Math.max(8, Math.round((row.units / maxUnits) * 100));
            return (
              <div key={row.label}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 13,
                    marginBottom: 4
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{row.label}</span>
                  <span className="tabular" style={{ color: 'var(--text-secondary)' }}>
                    {row.units} sold · <strong>{formatINR(row.profit, currency)}</strong>
                  </span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    background: 'var(--bg-subtle)',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${pct}%`,
                      borderRadius: 999,
                      background: 'var(--accent)'
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function AnalyticsPage({ user, refreshKey }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const currency = user?.currency_symbol || '₹';

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchAnalyticsCached(user.id)
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user.id, refreshKey]);

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div className="skeleton" style={{ height: 300 }} />
        <div className="skeleton" style={{ height: 220 }} />
      </div>
    );
  }

  const trend30d = data?.trend30d || [];
  const categories = data?.categoryProfitability || [];
  const topSubTypes = data?.topSubTypes || [];
  const topColors = data?.topColors || [];
  const topPatterns = data?.topPatterns || [];
  const monthlySummary = data?.monthlySummary || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 30-Day Revenue & Profit Trend */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">30-Day Revenue &amp; Net Profit Trend</h2>
            <p className="card-subtitle">Daily trajectory across all recorded sales</p>
          </div>
          <div className="kpi-icon" style={{ color: 'var(--emerald)' }}>
            <TrendingUp size={18} />
          </div>
        </div>
        <RevenueProfitTrendChart data={trend30d} currency={currency} />
      </section>

      {/* Category Profitability Breakdown */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Category Profitability Breakdown</h2>
            <p className="card-subtitle">Ranked by total net profit and margin percentage</p>
          </div>
          <div className="kpi-icon">
            <BarChart3 size={18} />
          </div>
        </div>

        {categories.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">
              <BarChart3 size={22} />
            </div>
            <div style={{ fontWeight: 600 }}>No category profit data yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Record sales to compare margins across sarees, kurtis, lehengas, and dress materials.
            </div>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Clothing Type</th>
                  <th>Units Sold</th>
                  <th>Revenue</th>
                  <th>COGS</th>
                  <th>Net Profit</th>
                  <th style={{ textAlign: 'right' }}>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.type}>
                    <td style={{ fontWeight: 700 }}>{cat.type}</td>
                    <td className="tabular">{cat.units}</td>
                    <td className="tabular">{formatINR(cat.revenue, currency)}</td>
                    <td className="tabular">{formatINR(cat.cogs, currency)}</td>
                    <td
                      className="tabular"
                      style={{
                        fontWeight: 700,
                        color: cat.profit >= 0 ? 'var(--emerald)' : 'var(--danger)'
                      }}
                    >
                      {formatINR(cat.profit, currency)}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <span
                        className={`badge tabular ${cat.margin >= 25 ? 'badge-green' : 'badge-violet'}`}
                      >
                        {cat.margin}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Top Sub-types, Colors & Patterns */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 18
        }}
      >
        <TopRankingCard
          title="Top Sub-Types"
          subtitle="Best-selling weaves & styles"
          icon={Layers}
          rows={topSubTypes}
          currency={currency}
          emptyText="Sub-type winners (Kanjeevaram, Banarasi, Cotton...) appear after sales."
        />
        <TopRankingCard
          title="Top Colors"
          subtitle="Most requested shades"
          icon={Palette}
          rows={topColors}
          currency={currency}
          emptyText="Color preferences appear once items are sold."
        />
        <TopRankingCard
          title="Top Patterns"
          subtitle="High-demand border & print styles"
          icon={Sparkles}
          rows={topPatterns}
          currency={currency}
          emptyText="Pattern trends (Zari Border, Floral, Bandhani...) appear after sales."
        />
      </div>

      {/* Monthly Summary Table */}
      <section className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Monthly Performance Summary</h2>
            <p className="card-subtitle">Aggregated monthly ledger</p>
          </div>
        </div>

        {monthlySummary.length === 0 ? (
          <div style={{ padding: '24px 8px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            Monthly summaries will automatically populate as soon as you record your first sale.
          </div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Units Sold</th>
                  <th>Revenue</th>
                  <th>Cost</th>
                  <th>Net Profit</th>
                  <th style={{ textAlign: 'right' }}>Margin %</th>
                </tr>
              </thead>
              <tbody>
                {monthlySummary.map((m) => (
                  <tr key={m.month}>
                    <td className="tabular" style={{ fontWeight: 700 }}>
                      {m.month}
                    </td>
                    <td className="tabular">{m.units_sold}</td>
                    <td className="tabular">{formatINR(m.revenue, currency)}</td>
                    <td className="tabular">{formatINR(m.cogs, currency)}</td>
                    <td
                      className="tabular"
                      style={{
                        fontWeight: 700,
                        color: m.net_profit >= 0 ? 'var(--emerald)' : 'var(--danger)'
                      }}
                    >
                      {formatINR(m.net_profit, currency)}
                    </td>
                    <td className="tabular" style={{ textAlign: 'right', fontWeight: 700 }}>
                      {m.margin_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
