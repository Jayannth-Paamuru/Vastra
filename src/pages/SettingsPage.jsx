import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileSpreadsheet,
  KeyRound,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Save,
  Smartphone,
  Sun,
  Wifi,
  WifiOff
} from 'lucide-react';
import { apiRequest, clearUserOfflineData, downloadReportOfflineAware } from '../offline/sync.js';

export default function SettingsPage({
  user,
  online = true,
  themePref = 'system',
  pendingCount = 0,
  syncing = false,
  onSyncNow,
  onThemeChange,
  onCheckConnection,
  onUserUpdated,
  onToast
}) {
  const [fullName, setFullName] = useState(user?.full_name || '');
  const [businessName, setBusinessName] = useState(user?.business_name || 'VastraLedger');
  const [appearance, setAppearance] = useState(themePref || user?.theme_preference || 'system');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [exportingKey, setExportingKey] = useState('');
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [checkingConn, setCheckingConn] = useState(false);

  useEffect(() => {
    setFullName(user?.full_name || '');
    setBusinessName(user?.business_name || 'VastraLedger');
  }, [user?.full_name, user?.business_name]);

  useEffect(() => {
    setAppearance(themePref || user?.theme_preference || 'system');
  }, [themePref, user?.theme_preference]);

  const handleAppearanceSelect = async (nextTheme) => {
    setAppearance(nextTheme);
    await onThemeChange?.(nextTheme);
  };

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (fullName.trim().length < 2) {
      onToast('Full name must be at least 2 characters.', 'error');
      return;
    }
    setSavingProfile(true);
    try {
      const res = await apiRequest('/api/settings', {
        method: 'PUT',
        body: {
          full_name: fullName.trim(),
          business_name: businessName.trim() || 'VastraLedger',
          theme_preference: appearance
        }
      });
      onUserUpdated?.(res.settings);
      onToast('Profile & appearance settings saved.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not save settings.', 'error');
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      onToast('New password must be at least 8 characters.', 'error');
      return;
    }
    if (newPassword !== confirmPassword) {
      onToast('New password and confirmation do not match.', 'error');
      return;
    }
    setSavingPassword(true);
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: {
          current_password: currentPassword,
          new_password: newPassword
        }
      });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onToast('Password updated successfully.', 'success');
    } catch (err) {
      onToast(err.message || 'Could not update password.', 'error');
    } finally {
      setSavingPassword(false);
    }
  };

  const handleExport = async (type, format) => {
    const key = `${type}-${format}`;
    setExportingKey(key);
    try {
      const res = await downloadReportOfflineAware(user.id, type, format);
      onToast(`Downloaded ${res.filename}`, 'success');
    } catch (err) {
      onToast(err.message || 'Failed to export report.', 'error');
    } finally {
      setExportingKey('');
    }
  };

  const handleRefreshConn = async () => {
    setCheckingConn(true);
    try {
      const ok = await onCheckConnection?.();
      onToast(ok ? 'Online — connected to cloud.' : 'Offline — using local cache.', ok ? 'success' : 'warning');
    } finally {
      setCheckingConn(false);
    }
  };

  const handleLogoutAndClear = async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch {}
    await clearUserOfflineData(user.id).catch(() => {});
    window.location.href = '/login';
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="two-col-grid">
        {/* Profile */}
        <form className="card" onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h2 className="card-title">Boutique &amp; Account Profile</h2>
              <p className="card-subtitle">Manage your display name and store branding</p>
            </div>
          </div>

          <div className="field">
            <label className="field-label" htmlFor="set-fullname">
              Full Name
            </label>
            <input
              id="set-fullname"
              className="input"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field-label" htmlFor="set-business">
              Boutique / Business Name
            </label>
            <input
              id="set-business"
              className="input"
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
            />
          </div>

          <div className="form-grid-2">
            <div className="field">
              <label className="field-label" htmlFor="set-email">
                Email Address
              </label>
              <input
                id="set-email"
                className="input"
                type="email"
                readOnly
                value={user?.email || 'Not linked'}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="set-phone">
                Mobile Number
              </label>
              <input
                id="set-phone"
                className="input"
                type="text"
                readOnly
                value={user?.phone || 'Not linked'}
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
            <button type="submit" className="btn btn-primary" disabled={savingProfile}>
              <Save size={15} />
              <span>{savingProfile ? 'Saving...' : 'Save Profile'}</span>
            </button>
          </div>
        </form>

        {/* Appearance & Password */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">Appearance</h2>
                <p className="card-subtitle">Light white or pitch-black dark mode</p>
              </div>
            </div>

            <div className="segmented" style={{ width: '100%' }} role="group" aria-label="Appearance theme">
              <button
                type="button"
                className={`segmented-btn ${appearance === 'system' ? 'active' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => handleAppearanceSelect('system')}
              >
                <Monitor size={15} />
                <span>System</span>
              </button>
              <button
                type="button"
                className={`segmented-btn ${appearance === 'light' ? 'active' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => handleAppearanceSelect('light')}
              >
                <Sun size={15} />
                <span>Light</span>
              </button>
              <button
                type="button"
                className={`segmented-btn ${appearance === 'dark' ? 'active' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
                onClick={() => handleAppearanceSelect('dark')}
              >
                <Moon size={15} />
                <span>Dark</span>
              </button>
            </div>
          </div>

          <form
            className="card"
            onSubmit={handleChangePassword}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <div className="card-header" style={{ marginBottom: 0 }}>
              <div>
                <h2 className="card-title">Change Password</h2>
                <p className="card-subtitle">PBKDF2-SHA256 encrypted credentials</p>
              </div>
              <KeyRound size={18} color="var(--accent)" />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="set-cur-pwd">
                Current Password
              </label>
              <input
                id="set-cur-pwd"
                className="input"
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>

            <div className="form-grid-2">
              <div className="field">
                <label className="field-label" htmlFor="set-new-pwd">
                  New Password
                </label>
                <input
                  id="set-new-pwd"
                  className="input"
                  type="password"
                  minLength={8}
                  required
                  placeholder="Min 8 chars"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="set-conf-pwd">
                  Confirm New Password
                </label>
                <input
                  id="set-conf-pwd"
                  className="input"
                  type="password"
                  minLength={8}
                  required
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button type="submit" className="btn btn-secondary" disabled={savingPassword}>
                <span>{savingPassword ? 'Updating...' : 'Update Password'}</span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Exports */}
      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">1-Click Excel (.xlsx) &amp; CSV Exports</h2>
            <p className="card-subtitle">
              Formatted currency columns, formula-safe cells, UTF-8 BOM for ₹ — works online and offline
            </p>
          </div>
          <span className="badge badge-violet">Works Offline</span>
        </div>

        <div className="filter-bar">
          <button
            type="button"
            className="btn btn-primary"
            disabled={exportingKey === 'full-xlsx'}
            onClick={() => handleExport('full', 'xlsx')}
          >
            <FileSpreadsheet size={16} />
            <span>Complete Boutique Report (.xlsx)</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={exportingKey === 'inventory-xlsx'}
            onClick={() => handleExport('inventory', 'xlsx')}
          >
            <Download size={15} />
            <span>Inventory Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={exportingKey === 'inventory-csv'}
            onClick={() => handleExport('inventory', 'csv')}
          >
            <Download size={15} />
            <span>Inventory CSV (.csv)</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={exportingKey === 'sales-xlsx'}
            onClick={() => handleExport('sales', 'xlsx')}
          >
            <Download size={15} />
            <span>Sales Ledger Excel (.xlsx)</span>
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            disabled={exportingKey === 'sales-csv'}
            onClick={() => handleExport('sales', 'csv')}
          >
            <Download size={15} />
            <span>Sales Ledger CSV (.csv)</span>
          </button>
        </div>
      </div>

      {/* Offline Sync & Privacy */}
      <div className="two-col-grid">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h2 className="card-title">Offline Sync &amp; Downloadable App</h2>
              <p className="card-subtitle">Install VastraLedger on mobile or desktop</p>
            </div>
            <Smartphone size={18} color="var(--accent)" />
          </div>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 13.5
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
              {online ? <Wifi size={16} color="var(--emerald)" /> : <WifiOff size={16} color="var(--amber)" />}
              <span>Connection Status</span>
            </span>
            <span className={`badge ${online ? 'badge-green' : 'badge-amber'}`}>
              {online ? 'Online & Connected' : 'Offline Mode'}
            </span>
          </div>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--bg-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: 13.5
            }}
          >
            <span style={{ fontWeight: 600 }}>Pending Offline Changes</span>
            <span className="badge badge-blue tabular">{pendingCount} queued</span>
          </div>

          <div className="filter-bar">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!online || syncing}
              onClick={() => onSyncNow?.()}
            >
              <RefreshCw size={14} />
              <span>{syncing ? 'Syncing...' : 'Sync Now'}</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={checkingConn}
              onClick={handleRefreshConn}
            >
              <CheckCircle2 size={14} />
              <span>{checkingConn ? 'Checking...' : 'Test Connection'}</span>
            </button>

            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowInstallHelp((v) => !v)}
            >
              <span>How to Install App</span>
            </button>
          </div>

          {showInstallHelp && (
            <div
              style={{
                padding: 12,
                borderRadius: 10,
                background: 'var(--bg-subtle)',
                fontSize: 12.5,
                color: 'var(--text-secondary)',
                lineHeight: 1.55
              }}
            >
              <strong>iPhone / iPad (Safari):</strong> Tap Share → Add to Home Screen.
              <br />
              <strong>Android / Desktop (Chrome / Edge):</strong> Tap menu (⋮) → Install App or Add to Home Screen.
            </div>
          )}
        </div>

        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="card-header" style={{ marginBottom: 0 }}>
            <div>
              <h2 className="card-title">Session &amp; Device Privacy</h2>
              <p className="card-subtitle">Sign out safely and clear cached boutique data</p>
            </div>
          </div>

          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Logging out invalidates your session cookie on Cloudflare and clears your local
            IndexedDB inventory, sales, and offline queue cache from this browser.
          </p>

          <div style={{ marginTop: 'auto', paddingTop: 8 }}>
            <button type="button" className="btn btn-danger" onClick={handleLogoutAndClear}>
              <LogOut size={15} />
              <span>Log Out &amp; Clear Local Cache</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
