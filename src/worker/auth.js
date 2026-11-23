import { generateRandomHex, hashPassword, hmacSha256Hex, verifyPassword } from './crypto.js';
import { cleanString, normalizeEmail, normalizePhone, ValidationError } from './validation.js';

export const SESSION_COOKIE_NAME = 'vastraledger_session';
export const SESSION_MAX_AGE_SECONDS = 2592000; // 30 days
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX_FAILURES = 8;

export function getSessionSecret(env) {
  const secret = env?.SESSION_SECRET;
  if (!secret || typeof secret !== 'string' || secret.trim().length < 16) {
    return null;
  }
  return secret;
}

export function buildSessionCookie(token, { clear = false } = {}) {
  if (clear) {
    return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
  }
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function parseCookie(cookieHeader, name) {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) {
      return part.slice(idx + 1).trim();
    }
  }
  return null;
}

function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    '0.0.0.0'
  );
}

function requireSecret(env) {
  const secret = getSessionSecret(env);
  if (!secret) {
    throw new ValidationError(
      'Server authentication secret is not configured. Run `npm run cf:secrets` to set SESSION_SECRET.',
      503
    );
  }
  return secret;
}

async function createSessionForUser(env, userId) {
  const secret = requireSecret(env);
  const rawToken = generateRandomHex(32);
  const tokenHash = await hmacSha256Hex(secret, rawToken);
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000);

  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      userId,
      tokenHash,
      expires.toISOString(),
      now.toISOString(),
      now.toISOString()
    )
    .run();

  return rawToken;
}

export async function getAuthenticatedUser(request, env) {
  const secret = getSessionSecret(env);
  if (!secret) return null;

  const rawToken = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (!rawToken) return null;

  const tokenHash = await hmacSha256Hex(secret, rawToken);
  const nowIso = new Date().toISOString();

  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.expires_at,
            u.id, u.full_name, u.business_name, u.email, u.phone, u.created_at,
            st.business_name AS settings_business_name,
            st.currency_symbol, st.selected_period, st.theme_preference
     FROM sessions s
     INNER JOIN users u ON u.id = s.user_id
     LEFT JOIN store_settings st ON st.user_id = u.id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  )
    .bind(tokenHash, nowIso)
    .first();

  if (!row) return null;

  await env.DB.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`)
    .bind(nowIso, row.session_id)
    .run();

  return {
    sessionId: row.session_id,
    user: {
      id: row.id,
      full_name: row.full_name,
      business_name: row.settings_business_name || row.business_name || 'VastraLedger',
      email: row.email,
      phone: row.phone,
      currency_symbol: row.currency_symbol || '₹',
      selected_period: row.selected_period || 'all-time',
      theme_preference: row.theme_preference || 'system',
      created_at: row.created_at
    }
  };
}

export async function handleSignup(request, env) {
  requireSecret(env);
  const body = await request.json();

  const full_name = cleanString(body.full_name, 100);
  if (full_name.length < 2) {
    throw new ValidationError('Full name must be at least 2 characters.');
  }

  const business_name = cleanString(body.business_name || 'VastraLedger', 120) || 'VastraLedger';
  const password = typeof body.password === 'string' ? body.password : '';
  if (password.length < 8) {
    throw new ValidationError('Password must be at least 8 characters long.');
  }

  const email = body.email ? normalizeEmail(body.email) : null;
  const phone = body.phone ? normalizePhone(body.phone, body.country_code || '+91') : null;

  if (!email && !phone) {
    throw new ValidationError('Please provide either an email address or mobile number.');
  }

  if (email) {
    const existingEmail = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
      .bind(email)
      .first();
    if (existingEmail) {
      throw new ValidationError('An account with this email address already exists.', 409);
    }
  }
  if (phone) {
    const existingPhone = await env.DB.prepare(`SELECT id FROM users WHERE phone = ?`)
      .bind(phone)
      .first();
    if (existingPhone) {
      throw new ValidationError('An account with this mobile number already exists.', 409);
    }
  }

  const { salt, hash } = await hashPassword(password);
  const userId = crypto.randomUUID();
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO users (id, full_name, business_name, email, phone, password_hash, password_salt, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(userId, full_name, business_name, email, phone, hash, salt, nowIso, nowIso)
    .run();

  await env.DB.prepare(
    `INSERT INTO store_settings (user_id, business_name, currency_symbol, selected_period, theme_preference, updated_at)
     VALUES (?, ?, '₹', 'all-time', 'system', ?)`
  )
    .bind(userId, business_name, nowIso)
    .run();

  const token = await createSessionForUser(env, userId);

  return {
    status: 201,
    cookie: buildSessionCookie(token),
    data: {
      success: true,
      user: {
        id: userId,
        full_name,
        business_name,
        email,
        phone,
        currency_symbol: '₹',
        selected_period: 'all-time',
        theme_preference: 'system',
        created_at: nowIso
      }
    }
  };
}

export async function handleLogin(request, env) {
  const secret = requireSecret(env);
  const body = await request.json();

  const mode = body.mode === 'phone' ? 'phone' : 'email';
  const identifierRaw =
    mode === 'phone'
      ? normalizePhone(body.phone || body.identifier, body.country_code || '+91')
      : normalizeEmail(body.email || body.identifier);

  const password = typeof body.password === 'string' ? body.password : '';
  if (!identifierRaw || !password) {
    throw new ValidationError('Please enter your credentials and password.');
  }

  const ipHash = await hmacSha256Hex(secret, getClientIp(request));
  const identHash = await hmacSha256Hex(secret, identifierRaw);
  const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();

  const rateStats = await env.DB.prepare(
    `SELECT
       SUM(CASE WHEN ip_hash = ? THEN 1 ELSE 0 END) AS ip_failures,
       SUM(CASE WHEN identifier_hash = ? THEN 1 ELSE 0 END) AS ident_failures
     FROM login_attempts
     WHERE successful = 0 AND attempted_at >= ? AND (ip_hash = ? OR identifier_hash = ?)`
  )
    .bind(ipHash, identHash, windowStart, ipHash, identHash)
    .first();

  if (
    (Number(rateStats?.ip_failures) || 0) >= RATE_LIMIT_MAX_FAILURES ||
    (Number(rateStats?.ident_failures) || 0) >= RATE_LIMIT_MAX_FAILURES
  ) {
    throw new ValidationError(
      'Too many failed login attempts. Please wait 15 minutes and try again.',
      429
    );
  }

  const user =
    mode === 'phone'
      ? await env.DB.prepare(`SELECT * FROM users WHERE phone = ?`).bind(identifierRaw).first()
      : await env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(identifierRaw).first();

  const valid = user ? await verifyPassword(password, user.password_salt, user.password_hash) : false;
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO login_attempts (id, ip_hash, identifier_hash, attempted_at, successful)
     VALUES (?, ?, ?, ?, ?)`
  )
    .bind(crypto.randomUUID(), ipHash, identHash, nowIso, valid ? 1 : 0)
    .run();

  if (!valid || !user) {
    throw new ValidationError('Invalid login credentials or password.', 401);
  }

  const settings = await env.DB.prepare(`SELECT * FROM store_settings WHERE user_id = ?`)
    .bind(user.id)
    .first();

  const token = await createSessionForUser(env, user.id);

  return {
    status: 200,
    cookie: buildSessionCookie(token),
    data: {
      success: true,
      user: {
        id: user.id,
        full_name: user.full_name,
        business_name: settings?.business_name || user.business_name || 'VastraLedger',
        email: user.email,
        phone: user.phone,
        currency_symbol: settings?.currency_symbol || '₹',
        selected_period: settings?.selected_period || 'all-time',
        theme_preference: settings?.theme_preference || 'system',
        created_at: user.created_at
      }
    }
  };
}

export async function handleLogout(request, env) {
  const secret = getSessionSecret(env);
  const rawToken = parseCookie(request.headers.get('Cookie'), SESSION_COOKIE_NAME);
  if (secret && rawToken) {
    const tokenHash = await hmacSha256Hex(secret, rawToken);
    await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(tokenHash).run();
  }
  return {
    status: 200,
    cookie: buildSessionCookie('', { clear: true }),
    data: { success: true }
  };
}

export async function handleChangePassword(request, env, auth) {
  const body = await request.json();
  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!currentPassword || newPassword.length < 8) {
    throw new ValidationError(
      'Current password is required and new password must be at least 8 characters.'
    );
  }

  const user = await env.DB.prepare(`SELECT password_hash, password_salt FROM users WHERE id = ?`)
    .bind(auth.user.id)
    .first();

  const matches = user
    ? await verifyPassword(currentPassword, user.password_salt, user.password_hash)
    : false;
  if (!matches) {
    throw new ValidationError('Current password is incorrect.', 401);
  }

  const { salt, hash } = await hashPassword(newPassword);
  const nowIso = new Date().toISOString();

  await env.DB.prepare(
    `UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?`
  )
    .bind(hash, salt, nowIso, auth.user.id)
    .run();

  await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id != ?`)
    .bind(auth.user.id, auth.sessionId)
    .run();

  return {
    status: 200,
    data: { success: true, message: 'Password updated successfully.' }
  };
}
