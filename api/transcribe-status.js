import { del } from '@vercel/blob';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { jobId, companyName, blobUrl } = req.query;

    const statusRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
      headers: { 'Authorization': process.env.ASSEMBLYAI_API_KEY },
    });

    const data = await statusRes.json();

    if (data.status === 'error') {
      if (blobUrl) await del(blobUrl).catch(() => {});
      return res.status(500).json({ error: data.error || 'Transcription failed' });
    }

    if (data.status !== 'completed') {
      return res.status(200).json({ status: data.status });
    }

    const transcript = data.text;

    const analysisRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `You are analyzing a sales call transcript for an SEO agency that sells to home service contractors.

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
}`,
        }],
      }),
    });

    const analysisData = await analysisRes.json();
    const analysisText = analysisData.content?.[0]?.text || '{}';

    let analysis;
    try {
      const clean = analysisText.replace(/```json|```/g, '').trim();
      analysis = JSON.parse(clean);
    } catch {
      analysis = { summary: 'Could not parse analysis', callNotes: transcript };
    }

    if (blobUrl) await del(blobUrl).catch(() => {});
    return res.status(200).json({ status: 'completed', transcript, analysis });
  } catch (err) {
    console.error('Transcribe status error:', err);
    return res.status(500).json({ error: err.message });
  }
}
