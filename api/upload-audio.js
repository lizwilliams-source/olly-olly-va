import { generateClientTokenFromReadWriteToken } from '@vercel/blob/client';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { type, payload } = req.body;

    // Completion callback from Vercel Blob after upload finishes
    if (type === 'blob.upload-completed') {
      return res.status(200).json({ type: 'blob.upload-completed', response: 'ok' });
    }

    // Token generation request from the browser
    if (type === 'blob.generate-client-token') {
      if (!process.env.BLOB_READ_WRITE_TOKEN) {
        return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN is not set' });
      }

      const host = (req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
      const callbackUrl = `https://${host}/api/upload-audio`;

      const clientToken = await generateClientTokenFromReadWriteToken({
        token: process.env.BLOB_READ_WRITE_TOKEN,
        pathname: payload.pathname,
        onUploadCompleted: { callbackUrl },
        addRandomSuffix: false,
      });

      return res.status(200).json({ type: 'blob.generate-client-token', clientToken });
    }

    return res.status(400).json({ error: 'Unknown request type' });
  } catch (err) {
    console.error('Upload audio error:', err);
    return res.status(400).json({ error: err.message });
  }
}
