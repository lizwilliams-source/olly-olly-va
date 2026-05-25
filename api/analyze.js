import { getSession, logUsage } from './_helpers.js';

export const config = { maxDuration: 60 };

const GEMINI_MODEL = 'gemini-2.5-flash';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { transcript, companyName } = req.body;
    if (!transcript) return res.status(400).json({ error: 'No transcript provided' });

    const prompt = `You are analyzing a sales call transcript for an SEO agency that sells to home service contractors.

Company: ${companyName || 'Unknown'}
Transcript: ${transcript}

Extract and return ONLY a JSON object with these fields:
{
  "summary": "2-3 sentence summary of the call",
  "callNotes": "Detailed notes about what was discussed, objections, interest level, next steps",
  "followUpCommitment": "Exact quote or description of any follow-up commitment made (e.g. 'call me in two weeks', 'send proposal by Friday')",
  "followUpDate": "ISO date string for the follow-up (calculate from today ${new Date().toISOString().split('T')[0]}), or null if none",
  "followUpTitle": "Short title for the calendar event (e.g. 'Follow-up call with ABC Plumbing')",
  "sentiment": "positive|neutral|negative",
  "interested": true or false
}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1000 },
        }),
      }
    );

    const data = await geminiRes.json();
    if (!geminiRes.ok) throw new Error(`Gemini API error: ${data.error?.message || JSON.stringify(data)}`);

    const analysisText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!analysisText) throw new Error('Gemini returned empty response');

    const usage = data.usageMetadata || {};

    // Log usage async
    const token = req.headers.authorization?.replace('Bearer ', '');
    const session = await getSession(token);
    if (session?.email) {
      logUsage(session.email, {
        claude_input: usage.promptTokenCount || 0,
        claude_output: usage.candidatesTokenCount || 0,
        calls: 1,
      }).catch(() => {});
    }

    let analysis;
    try {
      const clean = analysisText.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(clean);
    } catch {
      analysis = { summary: 'Could not parse analysis', callNotes: transcript };
    }

    return res.status(200).json({ analysis });
  } catch (err) {
    console.error('Analyze error:', err);
    return res.status(500).json({ error: err.message });
  }
}
