import { getSession } from './_helpers.js';

const KV_URL = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;
const kvHeaders = () => ({ Authorization: `Bearer ${KV_TOKEN()}` });

async function getPipeline(email) {
  const res = await fetch(`${KV_URL()}/get/${encodeURIComponent(`pipeline:${email}`)}`, { headers: kvHeaders() });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : [];
}

async function savePipeline(email, pipeline) {
  await fetch(`${KV_URL()}/set/${encodeURIComponent(`pipeline:${email}`)}/${encodeURIComponent(JSON.stringify(pipeline))}`, { headers: kvHeaders() });
}


async function getLabels(email) {
  const res = await fetch(`${KV_URL()}/get/${encodeURIComponent(`pipeline_labels:${email}`)}`, { headers: kvHeaders() });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

async function saveLabels(email, labels) {
  await fetch(`${KV_URL()}/set/${encodeURIComponent(`pipeline_labels:${email}`)}/${encodeURIComponent(JSON.stringify(labels))}`, { headers: kvHeaders() });
}
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const token = req.headers.authorization?.replace('Bearer ', '');
  const session = await getSession(token);
  if (!session?.email) return res.status(401).json({ error: 'Unauthorized' });

  if (req.method === 'GET') {
    if (req.query.action === 'labels') {
      const labels = await getLabels(session.email);
      return res.status(200).json({ labels });
    }
    const pipeline = await getPipeline(session.email);
    return res.status(200).json({ pipeline });
  }

  if (req.method === 'POST') {
    const { action, companyId, companyName, status } = req.body;
    let pipeline = await getPipeline(session.email);

    if (action === 'labels') {
      const { labels } = req.body;
      await saveLabels(session.email, labels);
      return res.status(200).json({ ok: true });
    }

    if (action === 'add') {
      if (!pipeline.find(p => p.companyId === companyId)) {
        pipeline.push({ companyId, companyName, status: 'following_up', addedAt: new Date().toISOString() });
      }
    } else if (action === 'remove') {
      pipeline = pipeline.filter(p => p.companyId !== companyId);
    } else if (action === 'update') {
      const entry = pipeline.find(p => p.companyId === companyId);
      if (entry) entry.status = status;
    }

    await savePipeline(session.email, pipeline);
    return res.status(200).json({ pipeline });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
