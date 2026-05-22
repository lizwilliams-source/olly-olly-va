// api/admin-setup.js - One-time setup page served as HTML
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(`<!DOCTYPE html>
<html>
<head>
  <title>Olly Olly Setup</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Inter, sans-serif; background: #0f1117; color: #f0f0f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #1a1d27; border: 1px solid rgba(255,255,255,.08); border-radius: 12px; padding: 2rem; width: 400px; }
    h1 { font-size: 20px; font-weight: 600; margin-bottom: 6px; }
    p { font-size: 13px; color: #9899b0; margin-bottom: 1.5rem; }
    label { font-size: 11px; font-weight: 600; color: #9899b0; text-transform: uppercase; letter-spacing: .05em; display: block; margin-bottom: 5px; }
    input { width: 100%; background: #22263a; border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 9px 12px; font-size: 13px; color: #f0f0f5; outline: none; margin-bottom: 1rem; }
    button { width: 100%; background: #378ADD; border: none; border-radius: 6px; padding: 10px; font-size: 13px; font-weight: 600; color: #fff; cursor: pointer; }
    .msg { margin-top: 1rem; font-size: 13px; text-align: center; }
    .success { color: #3ecf8e; }
    .error { color: #f05252; }
  </style>
</head>
<body>
<div class="card">
  <h1>⚡ First Time Setup</h1>
  <p>Create your admin account. This page only works once.</p>
  <label>Your name</label>
  <input type="text" id="name" placeholder="Liz" />
  <label>Email</label>
  <input type="email" id="email" placeholder="liz@ollyolly.com" />
  <label>Password</label>
  <input type="password" id="password" placeholder="Create a password" />
  <button onclick="setup()">Create Admin Account</button>
  <div class="msg" id="msg"></div>
</div>
<script>
async function setup() {
  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value.trim();
  if (!email || !password) { document.getElementById('msg').innerHTML = '<span class="error">Email and password required</span>'; return; }
  const res = await fetch('/api/users?action=setup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  const data = await res.json();
  if (data.ok) {
    document.getElementById('msg').innerHTML = '<span class="success">✓ Admin created! <a href="/" style="color:#4f8ef7">Go to app →</a></span>';
  } else {
    document.getElementById('msg').innerHTML = '<span class="error">' + (data.error || 'Something went wrong') + '</span>';
  }
}
</script>
</body>
</html>`);
}
