import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Mail,
  Phone,
  Sparkles
} from 'lucide-react';
import { COUNTRY_CODES } from '../shared/constants.js';
import { apiRequest } from '../offline/sync.js';

function scorePassword(pwd) {
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 12) score += 1;
  return score;
}

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Good', 'Strong'];
const STRENGTH_COLORS = ['', '#dc2626', '#ea580c', '#2563eb', '#16a34a'];

export default function AuthPage({ mode = 'login', onAuthSuccess, navigate }) {
  const isSignup = mode === 'signup';
  const [authMethod, setAuthMethod] = useState('email');
  const [fullName, setFullName] = useState('');
  const [businessName, setBusinessName] = useState('VastraLedger');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+91');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (isSignup && fullName.trim().length < 2) {
      setError('Please enter your full name (at least 2 characters).');
      return;
    }
    if (authMethod === 'email' && !email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (authMethod === 'phone' && !phone.trim()) {
      setError('Please enter your mobile number.');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      const endpoint = isSignup ? '/api/auth/signup' : '/api/auth/login';
      const payload = isSignup
        ? {
            full_name: fullName.trim(),
            business_name: businessName.trim() || 'VastraLedger',
            email: authMethod === 'email' ? email.trim() : undefined,
            phone: authMethod === 'phone' ? phone.trim() : undefined,
            country_code: countryCode,
            password
          }
        : {
            mode: authMethod,
            email: authMethod === 'email' ? email.trim() : undefined,
            phone: authMethod === 'phone' ? phone.trim() : undefined,
            country_code: countryCode,
            password
          };

      const res = await apiRequest(endpoint, { method: 'POST', body: payload });
      onAuthSuccess(res.user);
    } catch (err) {
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-layout">
      <section className="auth-showcase" aria-label="VastraLedger highlights">
        <svg
          className="auth-showcase-bg"
          viewBox="0 0 600 800"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <defs>
            <pattern id="zariWeave" width="60" height="60" patternUnits="userSpaceOnUse">
              <path
                d="M30 4 L56 30 L30 56 L4 30 Z"
                fill="none"
                stroke="#E5B95C"
                strokeWidth="0.7"
                opacity="0.45"
              />
              <circle cx="30" cy="30" r="3" fill="#E5B95C" opacity="0.35" />
              <path
                d="M30 14 C36 20, 36 26, 30 30 C24 26, 24 20, 30 14 Z"
                fill="none"
                stroke="#C7BFFF"
                strokeWidth="0.6"
                opacity="0.5"
              />
            </pattern>
            <radialGradient id="orb1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#9B8CFF" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#9B8CFF" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="orb2" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#E5B95C" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#E5B95C" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width="600" height="800" fill="url(#zariWeave)" />
          <circle cx="480" cy="140" r="210" fill="url(#orb1)" />
          <circle cx="110" cy="680" r="190" fill="url(#orb2)" />
        </svg>

        <div className="auth-showcase-content">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="brand-mark" style={{ width: 44, height: 44, fontSize: 19 }}>
              V
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.01em' }}>
                VastraLedger
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.72)' }}>
                Boutique Inventory &amp; Sales Suite
              </div>
            </div>
          </div>

          <h1 className="auth-headline">
            Modern ledger built for saree &amp; ethnic boutiques.
          </h1>
          <p className="auth-subcopy">
            Catalog every saree, kurti, and lehenga with photos, track margins per sale,
            and keep working smoothly even when shop Wi-Fi drops.
          </p>

          <div className="auth-highlights">
            <div className="auth-highlight-item">
              <div className="auth-highlight-icon">
                <Sparkles size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Visual Saree &amp; Apparel Catalog</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.74)' }}>
                  Snap compressed photos on mobile and filter by fabric, zari, or color.
                </div>
              </div>
            </div>

            <div className="auth-highlight-item">
              <div className="auth-highlight-icon">
                <BarChart3 size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Real-Time Profit &amp; Margin Analytics</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.74)' }}>
                  Know your exact INR stock cost, net profit, and slow-moving pieces.
                </div>
              </div>
            </div>

            <div className="auth-highlight-item">
              <div className="auth-highlight-icon">
                <FileSpreadsheet size={18} />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Offline-Ready &amp; Excel Export</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.74)' }}>
                  Install as an app, log sales offline, and download formatted .xlsx workbooks.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 2, fontSize: 12, color: 'rgba(255,255,255,0.62)' }}>
          Private per-account workspace secured with PBKDF2-SHA256 encryption.
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-card">
          <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800 }}>
            {isSignup ? 'Create your boutique account' : 'Welcome back'}
          </h2>
          <p style={{ margin: '0 0 20px', fontSize: 14, color: 'var(--text-secondary)' }}>
            {isSignup
              ? 'Start with a clean, private workspace in seconds.'
              : 'Sign in with your email or mobile number to continue.'}
          </p>

          <div className="segmented" style={{ width: '100%', marginBottom: 18 }}>
            <button
              type="button"
              className={`segmented-btn ${authMethod === 'email' ? 'active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                setAuthMethod('email');
                setError('');
              }}
            >
              <Mail size={15} />
              <span>Email</span>
            </button>
            <button
              type="button"
              className={`segmented-btn ${authMethod === 'phone' ? 'active' : ''}`}
              style={{ flex: 1, justifyContent: 'center' }}
              onClick={() => {
                setAuthMethod('phone');
                setError('');
              }}
            >
              <Phone size={15} />
              <span>Mobile</span>
            </button>
          </div>

          {error && (
            <div className="alert-banner alert-danger" style={{ marginBottom: 16 }} role="alert">
              <AlertCircle size={16} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {isSignup && (
              <>
                <div className="field">
                  <label className="field-label" htmlFor="auth-fullname">
                    Full Name
                  </label>
                  <input
                    id="auth-fullname"
                    className="input"
                    type="text"
                    required
                    placeholder="e.g. Ananya Reddy"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                  />
                </div>

                <div className="field">
                  <label className="field-label" htmlFor="auth-business">
                    Boutique / Business Name
                  </label>
                  <input
                    id="auth-business"
                    className="input"
                    type="text"
                    placeholder="VastraLedger"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    autoComplete="organization"
                  />
                </div>
              </>
            )}

            {authMethod === 'email' ? (
              <div className="field">
                <label className="field-label" htmlFor="auth-email">
                  Email Address
                </label>
                <input
                  id="auth-email"
                  className="input"
                  type="email"
                  required
                  placeholder="owner@boutique.in"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
            ) : (
              <div className="field">
                <label className="field-label" htmlFor="auth-phone">
                  Mobile Number
                </label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    className="select"
                    aria-label="Country code"
                    style={{ width: 128, flexShrink: 0 }}
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                  <input
                    id="auth-phone"
                    className="input"
                    type="tel"
                    required
                    placeholder="9876543210"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    autoComplete="tel-national"
                  />
                </div>
              </div>
            )}

            <div className="field">
              <label className="field-label" htmlFor="auth-password">
                Password
              </label>
              <div className="password-wrap">
                <input
                  id="auth-password"
                  className="input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  minLength={8}
                  placeholder={isSignup ? 'At least 8 characters' : 'Enter your password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={isSignup ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  className="password-eye"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {isSignup && password.length > 0 && (
                <div>
                  <div className="strength-bars">
                    {[1, 2, 3, 4].map((lvl) => (
                      <div
                        key={lvl}
                        className="strength-bar"
                        style={{
                          background: strength >= lvl ? STRENGTH_COLORS[strength] : undefined
                        }}
                      />
                    ))}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      marginTop: 4,
                      color: STRENGTH_COLORS[strength] || 'var(--text-muted)',
                      fontWeight: 600
                    }}
                  >
                    Strength: {STRENGTH_LABELS[strength] || 'Too short'}
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4 }}
              disabled={submitting}
            >
              {submitting
                ? isSignup
                  ? 'Creating account...'
                  : 'Signing in...'
                : isSignup
                  ? 'Create Free Account'
                  : 'Sign In'}
            </button>
          </form>

          <div
            style={{
              marginTop: 20,
              textAlign: 'center',
              fontSize: 14,
              color: 'var(--text-secondary)'
            }}
          >
            {isSignup ? (
              <>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => navigate('/login')}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Sign In
                </button>
              </>
            ) : (
              <>
                New to VastraLedger?{' '}
                <button
                  type="button"
                  onClick={() => navigate('/signup')}
                  style={{
                    border: 'none',
                    background: 'none',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0
                  }}
                >
                  Create an account
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
