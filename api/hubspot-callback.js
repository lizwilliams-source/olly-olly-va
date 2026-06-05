export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code received');

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const kvH = { Authorization: `Bearer ${KV_TOKEN}` };

  try {
    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.HUBSPOT_CLIENT_ID,
      client_secret: process.env.HUBSPOT_CLIENT_SECRET,
      redirect_uri: 'https://olly-olly-va.vercel.app/api/hubspot-callback',
      code,
    });
    const tokenRes = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.message || 'Token exchange failed');

    await fetch(`${KV_URL}/set/hs_refresh_token/${encodeURIComponent(tokenData.refresh_token)}`, { headers: kvH });
    await fetch(`${KV_URL}/del/hs_access_token`, { headers: kvH });

    res.redirect('https://olly-olly-va.vercel.app?hs=connected');
  } catch (err) {
    res.status(500).send(`<p style="font-family:sans-serif;color:red;padding:20px">HubSpot auth failed: ${err.message}</p>`);
  }
}
