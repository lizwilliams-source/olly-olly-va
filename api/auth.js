// api/auth.js - Verifies Clerk session and returns user info + HubSpot owner ID
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'No token' });

    // Verify with Clerk
    const clerkRes = await fetch('https://api.clerk.com/v1/tokens/verify', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.CLERK_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token }),
    });

    const clerkData = await clerkRes.json();
    if (!clerkRes.ok) return res.status(401).json({ error: 'Invalid token' });

    const email = clerkData.email_address || clerkData.primary_email_address;

    // Look up HubSpot owner ID by email
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
    const accessToken = tokenData.access_token;

    // Get all owners and find by email
    const ownersRes = await fetch('https://api.hubapi.com/crm/v3/owners?limit=100', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const ownersData = await ownersRes.json();
    const owner = ownersData.results?.find(o => o.email?.toLowerCase() === email?.toLowerCase());

    return res.status(200).json({
      email,
      ownerId: owner?.id || null,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}` : email,
    });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message });
  }
}
