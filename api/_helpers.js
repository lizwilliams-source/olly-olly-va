const KV_URL = () => process.env.KV_REST_API_URL;
const KV_TOKEN = () => process.env.KV_REST_API_TOKEN;
const kvHeaders = () => ({ Authorization: `Bearer ${KV_TOKEN()}` });

export async function getSession(token) {
  if (!token) return null;
  const res = await fetch(`${KV_URL()}/get/${encodeURIComponent(`session:${token}`)}`, { headers: kvHeaders() });
  const data = await res.json();
  return data.result ? JSON.parse(data.result) : null;
}

export async function logUsage(email, data) {
  const month = new Date().toISOString().slice(0, 7);
  const key = `usage:${email}:${month}`;
  const res = await fetch(`${KV_URL()}/get/${encodeURIComponent(key)}`, { headers: kvHeaders() });
  const existing = await res.json().then(d => d.result ? JSON.parse(d.result) : {});
  const updated = {
    groq_seconds: (existing.groq_seconds || 0) + (data.groq_seconds || 0),
    claude_input:  (existing.claude_input  || 0) + (data.claude_input  || 0),
    claude_output: (existing.claude_output || 0) + (data.claude_output || 0),
    calls:         (existing.calls         || 0) + (data.calls         || 0),
    ai_queries:    (existing.ai_queries    || 0) + (data.ai_queries    || 0),
  };
  await fetch(`${KV_URL()}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(updated))}`, { headers: kvHeaders() });
}
