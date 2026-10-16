import http from 'node:http';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// PgmzChat Beta6 persists account credentials plus device codes/ban status only.
// Sessions, presence and WebRTC signaling are RAM-only; chat/media payloads
// are never accepted or stored by this server.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.PGMZCHAT_DATA_DIR || path.join(__dirname, 'data'));
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const DEVICES_FILE = path.join(DATA_DIR, 'devices.json');
const CLIENT_DIR = path.resolve(__dirname, '../client');
const DATABASE_URL = String(process.env.DATABASE_URL || '').trim();
const ADMIN_TOKEN = String(process.env.PGMZCHAT_ADMIN_TOKEN || '');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Math.max(1, Math.min(65535, Number(process.env.PORT || 8080)));
const MAX_BODY = 128 * 1024;
const PRESENCE_TTL_MS = 30_000;
const SIGNAL_TTL_MS = 120_000;
const MAX_SIGNAL_QUEUE = 5_000;
const accountById = new Map();
const accountByUsername = new Map();
const devicesByHash = new Map();
const sessions = new Map(); // bearer token -> device session metadata; RAM only.
const failedLogins = new Map(); // username+IP cooldowns, RAM only.
const presence = new Map(); // deviceId -> ephemeral record; RAM only.
let signalQueue = [];
const rate = new Map();

let dbPool = null;
if (DATABASE_URL) {
  const pgModule = await import('pg');
  const Pool = pgModule.Pool || pgModule.default?.Pool;
  if (!Pool) throw new Error('DATABASE_URL is set but the pg PostgreSQL driver is unavailable. Run npm install in server/.');
  dbPool = new Pool({
    connectionString: DATABASE_URL,
    max: 5,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    ...(process.env.PGMZCHAT_DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {})
  });
  await dbPool.query('SELECT 1');
  await dbPool.query(`
    CREATE TABLE IF NOT EXISTS pgmzchat_accounts (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pgmzchat_devices (
      code_hash TEXT PRIMARY KEY,
      device_code TEXT NOT NULL,
      account_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      device_label TEXT NOT NULL DEFAULT 'Устройство',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      banned BOOLEAN NOT NULL DEFAULT FALSE,
      ban_reason TEXT NOT NULL DEFAULT '',
      banned_at TEXT
    );
  `);
} else {
  await mkdir(DATA_DIR, { recursive: true });
}

if (dbPool) {
  const result = await dbPool.query('SELECT id, username, salt, password_hash FROM pgmzchat_accounts');
  for (const row of result.rows) {
    if (row && typeof row.id === 'string' && typeof row.username === 'string' && typeof row.salt === 'string' && typeof row.password_hash === 'string') {
      const safeAccount = { id: row.id, username: row.username, salt: row.salt, passwordHash: row.password_hash };
      accountById.set(safeAccount.id, safeAccount);
      accountByUsername.set(safeAccount.username.toLowerCase(), safeAccount.id);
    }
  }
} else {
  try {
    const loaded = JSON.parse(await readFile(ACCOUNTS_FILE, 'utf8'));
    if (Array.isArray(loaded)) for (const account of loaded) {
      if (account && typeof account.id === 'string' && typeof account.username === 'string' && typeof account.salt === 'string' && typeof account.passwordHash === 'string') {
        const safeAccount = { id: account.id, username: account.username, salt: account.salt, passwordHash: account.passwordHash };
        accountById.set(safeAccount.id, safeAccount); accountByUsername.set(safeAccount.username.toLowerCase(), safeAccount.id);
      }
    }
  } catch {
    await writeFile(ACCOUNTS_FILE, '[]\n', { flag: 'wx', mode: 0o600 }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
}

if (dbPool) {
  const result = await dbPool.query('SELECT code_hash, device_code, account_ids, device_label, first_seen, last_seen, banned, ban_reason, banned_at FROM pgmzchat_devices');
  for (const row of result.rows) {
    if (row && typeof row.device_code === 'string' && typeof row.code_hash === 'string') {
      const device = {
        deviceCode: row.device_code,
        codeHash: row.code_hash,
        accountIds: Array.isArray(row.account_ids) ? row.account_ids.filter(v => typeof v === 'string') : [],
        deviceLabel: String(row.device_label || 'Устройство').slice(0, 96),
        firstSeen: String(row.first_seen || new Date().toISOString()),
        lastSeen: String(row.last_seen || row.first_seen || new Date().toISOString()),
        banned: row.banned === true,
        banReason: String(row.ban_reason || '').slice(0, 300),
        bannedAt: row.banned_at ? String(row.banned_at) : null
      };
      devicesByHash.set(device.codeHash, device);
    }
  }
} else {
  try {
    const loaded = JSON.parse(await readFile(DEVICES_FILE, 'utf8'));
    if (Array.isArray(loaded)) for (const item of loaded) {
      if (item && typeof item.deviceCode === 'string' && typeof item.codeHash === 'string') {
        const device = {
          deviceCode: item.deviceCode,
          codeHash: item.codeHash,
          accountIds: Array.isArray(item.accountIds) ? item.accountIds.filter(v => typeof v === 'string') : [],
          deviceLabel: String(item.deviceLabel || 'Устройство').slice(0, 96),
          firstSeen: String(item.firstSeen || new Date().toISOString()),
          lastSeen: String(item.lastSeen || item.firstSeen || new Date().toISOString()),
          banned: item.banned === true,
          banReason: String(item.banReason || '').slice(0, 300),
          bannedAt: item.bannedAt ? String(item.bannedAt) : null
        };
        devicesByHash.set(device.codeHash, device);
      }
    }
  } catch {
    await writeFile(DEVICES_FILE, '[]\n', { flag: 'wx', mode: 0o600 }).catch(async error => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
}

function publicAccount(account) { return { id: account.id, username: account.username }; }
function safeId(value, max = 100) { return String(value || '').trim().replace(/[^a-zA-Z0-9_.:@-]/g, '').slice(0, max); }
function send(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Pgmz-Device-Code, X-Admin-Token', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(body);
}
async function parseBody(req, max = MAX_BODY) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > max) throw Object.assign(new Error('request_too_large'), { status: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('invalid_json'), { status: 400 }); }
}
function limited(req, res, route, max = 60) {
  const now = Date.now(), key = `${req.socket.remoteAddress || 'unknown'}:${route}`;
  const entry = rate.get(key) || { start: now, count: 0 };
  if (now - entry.start >= 60_000) { entry.start = now; entry.count = 0; }
  entry.count++; rate.set(key, entry);
  if (entry.count > max) { send(res, 429, { error: 'rate_limited', retryAfterSeconds: 60 }); return true; }
  return false;
}
async function persistAccounts() {
  const accounts = [...accountById.values()].filter(a => a.salt && a.passwordHash).map(a => ({ id: a.id, username: a.username, salt: a.salt, passwordHash: a.passwordHash }));
  if (dbPool) {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM pgmzchat_accounts');
      for (const a of accounts) await client.query('INSERT INTO pgmzchat_accounts (id, username, salt, password_hash) VALUES ($1, $2, $3, $4)', [a.id, a.username, a.salt, a.passwordHash]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    return;
  }
  const temp = `${ACCOUNTS_FILE}.${randomUUID()}.tmp`;
  const content = JSON.stringify(accounts) + '\n';
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  const { rename } = await import('node:fs/promises');
  await rename(temp, ACCOUNTS_FILE);
}
function derivePassword(password, salt) { return scryptSync(password, salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('hex'); }
function hashDeviceCode(code) { return createHash('sha256').update(code, 'utf8').digest('hex'); }
function getDeviceIdentity(req, body = {}) {
  const code = safeId(body.deviceCode || req.headers['x-pgmz-device-code'], 128);
  if (code.length < 16) return null;
  return { code, hash: hashDeviceCode(code) };
}
function adminAuthorized(req) {
  const supplied = Buffer.from(String(req.headers['x-admin-token'] || ''), 'utf8');
  const expected = Buffer.from(ADMIN_TOKEN, 'utf8');
  return !!ADMIN_TOKEN && supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
async function persistDevices() {
  const devices = [...devicesByHash.values()];
  if (dbPool) {
    const client = await dbPool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM pgmzchat_devices');
      for (const d of devices) await client.query(
        'INSERT INTO pgmzchat_devices (code_hash, device_code, account_ids, device_label, first_seen, last_seen, banned, ban_reason, banned_at) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9)',
        [d.codeHash, d.deviceCode, JSON.stringify(d.accountIds), d.deviceLabel, d.firstSeen, d.lastSeen, d.banned === true, d.banReason || '', d.bannedAt || null]
      );
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
    return;
  }
  const temp = `${DEVICES_FILE}.${randomUUID()}.tmp`;
  const content = JSON.stringify(devices.map(d => ({
    deviceCode: d.deviceCode, codeHash: d.codeHash, accountIds: d.accountIds,
    deviceLabel: d.deviceLabel, firstSeen: d.firstSeen, lastSeen: d.lastSeen,
    banned: d.banned, banReason: d.banReason, bannedAt: d.bannedAt
  })), null, 2) + '\n';
  await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
  const { rename } = await import('node:fs/promises');
  await rename(temp, DEVICES_FILE);
}
function deviceLabelFrom(req, body = {}) {
  return String(body.deviceLabel || body.deviceName || req.headers['user-agent'] || 'Устройство').trim().replace(/[<>\\]/g, '').slice(0, 96) || 'Устройство';
}
function deviceStatusError(deviceIdentity) {
  if (!deviceIdentity) return { status: 400, error: 'device_code_required', message: 'Не удалось определить постоянный код устройства. Обнови приложение и попробуй снова.' };
  const record = devicesByHash.get(deviceIdentity.hash);
  if (record?.banned) return { status: 403, error: 'device_banned', message: 'Это устройство заблокировано администратором.' };
  return null;
}
async function rememberDevice(deviceIdentity, account, req, body = {}) {
  const now = new Date().toISOString();
  const previous = devicesByHash.get(deviceIdentity.hash) || null;
  const record = previous ? { ...previous, accountIds: [...previous.accountIds] } : { deviceCode: deviceIdentity.code, codeHash: deviceIdentity.hash, accountIds: [], deviceLabel: deviceLabelFrom(req, body), firstSeen: now, lastSeen: now, banned: false, banReason: '', bannedAt: null };
  if (record.banned) throw Object.assign(new Error('device_banned'), { status: 403 });
  record.deviceCode = deviceIdentity.code;
  record.deviceLabel = deviceLabelFrom(req, body);
  record.lastSeen = now;
  if (!record.accountIds.includes(account.id)) record.accountIds.push(account.id);
  devicesByHash.set(deviceIdentity.hash, record);
  try { await persistDevices(); }
  catch (error) {
    if (previous) devicesByHash.set(deviceIdentity.hash, previous);
    else devicesByHash.delete(deviceIdentity.hash);
    throw error;
  }
  return record;
}
function issueSession(account, req, body = {}, deviceIdentity = null) {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const deviceLabel = String(body.deviceLabel || body.deviceName || '').trim().replace(/[<>\\]/g, '').slice(0, 64) || String(req.headers['user-agent'] || 'Устройство').slice(0, 96);
  sessions.set(token, { sessionId: randomUUID(), accountId: account.id, createdAt: now, lastSeen: now, deviceLabel, userAgent: String(req.headers['user-agent'] || '').slice(0, 160), deviceCodeHash: deviceIdentity?.hash || '' });
  return token;
}
function auth(req) {
  const match = String(req.headers.authorization || '').match(/^Bearer\s+([A-Za-z0-9_-]{32,100})$/i);
  if (!match) return null;
  const session = sessions.get(match[1]);
  if (!session) return null;
  const account = accountById.get(session.accountId);
  if (!account) return null;
  session.lastSeen = Date.now();
  const device = session.deviceCodeHash ? devicesByHash.get(session.deviceCodeHash) : null;
  return { token: match[1], session, account, deviceBanned: !!device?.banned };
}
function requireAuth(req, res) {
  const identity = auth(req);
  if (!identity) { send(res, 401, { error: 'authentication_required' }); return null; }
  if (identity.deviceBanned) { sessions.delete(identity.token); send(res, 403, { error: 'device_banned', message: 'Это устройство заблокировано администратором.' }); return null; }
  return identity;
}
function cleanPresence() {
  const now = Date.now();
  for (const [deviceId, item] of presence) if (now - item.lastSeen > PRESENCE_TTL_MS) presence.delete(deviceId);
  signalQueue = signalQueue.filter(signal => now - signal.createdAtMs <= SIGNAL_TTL_MS);
  if (signalQueue.length > MAX_SIGNAL_QUEUE) signalQueue = signalQueue.slice(-MAX_SIGNAL_QUEUE);
  // Keep abuse-control memory bounded too.
  if (rate.size > 10_000) for (const [key, value] of rate) if (now - value.start > 120_000) rate.delete(key);
}
function accountPeersForRooms(self, roomIds) {
  const wanted = new Set(roomIds);
  const out = [];
  for (const item of presence.values()) {
    if (item.deviceId === self.deviceId) continue;
    const sharedRooms = item.roomIds.filter(id => wanted.has(id));
    if (!sharedRooms.length) continue;
    out.push({ deviceId: item.deviceId, accountId: item.accountId, username: item.username, roomIds: sharedRooms, lastSeen: item.lastSeen });
  }
  return out;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg'
};
async function serveClientFile(req, res, requestPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let decoded;
  try { decoded = decodeURIComponent(requestPath || '/'); } catch { return false; }
  if (decoded.includes('\\') || decoded.includes('\0')) return false;
  if (decoded === '/') decoded = '/index.html';
  const filePath = path.resolve(CLIENT_DIR, `.${decoded}`);
  if (filePath !== CLIENT_DIR && !filePath.startsWith(CLIENT_DIR + path.sep)) return false;
  let content;
  try { content = await readFile(filePath); } catch { return false; }
  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === '.html';
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    'Content-Length': content.length,
    'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  });
  res.end(req.method === 'HEAD' ? undefined : content);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, X-Pgmz-Device-Code, X-Admin-Token', 'Access-Control-Max-Age': '600' }); res.end(); return; }
  try {
    cleanPresence();
    if (req.method === 'GET' && ['/api/health', '/health'].includes(url.pathname)) {
      send(res, 200, { status: 'ok', service: 'PgmzChat account + signaling service', version: '1.0_Beta6', persistence: dbPool ? 'postgresql' : 'local-json', persistentData: dbPool ? ['pgmzchat_accounts', 'pgmzchat_devices'] : ['accounts.json', 'devices.json'], deviceBanRegistry: true, chatPayloadStorage: false, signaling: 'ephemeral-memory', presenceTtlSeconds: PRESENCE_TTL_MS / 1000 }); return;
    }

    if (url.pathname.startsWith('/api/admin/devices')) {
      if (!ADMIN_TOKEN) { send(res, 503, { error: 'admin_api_disabled', message: 'Задай PGMZCHAT_ADMIN_TOKEN на сервере.' }); return; }
      if (!adminAuthorized(req)) { send(res, 403, { error: 'admin_forbidden' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/admin/devices') {
        const list = [...devicesByHash.values()].map(d => ({ deviceCode: d.deviceCode, codeHash: d.codeHash, accountIds: d.accountIds, deviceLabel: d.deviceLabel, firstSeen: d.firstSeen, lastSeen: d.lastSeen, banned: d.banned, banReason: d.banReason, bannedAt: d.bannedAt })).sort((a,b) => b.lastSeen.localeCompare(a.lastSeen));
        send(res, 200, { devices: list }); return;
      }
      const match = url.pathname.match(/^\/api\/admin\/devices\/([^/]+)\/(ban|unban)$/);
      if (req.method === 'POST' && match) {
        const code = decodeURIComponent(match[1]);
        const record = devicesByHash.get(hashDeviceCode(code));
        if (!record || record.deviceCode !== code) { send(res, 404, { error: 'device_not_found' }); return; }
        const action = match[2];
        let reason = '';
        if (action === 'ban') {
          const body = await parseBody(req, 16 * 1024);
          reason = String(body.reason || 'Заблокировано администратором').trim().slice(0, 300);
          record.banned = true; record.banReason = reason; record.bannedAt = new Date().toISOString();
          for (const [token, session] of sessions) if (session.deviceCodeHash === record.codeHash) sessions.delete(token);
          for (const [deviceId, item] of presence) if (item.deviceCodeHash === record.codeHash) presence.delete(deviceId);
          signalQueue = signalQueue.filter(signal => signal.fromId !== code && signal.toId !== code);
        } else {
          record.banned = false; record.banReason = ''; record.bannedAt = null;
        }
        await persistDevices();
        send(res, 200, { deviceCode: record.deviceCode, banned: record.banned, banReason: record.banReason, bannedAt: record.bannedAt }); return;
      }
      send(res, 404, { error: 'not_found' }); return;
    }


    if (req.method === 'POST' && url.pathname === '/api/auth/register') {
      if (limited(req, res, 'auth-register', 8)) return;
      const body = await parseBody(req, 16 * 1024);
      const deviceIdentity = getDeviceIdentity(req, body);
      const deviceError = deviceStatusError(deviceIdentity);
      if (deviceError) { send(res, deviceError.status, { error: deviceError.error, message: deviceError.message }); return; }
      const username = String(body.username || '').trim().replace(/^@+/, '').toLowerCase();
      const password = String(body.password || '');
      if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) { send(res, 400, { error: 'username_invalid', message: 'Username: 5–32 символа, латинские буквы, цифры и _, первая буква — латинская.' }); return; }
      if (password.length < 10 || password.length > 256) { send(res, 400, { error: 'password_length', message: 'Пароль должен содержать от 10 до 256 символов.' }); return; }
      if (accountByUsername.has(username)) { send(res, 409, { error: 'username_taken' }); return; }
      const salt = randomBytes(16).toString('hex');
      const account = { id: `u_${randomUUID().replaceAll('-', '')}`, username, salt, passwordHash: derivePassword(password, salt) };
      accountById.set(account.id, account); accountByUsername.set(username, account.id);
      try { await persistAccounts(); }
      catch { accountById.delete(account.id); accountByUsername.delete(username); send(res, 500, { error: 'account_persist_failed' }); return; }
      try { await rememberDevice(deviceIdentity, account, req, body); }
      catch { accountById.delete(account.id); accountByUsername.delete(username); await persistAccounts().catch(() => {}); send(res, 500, { error: 'device_registry_persist_failed' }); return; }
      const token = issueSession(account, req, body, deviceIdentity);
      send(res, 201, { token, account: publicAccount(account) }); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (limited(req, res, 'auth-login', 20)) return;
      const body = await parseBody(req, 16 * 1024);
      const deviceIdentity = getDeviceIdentity(req, body);
      const deviceError = deviceStatusError(deviceIdentity);
      if (deviceError) { send(res, deviceError.status, { error: deviceError.error, message: deviceError.message }); return; }
      const identityText = String(body.username || body.identity || '').trim().replace(/^@+/, '').toLowerCase();
      const lockKey = `${req.socket.remoteAddress || 'unknown'}:${identityText}`;
      const lock = failedLogins.get(lockKey);
      if (lock && lock.lockedUntil > Date.now()) { send(res, 429, { error: 'login_temporarily_locked', retryAfterSeconds: Math.ceil((lock.lockedUntil - Date.now()) / 1000), message: 'Слишком много неудачных попыток. Попробуй позже.' }); return; }
      const id = accountByUsername.get(identityText) || (accountById.has(identityText) ? identityText : null);
      const account = id ? accountById.get(id) : null;
      const password = String(body.password || '');
      let valid = false;
      if (account && password.length <= 256) {
        const candidate = Buffer.from(derivePassword(password, account.salt), 'hex');
        const expected = Buffer.from(account.passwordHash, 'hex');
        valid = candidate.length === expected.length && timingSafeEqual(candidate, expected);
      }
      if (!valid) {
        const current = failedLogins.get(lockKey) || { count: 0, windowStart: Date.now(), lockedUntil: 0 };
        if (Date.now() - current.windowStart > 15 * 60_000) { current.count = 0; current.windowStart = Date.now(); }
        current.count++;
        if (current.count >= 5) { current.lockedUntil = Date.now() + 15 * 60_000; current.count = 0; current.windowStart = Date.now(); }
        failedLogins.set(lockKey, current);
        send(res, current.lockedUntil > Date.now() ? 429 : 401, { error: current.lockedUntil > Date.now() ? 'login_temporarily_locked' : 'invalid_credentials', ...(current.lockedUntil > Date.now() ? { retryAfterSeconds: 900, message: 'Слишком много неудачных попыток. Попробуй через 15 минут.' } : {}) }); return;
      }
      failedLogins.delete(lockKey);
      try { await rememberDevice(deviceIdentity, account, req, body); }
      catch (error) { send(res, error.status || 500, { error: error.status ? error.message : 'device_registry_persist_failed' }); return; }
      const token = issueSession(account, req, body, deviceIdentity);
      send(res, 200, { token, account: publicAccount(account) }); return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/me') {
      const identity = requireAuth(req, res); if (!identity) return;
      send(res, 200, { account: publicAccount(identity.account) }); return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/sessions') {
      const identity = requireAuth(req, res); if (!identity) return;
      const list = [...sessions.entries()].filter(([, value]) => value.accountId === identity.account.id).map(([token, value]) => ({
        id: value.sessionId, deviceLabel: value.deviceLabel, createdAt: new Date(value.createdAt).toISOString(), lastSeen: new Date(value.lastSeen).toISOString(), current: token === identity.token
      })).sort((a, b) => Number(b.current) - Number(a.current) || b.lastSeen.localeCompare(a.lastSeen));
      send(res, 200, { sessions: list }); return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/auth/sessions/')) {
      const identity = requireAuth(req, res); if (!identity) return;
      const sessionId = decodeURIComponent(url.pathname.slice('/api/auth/sessions/'.length));
      const target = [...sessions.entries()].find(([, value]) => value.sessionId === sessionId);
      if (!target || target[1].accountId !== identity.account.id) { send(res, 404, { error: 'session_not_found' }); return; }
      if (target[0] === identity.token) { send(res, 400, { error: 'current_session_use_logout', message: 'Для выхода с этого устройства нажми «Выйти».' }); return; }
      sessions.delete(target[0]);
      send(res, 200, { revoked: true, sessionId }); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      const identity = requireAuth(req, res); if (!identity) return;
      sessions.delete(identity.token);
      for (const [deviceId, item] of presence) if (item.accountId === identity.account.id) presence.delete(deviceId);
      send(res, 200, { loggedOut: true }); return;
    }

    if (req.method === 'GET' && url.pathname === '/api/users/search') {
      const identity = requireAuth(req, res); if (!identity) return;
      if (limited(req, res, 'user-search', 90)) return;
      const q = String(url.searchParams.get('q') || '').trim().replace(/^@+/, '').toLowerCase();
      if (!/^[a-z0-9_]{3,32}$/.test(q)) { send(res, 200, { users: [] }); return; }
      const users = [...accountById.values()].filter(a => a.username.toLowerCase() === q && a.id !== identity.account.id).slice(0, 1).map(publicAccount);
      send(res, 200, { users }); return;
    }

    if (req.method === 'POST' && url.pathname === '/api/presence') {
      const identity = requireAuth(req, res); if (!identity) return;
      const body = await parseBody(req, 24 * 1024);
      const deviceId = safeId(body.deviceId, 100);
      if (deviceId.length < 8) { send(res, 400, { error: 'device_id_required' }); return; }
      if (body.online === false) { presence.delete(deviceId); send(res, 200, { online: false }); return; }
      const roomIds = [...new Set((Array.isArray(body.roomIds) ? body.roomIds : ['global']).map(v => safeId(v, 160)).filter(Boolean))].slice(0, 200);
      if (!roomIds.length) roomIds.push('global');
      const entry = { deviceId, accountId: identity.account.id, username: identity.account.username, roomIds, lastSeen: Date.now(), deviceCodeHash: identity.session.deviceCodeHash };
      presence.set(deviceId, entry);
      if (presence.size > 10_000) cleanPresence();
      send(res, 200, { online: true, account: publicAccount(identity.account), peers: accountPeersForRooms(entry, roomIds) }); return;
    }

    if (req.method === 'POST' && ['/api/calls/signals', '/api/mesh/signals'].includes(url.pathname)) {
      const identity = requireAuth(req, res); if (!identity) return;
      if (limited(req, res, 'signals', 600)) return;
      const body = await parseBody(req, 96 * 1024), fromId = safeId(body.fromId), toId = safeId(body.toId), callId = safeId(body.callId || 'mesh');
      const signal = body.signal;
      if (!fromId || !toId || fromId === toId || !signal || typeof signal.type !== 'string') { send(res, 400, { error: 'invalid_signal' }); return; }
      const fromPresence = presence.get(fromId), toPresence = presence.get(toId);
      if (!fromPresence || fromPresence.accountId !== identity.account.id || !toPresence) { send(res, 403, { error: 'device_not_online_or_not_owned' }); return; }
      const roomId = safeId(signal.roomId, 160);
      if (roomId && (!fromPresence.roomIds.includes(roomId) || !toPresence.roomIds.includes(roomId))) { send(res, 403, { error: 'devices_not_in_same_room' }); return; }
      const payloadBytes = Buffer.byteLength(JSON.stringify(signal));
      if (payloadBytes > 80 * 1024) { send(res, 413, { error: 'signal_too_large' }); return; }
      const createdAtMs = Math.max(Date.now(), (signalQueue.at(-1)?.createdAtMs || 0) + 1);
      const entry = { id: randomUUID(), fromId, toId, fromAccountId: identity.account.id, callId, signal, createdAt: new Date().toISOString(), createdAtMs };
      signalQueue.push(entry); if (signalQueue.length > MAX_SIGNAL_QUEUE) signalQueue = signalQueue.slice(-MAX_SIGNAL_QUEUE);
      send(res, 201, { accepted: true, id: entry.id, createdAtMs }); return;
    }

    if (req.method === 'GET' && ['/api/calls/signals', '/api/mesh/signals'].includes(url.pathname)) {
      const identity = requireAuth(req, res); if (!identity) return;
      const deviceId = safeId(url.searchParams.get('deviceId') || url.searchParams.get('clientId'));
      const after = Number(url.searchParams.get('after') || 0);
      const p = presence.get(deviceId);
      if (!p || p.accountId !== identity.account.id) { send(res, 403, { error: 'device_not_online_or_not_owned' }); return; }
      send(res, 200, { signals: signalQueue.filter(s => s.toId === deviceId && s.createdAtMs > after).map(s => ({ ...s })) }); return;
    }

    // Serve the browser/PWA client from the same HTTPS origin as the API.
    // API endpoints never serve static fallbacks, and private server/data files
    // are outside CLIENT_DIR and can never be requested through this handler.
    if (!url.pathname.startsWith('/api/') && await serveClientFile(req, res, url.pathname)) return;

    // Deliberately no /api/messages, /api/rooms, /api/contacts, /api/media,
    // /media/*, /api/stickers, or message search endpoints. Non-account data lives
    // on clients and is exchanged directly across authenticated peers via WebRTC.
    send(res, 404, { error: 'not_found', message: 'This server stores account records only; chat data must be exchanged peer-to-peer.' });
  } catch (error) {
    send(res, error.status || 500, { error: error.status ? error.message : 'server_error' });
  }
});
server.listen(PORT, HOST, () => {
  console.log(`PgmzChat 1.0_Beta6 account/signaling service listening on ${HOST}:${PORT}`);
  console.log(`Persistent account/device data: ${dbPool ? 'PostgreSQL' : `${ACCOUNTS_FILE} and ${DEVICES_FILE}`}. Presence/signals are RAM-only; messages/media are never stored by this server.`);
  console.log('Use HTTPS in public deployments. Account sessions are RAM-only and will be invalidated on server restart.');
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const forceExit = setTimeout(() => process.exit(1), 25000);
  forceExit.unref();
  server.close(async () => {
    if (dbPool) await dbPool.end().catch(() => {});
    clearTimeout(forceExit);
    process.exit(0);
  });
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
