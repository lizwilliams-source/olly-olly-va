export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { blobUrl, companyName } = req.body;
    if (!blobUrl) return res.status(400).json({ error: 'No audio provided' });

    const submitRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: {
        'Authorization': process.env.ASSEMBLYAI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ audio_url: blobUrl, language_code: 'en' }),
    });

    const submitData = await submitRes.json();
    if (!submitRes.ok) throw new Error(submitData.error || 'Failed to submit transcription');

    return res.status(200).json({ jobId: submitData.id });
  } catch (err) {
    console.error('Transcribe error:', err);
    return res.status(500).json({ error: err.message });
  }
}
