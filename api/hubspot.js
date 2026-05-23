// api/hubspot.js - Proxies HubSpot API calls server-side (keeps token off client)
export default async function handler(req, res) {
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
