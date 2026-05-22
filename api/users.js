// api/users.js - User management (add, list, delete users)
import crypto from 'crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

async function kv(method, ...args) {
  const res = await fetch(`${KV_URL}/${[method, ...args].map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

async function kvSet(key, value) {
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(value))}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

async function kvGet(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function kvDel(key) {
  const res = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  return res.json();
}

async function kvKeys(pattern) {
  const res = await fetch(`${KV_URL}/keys/${encodeURIComponent(pattern)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  const data = await res.json();
  return data.result || [];
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + 'ollyolly_salt_2025').digest('hex');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  if (action === 'login') {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await kvGet(`user:${email.toLowerCase()}`);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (user.passwordHash !== hashPassword(password)) return res.status(401).json({ error: 'Invalid email or password' });

    const token = generateToken();
    await kvSet(`session:${token}`, { email: user.email, name: user.name, ownerId: user.ownerId, isAdmin: user.isAdmin || false, createdAt: Date.now() });

    return res.status(200).json({ token, name: user.name, email: user.email, ownerId: user.ownerId, isAdmin: user.isAdmin || false });
  }

  // ── VERIFY SESSION ─────────────────────────────────────────────────────────
  if (action === 'verify') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    const session = await kvGet(`session:${token}`);
    if (!session) return res.status(401).json({ error: 'Invalid session' });

    return res.status(200).json(session);
  }

  // ── LOGOUT ─────────────────────────────────────────────────────────────────
  if (action === 'logout') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) await kvDel(`session:${token}`);
    return res.status(200).json({ ok: true });
  }

  // ── ADMIN: LIST USERS ──────────────────────────────────────────────────────
  if (action === 'list') {
    const adminToken = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${adminToken}`);
    if (!session?.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const keys = await kvKeys('user:*');
    const users = await Promise.all(keys.map(k => kvGet(k)));
    return res.status(200).json(users.map(u => ({ email: u.email, name: u.name, isAdmin: u.isAdmin, ownerId: u.ownerId })));
  }

  // ── ADMIN: ADD USER ────────────────────────────────────────────────────────
  if (action === 'add') {
    const adminToken = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${adminToken}`);
    if (!session?.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const { email, name, password, isAdmin } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    // Auto-lookup HubSpot owner ID
    const hsParams = new URLSearchParams();
    hsParams.append('grant_type', 'refresh_token');
    hsParams.append('refresh_token', process.env.HUBSPOT_REFRESH_TOKEN);
    hsParams.append('client_id', process.env.HUBSPOT_CLIENT_ID);
    hsParams.append('client_secret', process.env.HUBSPOT_CLIENT_SECRET);
    const tokenRes = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: hsParams.toString(),
    });
    const tokenData = await tokenRes.json();
    const ownersRes = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const ownersData = await ownersRes.json();
    const owner = ownersData.results?.find(o => o.email?.toLowerCase() === email.toLowerCase());

    await kvSet(`user:${email.toLowerCase()}`, {
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      passwordHash: hashPassword(password),
      isAdmin: isAdmin || false,
      ownerId: owner?.id || null,
    });

    return res.status(200).json({ ok: true, ownerId: owner?.id || null });
  }

  // ── ADMIN: DELETE USER ─────────────────────────────────────────────────────
  if (action === 'delete') {
    const adminToken = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${adminToken}`);
    if (!session?.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const { email } = req.body;
    await kvDel(`user:${email.toLowerCase()}`);
    return res.status(200).json({ ok: true });
  }

  // ── SETUP: CREATE FIRST ADMIN ──────────────────────────────────────────────
  if (action === 'setup') {
    const keys = await kvKeys('user:*');
    if (keys.length > 0) return res.status(403).json({ error: 'Setup already complete' });

    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    await kvSet(`user:${email.toLowerCase()}`, {
      email: email.toLowerCase(),
      name: name || email.split('@')[0],
      passwordHash: hashPassword(password),
      isAdmin: true,
      ownerId: null,
    });

    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
