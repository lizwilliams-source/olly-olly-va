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

  // Get all users
  const keysRes = await fetch(`${KV_URL}/keys/${encodeURIComponent('user:*')}`, { headers });
  const keys = (await keysRes.json()).result || [];
  const users = await Promise.all(keys.map(k =>
    fetch(`${KV_URL}/get/${encodeURIComponent(k)}`, { headers })
      .then(r => r.json()).then(d => d.result ? JSON.parse(d.result) : null)
  ));

  // Get usage for each user
  const rows = await Promise.all(users.filter(Boolean).map(async u => {
    const usageRes = await fetch(`${KV_URL}/get/${encodeURIComponent(`usage:${u.email}:${month}`)}`, { headers });
    const usage = await usageRes.json().then(d => d.result ? JSON.parse(d.result) : {});

    const whisper_seconds = usage.groq_seconds || 0; // stored as groq_seconds (legacy key)
    const gemini_input = usage.claude_input || 0;     // stored as claude_input (legacy key)
    const gemini_output = usage.claude_output || 0;   // stored as claude_output (legacy key)
    // Gemini 2.5 Flash pricing: $0.15/M input, $0.60/M output
    const gemini_cost = (gemini_input / 1_000_000) * 0.15 + (gemini_output / 1_000_000) * 0.60;

    return {
      name: u.name,
      email: u.email,
      calls: usage.calls || 0,
      ai_queries: usage.ai_queries || 0,
      whisper_seconds: Math.round(whisper_seconds),
      gemini_input,
      gemini_output,
      gemini_cost,
      total_cost: gemini_cost, // VPS is flat-rate, only Gemini has per-use cost
    };
  }));

  rows.sort((a, b) => b.total_cost - a.total_cost);
  return res.status(200).json({ month, rows });
}
