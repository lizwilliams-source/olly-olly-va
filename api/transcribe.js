import { del } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { blobUrl, mimeType, companyName } = req.body;
    if (!blobUrl) return res.status(400).json({ error: 'No audio provided' });

    // Fetch audio from Vercel Blob
    const audioRes = await fetch(blobUrl);
    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    // Send to Whisper API
    const audioBlob = new Blob([audioBuffer], { type: mimeType || 'audio/mpeg' });
    const formData = new FormData();
    formData.append('file', audioBlob, 'recording.mp3');
    formData.append('model', 'whisper-1');
    formData.append('language', 'en');

    const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: formData,
    });

    const whisperData = await whisperRes.json();
    if (!whisperRes.ok) throw new Error(whisperData.error?.message || 'Transcription failed');

    const transcript = whisperData.text;

    // Now analyze with Claude
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
}`
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

    await del(blobUrl);
    return res.status(200).json({ transcript, analysis });
  } catch (err) {
    console.error('Transcribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
