export default async function handler(req, res) {
  const { code, state: sessionToken } = req.query;

  if (!code) return res.status(400).send('No code received');

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://olly-olly-va.vercel.app/api/calendar-callback',
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenRes.json();

    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    const kvH = { Authorization: `Bearer ${KV_TOKEN}` };

    const sessionRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`session:${sessionToken}`)}`, { headers: kvH });
    const sessionData = await sessionRes.json();
    const session = sessionData.result ? JSON.parse(sessionData.result) : null;
    if (!session) throw new Error('Session not found');

    // Save new refresh token if Google returned one; otherwise keep existing
    if (tokens.refresh_token) {
      await fetch(`${KV_URL}/set/${encodeURIComponent(`gtoken:${session.email}`)}/${encodeURIComponent(JSON.stringify({ refresh_token: tokens.refresh_token }))}`, { headers: kvH });
    }

    // Redirect back to app
    res.redirect('https://olly-olly-va.vercel.app?calendar=connected');
  } catch (err) {
    console.error('Calendar callback error:', err);
    res.status(500).send(`Error: ${err.message}`);
  }
}
