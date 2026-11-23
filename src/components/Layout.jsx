import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  Wifi,
  WifiOff
} from 'lucide-react';

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/inventory', label: 'Inventory', icon: Package },
  { path: '/sales', label: 'Sales Ledger', icon: Receipt },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/settings', label: 'Settings', icon: Settings }
];

function getPageTitle(pathname) {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/inventory') return 'Inventory';
  if (pathname === '/inventory/new') return 'Add New Item';
  if (/^\/inventory\/[^/]+\/edit$/.test(pathname)) return 'Edit Item';
  if (pathname === '/sales') return 'Sales Ledger';
  if (pathname === '/analytics') return 'Analytics';
  if (pathname === '/settings') return 'Settings';
  return 'VastraLedger';
}

export default function Layout({
  user,
  pathname,
  navigate,
  isOnline,
  pendingCount = 0,
  syncing = false,
  onSyncNow,
  canInstall = false,
  isStandalone = false,
  isIOS = false,
  onInstallApp,
  onExport,
  children
}) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  useEffect(() => {
    if (!exportOpen) return undefined;
    const onClickOutside = (e) => {
      if (exportRef.current && !exportRef.current.contains(e.target)) {
        setExportOpen(false);
      }
    };
    window.addEventListener('mousedown', onClickOutside);
    return () => window.removeEventListener('mousedown', onClickOutside);
  }, [exportOpen]);

  const isActive = (navPath) => {
    if (navPath === '/') return pathname === '/';
    return pathname === navPath || pathname.startsWith(`${navPath}/`);
  };

  const title = getPageTitle(pathname);
  const storeName = user?.business_name || 'VastraLedger';

  return (
    <div className="app-shell">
      {/* Desktop Fixed Sidebar */}
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="sidebar-brand">
          <div className="brand-mark">V</div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontWeight: 800,
                fontSize: 15,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap'
              }}
            >
              {storeName}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Boutique Manager</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                type="button"
                className={`nav-link ${active ? 'active' : ''}`}
                aria-current={active ? 'page' : undefined}
                onClick={() => navigate(item.path)}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div
          style={{
            marginTop: 'auto',
            paddingTop: 14,
            borderTop: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text-muted)'
          }}
        >
          <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{user?.full_name}</div>
          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email || user?.phone}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.01em' }}>
              {title}
            </h1>
          </div>

          <div className="topbar-actions">
            {/* Online / Offline Sync Pill */}
            <button
              type="button"
              className={`badge ${
                !isOnline ? 'badge-amber' : pendingCount > 0 ? 'badge-blue' : 'badge-green'
              }`}
              style={{ border: 'none', cursor: isOnline ? 'pointer' : 'default', minHeight: 34, padding: '0 11px' }}
              title={isOnline ? 'Click to sync now' : 'Offline mode active'}
              onClick={() => isOnline && onSyncNow?.()}
            >
              {syncing ? (
                <RefreshCw size={13} className="spin" />
              ) : isOnline ? (
                <Wifi size={13} />
              ) : (
                <WifiOff size={13} />
              )}
              <span className="tabular">
                {syncing
                  ? 'Syncing...'
                  : !isOnline
                    ? pendingCount > 0
                      ? `Offline (${pendingCount})`
                      : 'Offline'
                    : pendingCount > 0
                      ? `Sync (${pendingCount})`
                      : 'Synced'}
              </span>
            </button>

            {/* Install App CTA when installable */}
            {!isStandalone && (canInstall || isIOS) && (
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={onInstallApp}
              >
                <Download size={14} />
                <span>Install App</span>
              </button>
            )}

            {/* Export Menu */}
            <div className="dropdown" ref={exportRef}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                aria-expanded={exportOpen}
                aria-haspopup="menu"
                onClick={() => setExportOpen((v) => !v)}
              >
                <FileSpreadsheet size={14} />
                <span>Export</span>
                <ChevronDown size={14} />
              </button>

              {exportOpen && (
                <div className="dropdown-menu" role="menu">
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      onExport('full', 'xlsx');
                    }}
                  >
                    <FileSpreadsheet size={15} color="var(--accent)" />
                    <span>Complete Report (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      onExport('inventory', 'xlsx');
                    }}
                  >
                    <FileSpreadsheet size={15} color="var(--emerald)" />
                    <span>Inventory Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      onExport('inventory', 'csv');
                    }}
                  >
                    <FileText size={15} color="var(--text-secondary)" />
                    <span>Inventory CSV (.csv)</span>
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      onExport('sales', 'xlsx');
                    }}
                  >
                    <FileSpreadsheet size={15} color="var(--emerald)" />
                    <span>Sales Ledger Excel (.xlsx)</span>
                  </button>
                  <button
                    type="button"
                    className="dropdown-item"
                    role="menuitem"
                    onClick={() => {
                      setExportOpen(false);
                      onExport('sales', 'csv');
                    }}
                  >
                    <FileText size={15} color="var(--text-secondary)" />
                    <span>Sales Ledger CSV (.csv)</span>
                  </button>
                </div>
              )}
            </div>

            {/* Primary Add New Item CTA */}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/inventory/new')}
            >
              <Plus size={15} />
              <span>Add New Item</span>
            </button>
          </div>
        </header>

        <main className="page-content">{children}</main>
      </div>

      {/* Mobile Scrollable Bottom Navigation */}
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              type="button"
              className={`mobile-nav-item ${active ? 'active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} />
              <span>{item.label === 'Sales Ledger' ? 'Sales' : item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
