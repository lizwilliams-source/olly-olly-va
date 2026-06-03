// api/hubspot.js - Proxies HubSpot API calls server-side (keeps token off client)
export const config = { maxDuration: 30 };

async function getHsToken(KV_URL, KV_TOKEN) {
  const kvH = { Authorization: `Bearer ${KV_TOKEN}` };
  const cached = await fetch(`${KV_URL}/get/hs_access_token`, { headers: kvH }).then(r => r.json());
  if (cached.result) return cached.result;
  const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: process.env.HUBSPOT_REFRESH_TOKEN, client_id: process.env.HUBSPOT_CLIENT_ID, client_secret: process.env.HUBSPOT_CLIENT_SECRET });
  const tokenRes = await fetch('https://api.hubapi.com/oauth/v1/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenData.message || 'Token refresh failed');
  await fetch(`${KV_URL}/set/hs_access_token/${encodeURIComponent(tokenData.access_token)}/ex/1500`, { headers: kvH });
  return tokenData.access_token;
}

export default async function handler(req, res) {
  // ── TASKS DUE TODAY / OVERDUE ───────────────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'tasks') {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const KV_URL = process.env.KV_REST_API_URL;
      const KV_TOKEN = process.env.KV_REST_API_TOKEN;
      const sessionRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`session:${token}`)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
      const sessionData = await sessionRes.json();
      const session = sessionData.result ? JSON.parse(sessionData.result) : null;
      if (!session) return res.status(401).json({ error: 'Unauthorized' });

      const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0,0,0,0);
      const twoWeeksAgo = new Date(); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14); twoWeeksAgo.setHours(0,0,0,0);

      const accessToken = await getHsToken(KV_URL, KV_TOKEN);
      const filters = [
        { propertyName: 'hs_task_status', operator: 'NEQ', value: 'COMPLETED' },
        { propertyName: 'hs_timestamp', operator: 'GTE', value: twoWeeksAgo.toISOString() },
        { propertyName: 'hs_timestamp', operator: 'LT', value: tomorrow.toISOString() },
      ];
      if (session.ownerId) filters.push({ propertyName: 'hubspot_owner_id', operator: 'EQ', value: session.ownerId });

      const searchRes = await fetch('https://api.hubapi.com/crm/v3/objects/tasks/search', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ filterGroups: [{ filters }], properties: ['hs_task_subject','hs_timestamp','hs_task_status','hs_task_type'], sorts: [{ propertyName: 'hs_timestamp', direction: 'ASCENDING' }], limit: 100 }),
      });
      const searchData = await searchRes.json();
      const taskResults = searchData.results || [];
      if (!taskResults.length) return res.status(200).json({ tasks: [] });

      const assocRes = await fetch('https://api.hubapi.com/crm/v4/associations/tasks/companies/batch/read', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: taskResults.map(t => ({ id: t.id })) }),
      });
      const assocData = await assocRes.json();
      const companyMap = {};
      if (assocData.results) assocData.results.forEach(r => { if (r.to?.length) companyMap[r.from.id] = String(r.to[0].toObjectId); });

      const tasks = taskResults.map(t => ({
        id: t.id,
        subject: t.properties.hs_task_subject || 'Untitled task',
        dueAt: t.properties.hs_timestamp,
        status: t.properties.hs_task_status,
        type: t.properties.hs_task_type || 'TODO',
        companyId: companyMap[t.id] || null,
      }));
      return res.status(200).json({ tasks });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ALL COMPANY PROPERTY DEFINITIONS ──────────────────────────────────────
  if (req.method === 'GET' && req.query.action === 'properties') {
    try {
      const token = req.headers.authorization?.replace('Bearer ', '');
      const KV_URL = process.env.KV_REST_API_URL;
      const KV_TOKEN = process.env.KV_REST_API_TOKEN;
      const sessionRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`session:${token}`)}`, { headers: { Authorization: `Bearer ${KV_TOKEN}` } });
      const sessionData = await sessionRes.json();
      if (!sessionData.result) return res.status(401).json({ error: 'Unauthorized' });
      const accessToken = await getHsToken(KV_URL, KV_TOKEN);
      const propsRes = await fetch('https://api.hubapi.com/crm/v3/properties/companies?limit=500', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const propsData = await propsRes.json();
      const properties = (propsData.results || [])
        .filter(p => !p.hidden && p.type !== 'object')
        .map(p => ({ name: p.name, label: p.label, type: p.type }))
        .sort((a, b) => a.label.localeCompare(b.label));
      return res.status(200).json({ properties });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-HubSpot-Path, X-HubSpot-Method');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    const kvHeaders = { Authorization: `Bearer ${KV_TOKEN}` };

    // Use cached token if available (HubSpot tokens last 30 min, we cache for 25)
    let accessToken;
    const cachedRes = await fetch(`${KV_URL}/get/hs_access_token`, { headers: kvHeaders });
    const cachedData = await cachedRes.json();
    accessToken = cachedData.result;

    if (!accessToken) {
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
      if (!tokenRes.ok) throw new Error(tokenData.message || 'Token refresh failed');

      accessToken = tokenData.access_token;
      await fetch(`${KV_URL}/set/hs_access_token/${encodeURIComponent(accessToken)}/ex/1500`, { headers: kvHeaders });
    }
    const hsPath = req.headers['x-hubspot-path'];
    const hsMethod = req.headers['x-hubspot-method'] || req.method;

    if (!hsPath) return res.status(400).json({ error: 'Missing X-HubSpot-Path header' });

    const hsRes = await fetch(`https://api.hubapi.com${hsPath}`, {
      method: hsMethod,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: ['POST', 'PATCH', 'PUT'].includes(hsMethod) ? JSON.stringify(req.body) : undefined,
    });

    const data = await hsRes.json();
    return res.status(hsRes.status).json(data);
  } catch (err) {
    console.error('HubSpot proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
