import React from 'react';
import { BarChart3, PieChart } from 'lucide-react';
import { formatINR } from '../shared/constants.js';

const CHART_PALETTE = [
  '#6558D3',
  '#16A34A',
  '#EA580C',
  '#2563EB',
  '#DB2777',
  '#0D9488',
  '#CA8A04',
  '#7C3AED'
];

function shortDateLabel(iso) {
  if (!iso || iso.length < 10) return '';
  const [, m, d] = iso.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(d)} ${months[Number(m) - 1] || ''}`;
}

export function RevenueProfitBarChart({ data = [], currency = '₹' }) {
  const hasValues = data.some((d) => Number(d.revenue) > 0 || Number(d.profit) !== 0);

  if (!hasValues) {
    return (
      <div className="empty-state" style={{ padding: '32px 12px' }}>
        <div className="empty-icon">
          <BarChart3 size={20} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>No sales in this window</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Daily revenue and net profit bars will appear here as you record sales.
        </div>
      </div>
    );
  }

  const width = 560;
  const height = 240;
  const pad = { top: 20, right: 16, bottom: 34, left: 56 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(Number(d.revenue) || 0, Math.abs(Number(d.profit) || 0)))
  );
  const niceMax = Math.ceil(maxVal / 100) * 100 || maxVal;

  const groupW = plotW / Math.max(1, data.length);
  const barGap = data.length > 14 ? 1 : 3;
  const barW = Math.max(3, Math.min(18, (groupW - barGap * 3) / 2));
  const labelStep = data.length > 14 ? 5 : 1;

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div style={{ display: 'flex', gap: 14, marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--accent)' }} />
          Revenue
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--emerald)' }} />
          Net Profit
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="Revenue versus Net Profit bar chart"
      >
        {ticks.map((t, idx) => {
          const y = pad.top + plotH - t * plotH;
          const val = Math.round(niceMax * t);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={idx === 0 ? undefined : '3 3'}
              />
              <text
                x={pad.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {val >= 1000 ? `${currency}${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `${currency}${val}`}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const rev = Math.max(0, Number(d.revenue) || 0);
          const prof = Math.max(0, Number(d.profit) || 0);
          const revH = (rev / niceMax) * plotH;
          const profH = (prof / niceMax) * plotH;
          const cx = pad.left + i * groupW + groupW / 2;

          return (
            <g key={d.date || i}>
              <rect
                x={cx - barW - barGap / 2}
                y={pad.top + plotH - revH}
                width={barW}
                height={Math.max(0, revH)}
                rx="3"
                fill="var(--accent)"
              >
                <title>
                  {d.date}: Revenue {formatINR(rev, currency)}
                </title>
              </rect>
              <rect
                x={cx + barGap / 2}
                y={pad.top + plotH - profH}
                width={barW}
                height={Math.max(0, profH)}
                rx="3"
                fill="var(--emerald)"
              >
                <title>
                  {d.date}: Profit {formatINR(d.profit, currency)}
                </title>
              </rect>

              {(i % labelStep === 0 || i === data.length - 1) && (
                <text
                  x={cx}
                  y={height - 10}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-muted)"
                >
                  {shortDateLabel(d.date)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function DonutChart({
  data = [],
  currency = '₹',
  emptyTitle = 'No data yet',
  emptyHint = 'Data will appear here once recorded.'
}) {
  const valid = data.filter((d) => Number(d.value) > 0);
  const total = valid.reduce((sum, d) => sum + Number(d.value), 0);

  if (valid.length === 0 || total <= 0) {
    return (
      <div className="empty-state" style={{ padding: '28px 10px' }}>
        <div className="empty-icon">
          <PieChart size={20} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{emptyTitle}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{emptyHint}</div>
      </div>
    );
  }

  const size = 190;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 66;
  const strokeWidth = 24;
  const circumference = 2 * Math.PI * radius;

  let cumulative = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'center' }}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        style={{ width: '100%', maxWidth: 190, height: 'auto', display: 'block' }}
        role="img"
        aria-label="Category distribution donut chart"
      >
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="var(--bg-subtle)"
          strokeWidth={strokeWidth}
        />
        {valid.map((slice, idx) => {
          const pct = Number(slice.value) / total;
          const dash = pct * circumference;
          const offset = -cumulative * circumference;
          cumulative += pct;
          const color = CHART_PALETTE[idx % CHART_PALETTE.length];

          return (
            <circle
              key={slice.label}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={offset}
              transform={`rotate(-90 ${cx} ${cy})`}
            >
              <title>
                {slice.label}: {formatINR(slice.value, currency)} ({Math.round(pct * 100)}%)
              </title>
            </circle>
          );
        })}

        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontWeight="600"
        >
          Total
        </text>
        <text
          x={cx}
          y={cy + 14}
          textAnchor="middle"
          fontSize="14"
          fill="var(--text-primary)"
          fontWeight="800"
        >
          {formatINR(total, currency)}
        </text>
      </svg>

      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 7 }}>
        {valid.slice(0, 6).map((slice, idx) => {
          const pct = Math.round((Number(slice.value) / total) * 100);
          const color = CHART_PALETTE[idx % CHART_PALETTE.length];
          return (
            <div
              key={slice.label}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: 12,
                gap: 8
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 3,
                    background: color,
                    flexShrink: 0
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {slice.label}
                </span>
              </span>
              <span className="tabular" style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                {formatINR(slice.value, currency)} ({pct}%)
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function RevenueProfitTrendChart({ data = [], currency = '₹' }) {
  const hasValues = data.some((d) => Number(d.revenue) > 0 || Number(d.profit) !== 0);

  if (!hasValues) {
    return (
      <div className="empty-state" style={{ padding: '32px 12px' }}>
        <div className="empty-icon">
          <BarChart3 size={20} />
        </div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>No 30-day sales trend yet</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Once sales are recorded, your 30-day revenue and profit curves will render here.
        </div>
      </div>
    );
  }

  const width = 760;
  const height = 250;
  const pad = { top: 20, right: 20, bottom: 34, left: 60 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const maxVal = Math.max(
    1,
    ...data.map((d) => Math.max(Number(d.revenue) || 0, Math.abs(Number(d.profit) || 0)))
  );
  const niceMax = Math.ceil(maxVal / 100) * 100 || maxVal;
  const stepX = plotW / Math.max(1, data.length - 1);

  const toPoints = (key) =>
    data.map((d, i) => {
      const val = Math.max(0, Number(d[key]) || 0);
      const x = pad.left + i * stepX;
      const y = pad.top + plotH - (val / niceMax) * plotH;
      return { x, y, val, date: d.date };
    });

  const revPts = toPoints('revenue');
  const profPts = toPoints('profit');

  const pathFrom = (pts) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');

  const areaFrom = (pts) => {
    if (pts.length === 0) return '';
    const baseY = pad.top + plotH;
    return `${pathFrom(pts)} L ${pts[pts.length - 1].x.toFixed(1)} ${baseY} L ${pts[0].x.toFixed(1)} ${baseY} Z`;
  };

  const ticks = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: 'var(--accent)' }} />
          Revenue
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 3, borderRadius: 2, background: 'var(--emerald)' }} />
          Net Profit
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
        role="img"
        aria-label="30-day revenue and net profit trend chart"
      >
        <defs>
          <linearGradient id="revAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((t, idx) => {
          const y = pad.top + plotH - t * plotH;
          const val = Math.round(niceMax * t);
          return (
            <g key={idx}>
              <line
                x1={pad.left}
                y1={y}
                x2={width - pad.right}
                y2={y}
                stroke="var(--border)"
                strokeDasharray={idx === 0 ? undefined : '3 3'}
              />
              <text
                x={pad.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {val >= 1000 ? `${currency}${(val / 1000).toFixed(val % 1000 === 0 ? 0 : 1)}k` : `${currency}${val}`}
              </text>
            </g>
          );
        })}

        <path d={areaFrom(revPts)} fill="url(#revAreaGrad)" />
        <path d={pathFrom(revPts)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={pathFrom(profPts)} fill="none" stroke="var(--emerald)" strokeWidth="2.5" strokeLinejoin="round" />

        {revPts.map((p, i) => (
          <g key={p.date || i}>
            {p.val > 0 && (
              <circle cx={p.x} cy={p.y} r="3.5" fill="var(--accent)">
                <title>
                  {p.date}: Revenue {formatINR(p.val, currency)}
                </title>
              </circle>
            )}
            {(i % 5 === 0 || i === revPts.length - 1) && (
              <text
                x={p.x}
                y={height - 10}
                textAnchor="middle"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {shortDateLabel(p.date)}
              </text>
            )}
          </g>
        ))}

        {profPts.map(
          (p, i) =>
            p.val > 0 && (
              <circle key={`p-${p.date || i}`} cx={p.x} cy={p.y} r="3.2" fill="var(--emerald)">
                <title>
                  {p.date}: Profit {formatINR(p.val, currency)}
                </title>
              </circle>
            )
        )}
      </svg>
    </div>
  );
}
