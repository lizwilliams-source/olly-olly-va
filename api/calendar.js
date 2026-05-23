export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── AUTH URL ───────────────────────────────────────────────────────────────
  if (action === 'authurl') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: 'https://olly-olly-va.vercel.app/api/calendar-callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events',
      access_type: 'offline',
      prompt: 'consent',
      state: req.headers.authorization?.replace('Bearer ', '') || '',
    });
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  // ── CREATE EVENT ───────────────────────────────────────────────────────────
  if (action === 'create') {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    // Get user's Google tokens from KV
    const KV_URL = process.env.KV_REST_API_URL;
    const KV_TOKEN = process.env.KV_REST_API_TOKEN;
    
    // Verify session
    const sessionRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`session:${token}`)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const sessionData = await sessionRes.json();
    const session = sessionData.result ? JSON.parse(sessionData.result) : null;
    if (!session) return res.status(401).json({ error: 'Not logged in' });

    // Get Google tokens
    const gTokenRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`gtoken:${session.email}`)}`, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    const gTokenData = await gTokenRes.json();
    const gTokens = gTokenData.result ? JSON.parse(gTokenData.result) : null;
    if (!gTokens) return res.status(401).json({ error: 'Google Calendar not connected', needsConnect: true });

    // Refresh Google access token
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: gTokens.refresh_token,
        grant_type: 'refresh_token',
      }),
    });
    const refreshData = await refreshRes.json();
    const accessToken = refreshData.access_token;
    if (!accessToken) return res.status(401).json({ error: 'Google token refresh failed', needsConnect: true });

    const { title, description, startTime, endTime } = req.body;

    // Create calendar event
    const eventRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: title,
        description,
        start: { dateTime: startTime, timeZone: 'America/New_York' },
        end: { dateTime: endTime, timeZone: 'America/New_York' },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      }),
    });

    const eventData = await eventRes.json();
    if (!eventRes.ok) return res.status(500).json({ error: eventData.error?.message || 'Failed to create event' });
    return res.status(200).json({ ok: true, eventId: eventData.id, eventLink: eventData.htmlLink });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
