async function getGTokens(sessionToken) {
  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const kvH = { Authorization: `Bearer ${KV_TOKEN}` };

  const sessionRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`session:${sessionToken}`)}`, { headers: kvH });
  const sessionData = await sessionRes.json();
  const session = sessionData.result ? JSON.parse(sessionData.result) : null;
  if (!session) return { error: 'Not logged in' };

  const gTokenRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`gtoken:${session.email}`)}`, { headers: kvH });
  const gTokenData = await gTokenRes.json();
  const gTokens = gTokenData.result ? JSON.parse(gTokenData.result) : null;
  if (!gTokens) return { error: 'Not connected', needsConnect: true };

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
  if (!refreshData.access_token) return { error: 'Token refresh failed', needsConnect: true };
  return { accessToken: refreshData.access_token, session };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const sessionToken = req.headers.authorization?.replace('Bearer ', '');

  // ── AUTH URL ───────────────────────────────────────────────────────────────
  if (action === 'authurl') {
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      redirect_uri: 'https://olly-olly-va.vercel.app/api/calendar-callback',
      response_type: 'code',
      // Full calendar scope so calendarList + event creation + gmail all work
      scope: 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.send',
      access_type: 'offline',
      prompt: 'consent',
      state: sessionToken || '',
    });
    return res.status(200).json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }

  // ── LIST USER'S CALENDARS ─────────────────────────────────────────────────
  if (action === 'calendarlist') {
    const { accessToken, error, needsConnect } = await getGTokens(sessionToken);
    if (error) return res.status(200).json({ calendars: [], notConnected: true });
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) return res.status(200).json({ calendars: [] });
    const listData = await listRes.json();
    const calendars = (listData.items || [])
      .filter(c => !c.deleted)
      .map(c => ({ id: c.id, name: c.summary || c.id, selected: c.selected !== false, primary: !!c.primary }))
      .sort((a, b) => (b.primary ? 1 : 0) - (a.primary ? 1 : 0));
    return res.status(200).json({ calendars });
  }

  // ── CREATE EVENT ───────────────────────────────────────────────────────────
  if (action === 'create') {
    const { accessToken, error, needsConnect } = await getGTokens(sessionToken);
    if (error) return res.status(401).json({ error, needsConnect });
    const { title, description, startTime, endTime } = req.body;
    const eventRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: title, description,
        start: { dateTime: startTime }, end: { dateTime: endTime },
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] },
      }),
    });
    const eventData = await eventRes.json();
    if (!eventRes.ok) return res.status(500).json({ error: eventData.error?.message || 'Failed to create event' });
    return res.status(200).json({ ok: true, eventId: eventData.id, eventLink: eventData.htmlLink });
  }

  // ── LIST TODAY'S EVENTS (from all calendars) ───────────────────────────────
  if (action === 'events') {
    const { accessToken, error } = await getGTokens(sessionToken);
    if (error) return res.status(200).json({ events: [], notConnected: true });

    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
    const params = new URLSearchParams({
      timeMin: req.query.timeMin || startOfDay.toISOString(),
      timeMax: req.query.timeMax || endOfDay.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
    });

    // Get all calendars first
    const calListRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const calItems = calListRes.ok
      ? ((await calListRes.json()).items || []).filter(c => c.selected !== false && !c.deleted)
      : [{ id: 'primary', summary: 'Primary' }];

    const calendarNames = Object.fromEntries(calItems.map(c => [c.id, c.summary || c.id]));

    // Fetch events from all calendars in parallel
    const allArrays = await Promise.all(
      calItems.map(cal =>
        fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }).then(r => r.ok ? r.json() : { items: [] }).catch(() => ({ items: [] }))
          .then(d => { (d.items || []).forEach(e => e._calendarId = cal.id); return d; })
      )
    );

    // Merge and deduplicate
    const seen = new Set();
    const allItems = allArrays.flatMap(d => d.items || []).filter(e => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    allItems.sort((a, b) => (a.start?.dateTime || a.start?.date || '').localeCompare(b.start?.dateTime || b.start?.date || ''));

    const events = allItems.map(e => ({
      summary: e.summary || '',
      start: e.start,
      end: e.end,
      description: e.description || null,
      location: e.location || null,
      htmlLink: e.htmlLink || null,
      id: e.id || null,
      attendees: (e.attendees || []).filter(a => !a.self).map(a => a.displayName || a.email).slice(0, 5),
      attendeeEmails: (e.attendees || []).filter(a => !a.self && a.email).map(a => a.email).slice(0, 5),
      calendarId: e._calendarId || null,
      calendarName: e._calendarId ? (calendarNames[e._calendarId] || e._calendarId) : null,
    }));

    const calendars = calItems.map(c => ({ id: c.id, name: c.summary || c.id }));
    return res.status(200).json({ events, calendars });
  }

  // ── SEND EMAIL VIA GMAIL ──────────────────────────────────────────────────
  if (action === 'send-email') {
    const { accessToken, error, needsConnect } = await getGTokens(sessionToken);
    if (error) return res.status(401).json({ error, needsConnect });
    const { to, subject, body, images } = req.body;
    if (!to || !subject || !body) return res.status(400).json({ error: 'to, subject, and body required' });
    const htmlBody = body.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
    const imagesHtml = (images || []).map(img =>
      `<br><p style="font-size:12px;color:#666;margin:12px 0 4px">${img.label}</p><img src="${img.url}" style="max-width:100%;border:1px solid #ddd;border-radius:4px;display:block">`
    ).join('');
    const fullHtml = `<html><body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#333;max-width:600px">${htmlBody}${imagesHtml}</body></html>`;
    const message = [`To: ${to}`, `Subject: ${subject}`, `MIME-Version: 1.0`, `Content-Type: text/html; charset=utf-8`, ``, fullHtml].join('\r\n');
    const raw = Buffer.from(message).toString('base64url');
    const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    const sendData = await sendRes.json();
    if (!sendRes.ok) {
      if (sendData.error?.code === 403 || sendData.error?.status === 'PERMISSION_DENIED')
        return res.status(403).json({ error: 'Gmail send permission not granted', needsConnect: true });
      return res.status(500).json({ error: sendData.error?.message || 'Failed to send email' });
    }
    return res.status(200).json({ ok: true, messageId: sendData.id });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
