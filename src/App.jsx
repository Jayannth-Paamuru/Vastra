import React, { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  Package,
  Plus,
  Receipt,
  RefreshCw,
  Settings as SettingsIcon,
  Wallet,
  Wifi,
  WifiOff
} from 'lucide-react';
import AuthPage from './pages/AuthPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import InventoryPage from './pages/InventoryPage.jsx';
import ItemFormPage from './pages/ItemFormPage.jsx';
import SalesPage from './pages/SalesPage.jsx';
import ExpensesPage from './pages/ExpensesPage.jsx';
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import {
  apiRequest,
  downloadReportOfflineAware,
  getPendingSyncCount,
  replaySyncQueue
} from './offline/sync.js';

function applyThemePreference(pref) {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');

  if (pref === 'light') {
    root.classList.add('light');
    root.style.colorScheme = 'light';
  } else if (pref === 'dark') {
    root.classList.add('dark');
    root.style.colorScheme = 'dark';
  } else {
    const prefersDark =
      window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.add('light');
      root.style.colorScheme = 'light';
    }
  }
}

function getInitialPath() {
  const p = window.location.pathname || '/';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/inventory', label: 'Inventory', icon: Package },
  { path: '/sales', label: 'Sales Ledger', icon: Receipt },
  { path: '/expenses', label: 'Expenses', icon: Wallet },
  { path: '/analytics', label: 'Analytics', icon: BarChart3 },
  { path: '/settings', label: 'Settings', icon: SettingsIcon }
];

function getPageTitle(pathname) {
  if (pathname === '/') return 'Dashboard';
  if (pathname === '/inventory') return 'Inventory';
  if (pathname === '/inventory/new') return 'Add New Item';
  if (/^\/inventory\/[^/]+\/edit$/.test(pathname)) return 'Edit Item';
  if (pathname === '/sales') return 'Sales Ledger';
  if (pathname === '/expenses') return 'Expenses & Returns';
  if (pathname === '/analytics') return 'Analytics';
  if (pathname === '/settings') return 'Settings';
  return 'VastraLedger';
}

export default function App() {
  const [path, setPath] = useState(getInitialPath);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [themePref, setThemePref] = useState(() => {
    try {
      return localStorage.getItem('vl_theme') || 'system';
    } catch {
      return 'system';
    }
  });
  const [online, setOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [duplicateDraft, setDuplicateDraft] = useState(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [installPromptEvent, setInstallPromptEvent] = useState(null);
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((message, type = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const navigate = useCallback((nextPath) => {
    const normalized =
      nextPath.length > 1 && nextPath.endsWith('/') ? nextPath.slice(0, -1) : nextPath;
    if (normalized !== window.location.pathname) {
      window.history.pushState({}, '', normalized);
    }
    setPath(normalized);
    setExportMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onPop = () => setPath(getInitialPath());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    applyThemePreference(themePref);
    try {
      localStorage.setItem('vl_theme', themePref);
    } catch {}
  }, [themePref]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (themePref === 'system') applyThemePreference('system');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [themePref]);

  const checkConnectivity = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setOnline(false);
      return false;
    }
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const isOk = res.ok;
      setOnline(isOk);
      return isOk;
    } catch {
      const fallback = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
      setOnline(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      checkConnectivity();
    };
    const onOffline = () => {
      setOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    checkConnectivity();
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [checkConnectivity]);

  useEffect(() => {
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  const refreshQueueCount = useCallback(async () => {
    if (!user?.id) {
      setPendingCount(0);
      return;
    }
    try {
      const count = await getPendingSyncCount(user.id);
      setPendingCount(count);
    } catch {}
  }, [user?.id]);

  const runSync = useCallback(
    async ({ silent = false } = {}) => {
      const isUp = await checkConnectivity();
      if (!user?.id || !isUp) return;
      setSyncing(true);
      try {
        const result = await replaySyncQueue(user.id);
        await refreshQueueCount();
        if (result.synced > 0) {
          setRefreshKey((k) => k + 1);
          if (!silent) {
            addToast(`Synced ${result.synced} offline action(s) with cloud.`, 'success');
          }
        }
      } catch {
        if (!silent) addToast('Sync will retry automatically when connection stabilizes.', 'warning');
      } finally {
        setSyncing(false);
      }
    },
    [user?.id, refreshQueueCount, addToast, checkConnectivity]
  );

  useEffect(() => {
    refreshQueueCount();
    if (online && user?.id) {
      runSync({ silent: true });
    }
  }, [online, user?.id, refreshQueueCount, runSync]);

  useEffect(() => {
    let active = true;
    apiRequest('/api/auth/session')
      .then((res) => {
        if (!active) return;
        setOnline(true);
        if (res.authenticated && res.user) {
          setUser(res.user);
          if (res.user.theme_preference) {
            setThemePref(res.user.theme_preference);
          }
          if (window.location.pathname === '/login' || window.location.pathname === '/signup') {
            navigate('/');
          }
        } else {
          setUser(null);
          if (window.location.pathname !== '/login' && window.location.pathname !== '/signup') {
            navigate('/login');
          }
        }
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setAuthChecked(true);
      });
    return () => {
      active = false;
    };
  }, [navigate]);

  const handleAuthSuccess = (authedUser) => {
    setUser(authedUser);
    setOnline(true);
    if (authedUser.theme_preference) {
      setThemePref(authedUser.theme_preference);
    }
    navigate('/');
    addToast(`Welcome, ${authedUser.full_name}!`, 'success');
  };

  const handleLogout = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {}
    setUser(null);
    navigate('/login');
    addToast('Signed out.', 'info');
  };

  const handleThemeChange = async (nextTheme) => {
    setThemePref(nextTheme);
    applyThemePreference(nextTheme);
    if (user) {
      setUser((u) => (u ? { ...u, theme_preference: nextTheme } : u));
      try {
        await apiRequest('/api/settings', { method: 'PUT', body: { theme_preference: nextTheme } });
      } catch {}
    }
  };

  const handlePeriodChange = async (nextPeriod) => {
    if (!user) return;
    setUser((u) => (u ? { ...u, selected_period: nextPeriod } : u));
    try {
      await apiRequest('/api/settings', { method: 'PUT', body: { selected_period: nextPeriod } });
    } catch {}
  };

  const handleInstallApp = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => {});
    setInstallPromptEvent(null);
  };

  const triggerExport = async (type, format) => {
    setExportMenuOpen(false);
    try {
      const res = await downloadReportOfflineAware(user.id, type, format);
      addToast(`Downloaded ${res.filename}`, 'success');
    } catch (err) {
      addToast(err.message || 'Unable to export file.', 'error');
    }
  };

  if (!authChecked) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          padding: 24
        }}
      >
        <div
          style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div className="skeleton" style={{ height: 48 }} />
          <div className="skeleton" style={{ height: 180 }} />
        </div>
      </div>
    );
  }

  if (!user) {
    const authMode = path === '/signup' ? 'signup' : 'login';
    return <AuthPage mode={authMode} onAuthSuccess={handleAuthSuccess} navigate={navigate} />;
  }

  const editMatch = path.match(/^\/inventory\/([^/]+)\/edit$/);

  let pageElement;
  if (path === '/inventory') {
    pageElement = (
      <InventoryPage
        user={user}
        navigate={navigate}
        onDuplicate={(item) => {
          setDuplicateDraft(item);
          navigate('/inventory/new');
        }}
        onToast={addToast}
        onSyncStateChange={refreshQueueCount}
        refreshKey={refreshKey}
      />
    );
  } else if (path === '/inventory/new') {
    pageElement = (
      <ItemFormPage
        user={user}
        mode="create"
        initialDraft={duplicateDraft}
        onClearDraft={() => setDuplicateDraft(null)}
        navigate={navigate}
        onToast={addToast}
        onSyncStateChange={refreshQueueCount}
      />
    );
  } else if (editMatch) {
    pageElement = (
      <ItemFormPage
        user={user}
        mode="edit"
        itemId={decodeURIComponent(editMatch[1])}
        navigate={navigate}
        onToast={addToast}
        onSyncStateChange={refreshQueueCount}
      />
    );
  } else if (path === '/sales') {
    pageElement = <SalesPage user={user} onToast={addToast} refreshKey={refreshKey} />;
  } else if (path === '/expenses') {
    pageElement = <ExpensesPage user={user} onToast={addToast} refreshKey={refreshKey} />;
  } else if (path === '/analytics') {
    pageElement = <AnalyticsPage user={user} refreshKey={refreshKey} />;
  } else if (path === '/settings') {
    pageElement = (
      <SettingsPage
        user={user}
        online={online}
        themePref={themePref}
        pendingCount={pendingCount}
        syncing={syncing}
        onSyncNow={() => runSync({ silent: false })}
        onThemeChange={handleThemeChange}
        onCheckConnection={checkConnectivity}
        onUserUpdated={(updated) => {
          setUser(updated);
          if (updated.theme_preference) {
            setThemePref(updated.theme_preference);
          }
        }}
        onToast={addToast}
      />
    );
  } else {
    pageElement = (
      <DashboardPage
        user={user}
        onPeriodChange={handlePeriodChange}
        navigate={navigate}
        refreshKey={refreshKey}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand-mark" aria-hidden="true">
            V
          </div>
          <div className="brand-title-wrap">
            <span className="brand-name">{user.business_name || 'VastraLedger'}</span>
            <span className="brand-page">{getPageTitle(path)}</span>
          </div>
        </div>

        <div className="topbar-right">
          <span
            className={`badge ${!online ? 'badge-amber' : pendingCount > 0 ? 'badge-blue' : 'badge-green'}`}
            title={
              !online
                ? 'Offline mode — changes save locally and sync automatically'
                : pendingCount > 0
                  ? `${pendingCount} offline change(s) waiting to sync`
                  : 'Connected and synced with Cloudflare D1'
            }
          >
            {!online ? <WifiOff size={13} /> : <Wifi size={13} />}
            <span className="hide-mobile">
              {!online ? 'Offline' : pendingCount > 0 ? `${pendingCount} Pending` : 'Synced'}
            </span>
          </span>

          {pendingCount > 0 && online && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => runSync()}
              disabled={syncing}
            >
              <RefreshCw size={14} />
              <span className="hide-mobile">{syncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>
          )}

          {installPromptEvent && (
            <button
              type="button"
              className="btn btn-secondary btn-sm hide-mobile"
              onClick={handleInstallApp}
            >
              <Download size={14} />
              <span>Install App</span>
            </button>
          )}

          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setExportMenuOpen((o) => !o)}
              aria-expanded={exportMenuOpen}
            >
              <FileSpreadsheet size={15} />
              <span className="hide-mobile">Export</span>
            </button>

            {exportMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  right: 0,
                  top: 'calc(100% + 6px)',
                  minWidth: 220,
                  background: 'var(--bg-surface-elevated)',
                  border: '1px solid var(--border-strong)',
                  borderRadius: 12,
                  boxShadow: 'var(--shadow-lg)',
                  padding: 6,
                  zIndex: 45,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2
                }}
              >
                <button
                  type="button"
                  className="nav-btn"
                  style={{ fontSize: 13, padding: '8px 10px' }}
                  onClick={() => triggerExport('full', 'xlsx')}
                >
                  Complete Report (.xlsx)
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  style={{ fontSize: 13, padding: '8px 10px' }}
                  onClick={() => triggerExport('inventory', 'xlsx')}
                >
                  Inventory Workbook (.xlsx)
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  style={{ fontSize: 13, padding: '8px 10px' }}
                  onClick={() => triggerExport('sales', 'xlsx')}
                >
                  Sales Ledger (.xlsx)
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  style={{ fontSize: 13, padding: '8px 10px' }}
                  onClick={() => triggerExport('inventory', 'csv')}
                >
                  Inventory CSV (.csv)
                </button>
                <button
                  type="button"
                  className="nav-btn"
                  style={{ fontSize: 13, padding: '8px 10px' }}
                  onClick={() => triggerExport('sales', 'csv')}
                >
                  Sales CSV (.csv)
                </button>
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => navigate('/inventory/new')}
          >
            <Plus size={15} />
            <span className="hide-mobile">Add New Item</span>
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar" aria-label="Primary navigation">
          <nav className="nav-list">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                item.path === '/'
                  ? path === '/'
                  : path === item.path ||
                    (item.path === '/inventory' && path.startsWith('/inventory/'));
              return (
                <button
                  key={item.path}
                  type="button"
                  className={`nav-btn ${active ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="sidebar-footer">
            <div className="user-pill">
              <div className="user-pill-name">{user.full_name}</div>
              <div className="user-pill-sub">{user.email || user.phone}</div>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleLogout}>
              <LogOut size={15} />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>

        <main className="main-content">
          {!online && (
            <div className="alert-banner alert-warning" style={{ marginBottom: 16 }}>
              <span>
                You are offline. Viewing cached data; new items and sales will sync automatically
                when reconnected.
              </span>
            </div>
          )}
          {pageElement}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Mobile navigation">
        {NAV_ITEMS.filter((i) => i.path !== '/settings').map((item) => {
          const Icon = item.icon;
          const active =
            item.path === '/'
              ? path === '/'
              : path === item.path ||
                (item.path === '/inventory' && path.startsWith('/inventory/'));
          return (
            <button
              key={item.path}
              type="button"
              className={`bottom-nav-btn ${active ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
            >
              <Icon size={18} />
              <span>{item.label === 'Sales Ledger' ? 'Sales' : item.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          className={`bottom-nav-btn ${path === '/settings' ? 'active' : ''}`}
          onClick={() => navigate('/settings')}
        >
          <SettingsIcon size={18} />
          <span>Settings</span>
        </button>
      </nav>

      {toasts.length > 0 && (
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast-item">
              <span>{t.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
