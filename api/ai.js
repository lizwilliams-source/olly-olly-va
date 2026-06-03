import { getSession, logUsage } from './_helpers.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { system, messages, max_tokens } = req.body;

    const systemBlock = system ? [
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } }
    ] : undefined;

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'prompt-caching-2024-07-31',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 1000,
        system: systemBlock,
        messages,
      }),
    });

    const data = await claudeRes.json();
    if (!claudeRes.ok) {
      console.error('Claude error:', data);
      return res.status(claudeRes.status).json({ error: data.error?.message || JSON.stringify(data) });
    }

    const text = data.content?.[0]?.text || '';

    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await getSession(token);
    if (session?.email) {
      logUsage(session.email, {
        claude_input: data.usage?.input_tokens || 0,
        claude_output: data.usage?.output_tokens || 0,
        ai_queries: 1,
      }).catch(() => {});
    }

    return res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (err) {
    console.error('AI proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
