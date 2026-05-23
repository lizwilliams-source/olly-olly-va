import { getSession, logUsage } from './_helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = { ...req.body, model: 'claude-haiku-4-5-20251001' };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic error:', data);
      return res.status(response.status).json({ error: data });
    }

    // Log usage async
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await getSession(token);
    if (session?.email && data.usage) {
      logUsage(session.email, {
        claude_input: data.usage.input_tokens || 0,
        claude_output: data.usage.output_tokens || 0,
        ai_queries: 1,
      }).catch(() => {});
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error('AI proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
