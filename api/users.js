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

    const existing = await kvGet(`user:${email.toLowerCase()}`);
    if (existing) return res.status(400).json({ error: 'User already exists' });

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

  // ── MAKE ADMIN (one-time use) ──────────────────────────────────────────────
  if (action === 'makeadmin') {
    const { email, secret } = req.body;
    if (secret !== 'ollyolly_admin_2025') return res.status(403).json({ error: 'Wrong secret' });
    const user = await kvGet(`user:${email.toLowerCase()}`);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.isAdmin = true;
    await kvSet(`user:${email.toLowerCase()}`, user);
    return res.status(200).json({ ok: true });
  }

// ── ADMIN: EDIT USER ───────────────────────────────────────────────────────
  if (action === 'edit') {
    const adminToken = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${adminToken}`);
    if (!session?.isAdmin) return res.status(403).json({ error: 'Admin only' });

    const { originalEmail, email, name, password } = req.body;
    const user = await kvGet(`user:${originalEmail.toLowerCase()}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (name) user.name = name;
    if (password) user.passwordHash = hashPassword(password);
    if (email && email.toLowerCase() !== originalEmail.toLowerCase()) {
      user.email = email.toLowerCase();
      await kvDel(`user:${originalEmail.toLowerCase()}`);
      await kvSet(`user:${email.toLowerCase()}`, user);
    } else {
      await kvSet(`user:${originalEmail.toLowerCase()}`, user);
    }
    return res.status(200).json({ ok: true });
  }

// ── SET OWNER ID (self-service) ────────────────────────────────────────────
  if (action === 'setowner') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${token}`);
    if (!session) return res.status(401).json({ error: 'Not logged in' });

    const { ownerId } = req.body;
    if (!ownerId) return res.status(400).json({ error: 'Owner ID required' });

    const user = await kvGet(`user:${session.email}`);
    if (!user) return res.status(404).json({ error: 'User not found' });

    user.ownerId = ownerId;
    await kvSet(`user:${session.email}`, user);

    // Update session too
    session.ownerId = ownerId;
    await kvSet(`session:${token}`, session);

    return res.status(200).json({ ok: true });
  }

  // ── QUEUE: GET ─────────────────────────────────────────────────────────────
  if (action === 'getqueue') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${token}`);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    const queue = await kvGet(`queue:${session.email}`) || [];
    return res.status(200).json(queue);
  }

  // ── QUEUE: ADD ─────────────────────────────────────────────────────────────
  if (action === 'addqueue') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${token}`);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    const { company } = req.body;
    if (!company?.id) return res.status(400).json({ error: 'Company required' });
    const queue = await kvGet(`queue:${session.email}`) || [];
    if (!queue.find(c => c.id === company.id)) {
      queue.push(company);
      await kvSet(`queue:${session.email}`, queue);
    }
    return res.status(200).json({ ok: true, count: queue.length });
  }

  // ── QUEUE: REMOVE ──────────────────────────────────────────────────────────
  if (action === 'removequeue') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${token}`);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    const { companyId } = req.body;
    const queue = await kvGet(`queue:${session.email}`) || [];
    const updated = queue.filter(c => c.id !== companyId);
    await kvSet(`queue:${session.email}`, updated);
    return res.status(200).json({ ok: true, count: updated.length });
  }

  // ── QUEUE: CLEAR ───────────────────────────────────────────────────────────
  if (action === 'clearqueue') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await kvGet(`session:${token}`);
    if (!session) return res.status(401).json({ error: 'Not logged in' });
    await kvSet(`queue:${session.email}`, []);
    return res.status(200).json({ ok: true });
  }

return res.status(400).json({ error: 'Unknown action' });
}
