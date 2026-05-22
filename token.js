// api/token.js - Handles HubSpot token refresh server-side
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', process.env.HUBSPOT_REFRESH_TOKEN);
    params.append('client_id', process.env.HUBSPOT_CLIENT_ID);
    params.append('client_secret', process.env.HUBSPOT_CLIENT_SECRET);

    const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Token refresh failed');

    return res.status(200).json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    console.error('Token refresh error:', err);
    return res.status(500).json({ error: err.message });
  }
}
