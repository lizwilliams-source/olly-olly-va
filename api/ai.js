import { getSession, logUsage } from './_helpers.js';

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { system, messages, max_tokens } = req.body;

    // Convert Claude message format to Gemini format
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: { maxOutputTokens: max_tokens || 1000 },
        }),
      }
    );

    const data = await geminiRes.json();
    if (!geminiRes.ok) {
      console.error('Gemini error:', data);
      return res.status(geminiRes.status).json({ error: data.error?.message || JSON.stringify(data) });
    }

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const usage = data.usageMetadata || {};

    // Log usage async
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await getSession(token);
    if (session?.email) {
      logUsage(session.email, {
        claude_input: usage.promptTokenCount || 0,
        claude_output: usage.candidatesTokenCount || 0,
        ai_queries: 1,
      }).catch(() => {});
    }

    // Return in Claude-compatible format so app.js doesn't need changes
    return res.status(200).json({
      content: [{ type: 'text', text }],
    });
  } catch (err) {
    console.error('AI proxy error:', err);
    return res.status(500).json({ error: err.message });
  }
}
