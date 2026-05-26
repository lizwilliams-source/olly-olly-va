import { getSession } from './_helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = await getSession(token);
  if (!session?.isAdmin) return res.status(403).json({ error: 'Admin only' });

  const KV_URL = process.env.KV_REST_API_URL;
  const KV_TOKEN = process.env.KV_REST_API_TOKEN;
  const headers = { Authorization: `Bearer ${KV_TOKEN}` };

  const month = req.query.month || new Date().toISOString().slice(0, 7);

  const keysRes = await fetch(`${KV_URL}/keys/${encodeURIComponent('user:*')}`, { headers });
  const keys = (await keysRes.json()).result || [];
  const users = await Promise.all(keys.map(k =>
    fetch(`${KV_URL}/get/${encodeURIComponent(k)}`, { headers })
      .then(r => r.json()).then(d => d.result ? JSON.parse(d.result) : null)
  ));

  const rows = await Promise.all(users.filter(Boolean).map(async u => {
    const usageRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`usage:${u.email}:${month}`)}`, { headers });
    const usage = await usageRes.json().then(d => d.result ? JSON.parse(d.result) : {});

    const whisper_seconds = usage.groq_seconds || 0;
    const claude_input = usage.claude_input || 0;
    const claude_output = usage.claude_output || 0;
    // Claude Haiku pricing: $0.80/M input, $4.00/M output
    const claude_cost = (claude_input / 1_000_000) * 0.80 + (claude_output / 1_000_000) * 4.00;

    return {
      name: u.name,
      email: u.email,
      calls: usage.calls || 0,
      ai_queries: usage.ai_queries || 0,
      whisper_seconds: Math.round(whisper_seconds),
      claude_input,
      claude_output,
      claude_cost,
      total_cost: claude_cost,
    };
  }));

  rows.sort((a, b) => b.total_cost - a.total_cost);
  return res.status(200).json({ month, rows });
}
