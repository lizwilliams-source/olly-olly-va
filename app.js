// ─── STATE ────────────────────────────────────────────────────────────────────
const state = {
  contacts: [],
  deals: [],
  notes: {},
  tasks: {},
  currentView: 'dashboard',
  selectedContact: null,
  hsConnected: false,
  chatHistory: [],
  user: null,
  ownerId: null,
  token: null,
  isAdmin: false,
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  if (!email || !password) {
    errorEl.textContent = 'Email and password required';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const res = await fetch('/api/users?action=login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Invalid email or password';
      errorEl.style.display = 'block';
      return;
    }
    localStorage.setItem('oo_token', data.token);
    state.token = data.token;
    state.user = { email: data.email, name: data.name };
    state.ownerId = data.ownerId;
    state.isAdmin = data.isAdmin;
    showApp();
  } catch (e) {
    errorEl.textContent = 'Something went wrong. Try again.';
    errorEl.style.display = 'block';
  }
}

async function checkSession() {
  const token = localStorage.getItem('oo_token');
  if (!token) { showLogin(); return; }

  try {
    const res = await fetch('/api/users?action=verify', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { showLogin(); return; }
    const data = await res.json();
    state.token = token;
    state.user = { email: data.email, name: data.name };
    state.ownerId = data.ownerId;
    state.isAdmin = data.isAdmin;
    showApp();
  } catch (e) {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'grid';
  document.getElementById('user-info').textContent = `👤 ${state.user?.name || state.user?.email}`;
  if (state.isAdmin) document.getElementById('admin-nav').style.display = 'flex';

  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => showView(item.dataset.view));
  });
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target === document.getElementById('modal')) closeModal();
  });

  init();
}

async function signOut() {
  await fetch('/api/users?action=logout', {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  localStorage.removeItem('oo_token');
  state.token = null;
  state.user = null;
  state.ownerId = null;
  showLogin();
}

// ─── HubSpot API ──────────────────────────────────────────────────────────────
async function hsPost(path, body) {
  const res = await fetch('/api/hubspot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': path, 'X-HubSpot-Method': 'POST' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function hsPatch(path, body) {
  const res = await fetch('/api/hubspot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': path, 'X-HubSpot-Method': 'PATCH' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
async function loadContacts() {
  try {
    const filterGroups = state.ownerId ? [{
      filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }]
    }] : [];

    const data = await hsPost('/crm/v3/objects/companies/search', {
      filterGroups,
      properties: [
        'name', 'phone', 'city', 'state', 'website',
        'hubspot_owner_id', 'notes_last_contacted',
        'num_contacted_notes', 'hs_last_sales_activity_timestamp',
        'lifecyclestage', 'hs_lead_status', 'createdate', 'lastmodifieddate',
        'annualrevenue', 'numberofemployees', 'industry'
      ],
      sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }],
      limit: 100,
    });

    if (data.results) {
      state.contacts = data.results.map(enrichContact);
      state.hsConnected = true;
      updateHsStatus(true);
      updateBadges();
    }
  } catch (e) {
    console.error('Failed to load companies:', e);
    updateHsStatus(false);
  }
}

async function loadDeals() {
  try {
    const filterGroups = state.ownerId ? [{
      filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }]
    }] : [];

    const data = await hsPost('/crm/v3/objects/deals/search', {
      filterGroups,
      properties: ['dealname', 'amount', 'dealstage', 'closedate', 'hubspot_owner_id', 'hs_lastmodifieddate'],
      sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'DESCENDING' }],
      limit: 50,
    });
    if (data.results) state.deals = data.results;
  } catch (e) {
    console.error('Failed to load deals:', e);
  }
}

function enrichContact(raw) {
  const p = raw.properties;
  const lastContactedMs = p.notes_last_contacted ? new Date(p.notes_last_contacted).getTime() : null;
  const daysSince = lastContactedMs ? Math.floor((Date.now() - lastContactedMs) / 86400000) : 999;
  const score = calcScore(p, daysSince);
  const urgency = score >= 80 ? 'urgent' : score >= 60 ? 'warm' : score >= 40 ? 'cool' : 'new';
  const name = p.name || 'Unknown Company';
  const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return {
    id: raw.id,
    name,
    phone: p.phone || '',
    city: p.city || '',
    state: p.state || '',
    website: p.website || '',
    industry: p.industry || '',
    stage: p.lifecyclestage || p.hs_lead_status || 'lead',
    ownerId: p.hubspot_owner_id || '',
    daysSince,
    lastContacted: lastContactedMs ? new Date(lastContactedMs).toLocaleDateString() : 'Never',
    score,
    urgency,
    initials,
    avatarColor: avatarColor(raw.id),
    needsCall: daysSince > 7 || !lastContactedMs,
    createdAt: p.createdate,
  };
}

function calcScore(p, daysSince) {
  let s = 50;
  if (daysSince <= 1) s += 20;
  else if (daysSince <= 3) s += 10;
  else if (daysSince <= 7) s += 0;
  else if (daysSince <= 14) s -= 15;
  else if (daysSince <= 30) s -= 25;
  else s -= 35;
  const stage = (p.lifecyclestage || '').toLowerCase();
  if (stage === 'opportunity') s += 20;
  else if (stage === 'salesqualifiedlead') s += 15;
  else if (stage === 'marketingqualifiedlead') s += 10;
  else if (stage === 'lead') s += 5;
  if (p.num_contacted_notes > 5) s += 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function avatarColor(id) {
  const colors = [
    { bg: 'rgba(79,142,247,.2)', color: '#4f8ef7' },
    { bg: 'rgba(62,207,142,.2)', color: '#3ecf8e' },
    { bg: 'rgba(245,166,35,.2)', color: '#f5a623' },
    { bg: 'rgba(240,82,82,.2)', color: '#f05252' },
    { bg: 'rgba(167,139,250,.2)', color: '#a78bfa' },
  ];
  return colors[parseInt(id, 10) % colors.length] || colors[0];
}

function updateHsStatus(ok) {
  document.getElementById('hs-dot').className = 'hs-dot' + (ok ? '' : ' error');
  document.getElementById('hs-status-text').textContent = ok ? 'HubSpot connected' : 'HubSpot error';
}

function updateBadges() {
  const callNeeded = state.contacts.filter(c => c.needsCall).length;
  const followNeeded = state.contacts.filter(c => c.daysSince > 5 && c.daysSince < 30).length;
  document.getElementById('call-badge').textContent = callNeeded;
  document.getElementById('followup-badge').textContent = followNeeded;
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function askAI(userMsg, extraContext = '') {
  const contactSummary = state.contacts.slice(0, 20).map(c =>
    `${c.name} (score ${c.score}, last contact: ${c.lastContacted}, stage: ${c.stage}, location: ${c.city} ${c.state})`
  ).join('\n');

  const system = `You are the Olly Olly Virtual Assistant — a smart sales assistant for an SEO agency that sells to home service contractors. You are helping ${state.user?.name || 'a sales rep'} manage their assigned companies.

Their current companies (top 20):
${contactSummary}

${extraContext}

Be concise, friendly, and specific. When drafting emails, write the full email with subject line. When coaching, give concrete talk tracks and objection handling. Use actual company names and details.`;

  const messages = [...state.chatHistory, { role: 'user', content: userMsg }];

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1000, system, messages }),
  });

  if (!res.ok) throw new Error(`AI API error: ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  const reply = data.content?.map(b => b.text || '').join('') || 'Sorry, something went wrong.';
  state.chatHistory.push({ role: 'user', content: userMsg });
  state.chatHistory.push({ role: 'assistant', content: reply });
  if (state.chatHistory.length > 20) state.chatHistory = state.chatHistory.slice(-20);
  return reply;
}

// ─── VIEWS ────────────────────────────────────────────────────────────────────
function showView(view) {
  state.currentView = view;
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.view === view);
  });
  const views = {
    dashboard: renderDashboard,
    callqueue: renderCallQueue,
    followups: renderFollowups,
    contacts: renderContacts,
    pipeline: renderPipeline,
    ai: renderAI,
    coaching: renderCoaching,
    admin: renderAdmin,
  };
  document.getElementById('main').innerHTML = '';
  (views[view] || renderDashboard)();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const hot = state.contacts.filter(c => c.score >= 80).length;
  const callNeeded = state.contacts.filter(c => c.needsCall).length;
  const followNeeded = state.contacts.filter(c => c.daysSince > 5).length;
  const top3 = [...state.contacts].sort((a, b) => b.score - a.score).slice(0, 3);

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <h2>Good morning, ${state.user?.name || ''} 👋</h2>
        <p>${new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })} · ${callNeeded} companies need a call today</p>
      </div>
      <div class="topbar-right">
        <button class="btn" onclick="showView('callqueue')">📞 Call Queue</button>
        <button class="btn btn-primary" onclick="showView('ai')">✨ Ask AI</button>
      </div>
    </div>
    <div class="content">
      <div class="metrics-grid">
        <div class="metric-card blue"><div class="metric-label">My Companies</div><div class="metric-value">${state.contacts.length}</div><div class="metric-sub">Assigned to me</div></div>
        <div class="metric-card red"><div class="metric-label">Calls Needed</div><div class="metric-value">${callNeeded}</div><div class="metric-sub">Haven't called in 7+ days</div></div>
        <div class="metric-card amber"><div class="metric-label">Follow-ups Due</div><div class="metric-value">${followNeeded}</div><div class="metric-sub">5+ days since contact</div></div>
        <div class="metric-card green"><div class="metric-label">Hot Leads</div><div class="metric-value">${hot}</div><div class="metric-sub">Score 80+</div></div>
      </div>

      <div id="ai-daily-insight" class="ai-insight">
        <div class="ai-insight-header"><div class="ai-insight-icon">✨</div><div class="ai-insight-title">AI Daily Briefing</div></div>
        <div class="ai-insight-body"><span class="spinner"></span> Analyzing your companies...</div>
      </div>

      <div>
        <div class="section-header"><span class="section-title">🔥 Top Priority Companies</span><span class="section-link" onclick="showView('contacts')">See all →</span></div>
        <div class="lead-list" style="margin-top:8px">${top3.map(leadCardHTML).join('')}</div>
      </div>

      <div>
        <div class="section-header"><span class="section-title">📞 Call Queue Preview</span><span class="section-link" onclick="showView('callqueue')">Open queue →</span></div>
        <div class="lead-list" style="margin-top:8px">${state.contacts.filter(c => c.needsCall).slice(0,3).map(callQueueItemHTML).join('')}</div>
      </div>
    </div>`;

  try {
    const insight = await askAI(
      `Give me a sharp 2-sentence morning briefing: which of my companies should I prioritize today and why? Be specific with names.`,
      `Today's date: ${new Date().toLocaleDateString()}`
    );
    document.querySelector('#ai-daily-insight .ai-insight-body').innerHTML = insight.replace(/\n/g,'<br>') +
      `<div class="ai-chips">
        <div class="ai-chip" onclick="openAIWithPrompt('Draft follow-up emails for my top 3 priority companies today')">Draft top 3 emails ↗</div>
        <div class="ai-chip" onclick="showView('callqueue')">Open call queue</div>
        <div class="ai-chip" onclick="openAIWithPrompt('Give me a coaching tip for my hardest objection today')">Get coaching tip ↗</div>
      </div>`;
  } catch(e) {
    document.querySelector('#ai-daily-insight .ai-insight-body').textContent = 'AI briefing unavailable.';
  }
}

// ── CALL QUEUE ────────────────────────────────────────────────────────────────
function renderCallQueue() {
  const toCall = [...state.contacts]
    .filter(c => c.needsCall)
    .sort((a, b) => b.score - a.score);

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>📞 Call Queue</h2><p>${toCall.length} companies need a call · Sorted by priority score</p></div>
      <div class="topbar-right">
        <button class="btn btn-primary" onclick="openAIWithPrompt('Give me a call script for my top priority company today. Include an opener, key questions, and how to handle if they say they are busy.')">✨ Get call script</button>
      </div>
    </div>
    <div class="content">
      <div class="ai-insight">
        <div class="ai-insight-header"><div class="ai-insight-icon">💡</div><div class="ai-insight-title">Smart Dialing Order</div></div>
        <div class="ai-insight-body">Companies sorted by AI priority score. Call top scores first. Phone numbers are clickable — Aloware will intercept automatically. Companies with no call history are flagged 🆕.</div>
      </div>
      ${toCall.length === 0
        ? '<div class="empty-state">🎉 No calls needed right now!</div>'
        : '<div class="lead-list">' + toCall.map(callQueueItemHTML).join('') + '</div>'}
    </div>`;
}

function callQueueItemHTML(c) {
  const priority = c.score >= 80 ? 1 : c.score >= 60 ? 2 : 3;
  const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
  const cleanPhone = c.phone ? c.phone.replace(/\D/g,'') : '';
  const phoneDisplay = c.phone
    ? `<a href="tel:${cleanPhone}" onclick="event.stopPropagation()" style="color:var(--green);text-decoration:none;font-weight:600" title="Click to call via Aloware">📞 ${c.phone}</a>`
    : '<span style="color:var(--text3)">No phone</span>';
  return `<div class="call-queue-item priority-${priority}" onclick="openContact('${c.id}')">
    <div class="avatar" style="background:${c.avatarColor.bg};color:${c.avatarColor.color}">${c.initials}</div>
    <div style="min-width:0;flex:1">
      <div class="lead-name" style="display:flex;align-items:center;gap:8px">
        ${c.name} ${c.daysSince === 999 ? '🆕' : ''}
        <a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
      </div>
      <div class="lead-meta" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:3px">
        <span>${c.city ? `${c.city}, ${c.state}` : c.state || 'No location'}</span>
        <span>·</span>
        ${phoneDisplay}
        <span>·</span>
        <span>Last call: ${c.lastContacted}</span>
      </div>
    </div>
    <div class="call-actions">
      <button class="btn btn-sm btn-call" onclick="event.stopPropagation();logCall('${c.id}')">✅ Log call</button>
      <button class="btn btn-sm" onclick="event.stopPropagation();openAIWithPrompt('Write a call script for ${c.name}. Stage: ${c.stage}. Include opener, discovery questions, and objection handling.')">✨ Script</button>
    </div>
  </div>`;
}

// ── FOLLOW-UPS ────────────────────────────────────────────────────────────────
function renderFollowups() {
  const due = [...state.contacts]
    .filter(c => c.daysSince > 5 && c.daysSince < 60)
    .sort((a, b) => b.score - a.score);

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🔔 Follow-ups</h2><p>${due.length} companies need a follow-up</p></div>
      <div class="topbar-right">
        <button class="btn btn-primary" onclick="openAIWithPrompt('Draft follow-up emails for my top 5 companies that need outreach. Make each one personalized and specific.')">✨ Draft all emails</button>
      </div>
    </div>
    <div class="content">
      ${due.length === 0 ? '<div class="empty-state">🎉 All caught up!</div>' :
        '<div class="lead-list">' + due.map(c => {
          const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
          return `<div class="lead-card ${c.urgency}" onclick="openContact('${c.id}')">
            <div class="avatar" style="background:${c.avatarColor.bg};color:${c.avatarColor.color}">${c.initials}</div>
            <div>
              <div class="lead-name" style="display:flex;align-items:center;gap:8px">
                ${c.name}
                <a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
              </div>
              <div class="lead-meta">${c.city ? `${c.city}, ${c.state}` : 'No location'} · ${c.daysSince === 999 ? 'Never contacted' : `${c.daysSince} days since contact`}</div>
            </div>
            <div class="lead-right">
              <span class="score-badge score-${c.urgency === 'urgent' ? 'hot' : c.urgency}">${c.score}</span>
              <button class="btn btn-sm" onclick="event.stopPropagation();openAIWithPrompt('Draft a follow-up email to ${c.name}. Stage: ${c.stage}. Last contacted: ${c.lastContacted}. Make it warm and specific.')">✨ Draft email</button>
            </div>
          </div>`;
        }).join('') + '</div>'}
    </div>`;
}

// ── COMPANIES ─────────────────────────────────────────────────────────────────
function renderContacts() {
  const sorted = [...state.contacts].sort((a, b) => b.score - a.score);
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🏢 My Companies</h2><p>${sorted.length} companies assigned to you</p></div>
      <div class="topbar-right">
        <input id="contact-search" placeholder="Search companies..." style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;width:200px" oninput="filterContacts(this.value)" />
      </div>
    </div>
    <div class="content">
      <div class="lead-list" id="contact-list">${sorted.map(leadCardHTML).join('')}</div>
    </div>`;
}

function filterContacts(q) {
  const list = document.getElementById('contact-list');
  const filtered = state.contacts.filter(c =>
    c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.city || '').toLowerCase().includes(q.toLowerCase()) ||
    (c.industry || '').toLowerCase().includes(q.toLowerCase())
  );
  list.innerHTML = filtered.length ? filtered.map(leadCardHTML).join('') : '<div class="empty-state">No companies found</div>';
}

function leadCardHTML(c) {
  const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
  return `<div class="lead-card ${c.urgency}" onclick="openContact('${c.id}')">
    <div class="avatar" style="background:${c.avatarColor.bg};color:${c.avatarColor.color}">${c.initials}</div>
    <div>
      <div class="lead-name" style="display:flex;align-items:center;gap:8px">
        ${c.name}
        <a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
      </div>
      <div class="lead-meta">${c.city ? `${c.city}, ${c.state}` : 'No location'} · ${c.daysSince === 999 ? 'Never contacted' : `Last contact: ${c.lastContacted}`}</div>
    </div>
    <div class="lead-right">
      <span class="score-badge score-${c.urgency === 'urgent' ? 'hot' : c.urgency}">${c.score}</span>
      <span class="last-contact">${c.stage}</span>
    </div>
  </div>`;
}

// ── PIPELINE ──────────────────────────────────────────────────────────────────
function renderPipeline() {
  const stages = {
    lead: { label: 'Lead', class: 'prospect', contacts: [] },
    marketingqualifiedlead: { label: 'MQL', class: 'prospect', contacts: [] },
    salesqualifiedlead: { label: 'SQL', class: 'demo', contacts: [] },
    opportunity: { label: 'Opportunity', class: 'negotiation', contacts: [] },
    customer: { label: 'Customer', class: 'closed', contacts: [] },
  };
  state.contacts.forEach(c => {
    const key = (c.stage || 'lead').toLowerCase().replace(/\s/g, '');
    if (stages[key]) stages[key].contacts.push(c);
    else stages['lead'].contacts.push(c);
  });
  const cols = Object.entries(stages).map(([, s]) => `
    <div>
      <div class="pipeline-col-header ${s.class}">${s.label} (${s.contacts.length})</div>
      <div class="pipeline-cards">
        ${s.contacts.length === 0 ? '<div style="font-size:11px;color:var(--text3);padding:8px 0">None</div>' :
          s.contacts.map(c => {
            const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
            return `<div class="pipeline-card" onclick="openContact('${c.id}')">
              <div class="pipeline-card-name" style="display:flex;align-items:center;gap:6px">
                ${c.name}
                <a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:9px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 5px;border-radius:4px">HS ↗</a>
              </div>
              <div class="pipeline-card-company">${c.city ? `${c.city}, ${c.state}` : c.industry || 'No location'}</div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px">
                <span class="score-badge score-${c.urgency === 'urgent' ? 'hot' : c.urgency}" style="font-size:9px">${c.score}</span>
                <span style="font-size:10px;color:var(--text3)">${c.daysSince === 999 ? 'Never called' : `${c.daysSince}d ago`}</span>
              </div>
            </div>`;
          }).join('')}
      </div>
    </div>`).join('');
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>📊 Pipeline</h2><p>${state.contacts.length} companies across stages</p></div>
      <div class="topbar-right">
        <button class="btn btn-primary" onclick="openAIWithPrompt('Analyze my pipeline and tell me which companies are most likely to close this month and what I should do with each.')">✨ Analyze pipeline</button>
      </div>
    </div>
    <div class="content">
      <div class="pipeline-board">${cols}</div>
    </div>`;
}

// ── AI ASSISTANT ──────────────────────────────────────────────────────────────
function renderAI() {
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>✨ AI Assistant</h2><p>Ask anything about your companies, get emails drafted, coaching, and more</p></div>
    </div>
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-messages">
        <div class="msg ai">
          <div class="msg-label">Assistant</div>
          <div class="msg-bubble">Hi ${state.user?.name || 'there'}! I'm connected to your HubSpot companies and ready to help. What do you need?</div>
        </div>
        <div class="ai-chips" style="padding:0 0 8px">
          <div class="ai-chip" onclick="sendPreset('Who are my top 3 companies to focus on today and why?')">Today's priorities ↗</div>
          <div class="ai-chip" onclick="sendPreset('Draft follow-up emails for my top 5 companies that need outreach')">Draft follow-ups ↗</div>
          <div class="ai-chip" onclick="sendPreset('Give me a cold call script for a new lead in the discovery stage')">Call script ↗</div>
          <div class="ai-chip" onclick="sendPreset('Analyze my pipeline and tell me what is at risk')">Pipeline analysis ↗</div>
          <div class="ai-chip" onclick="sendPreset('Give me tips for handling the objection: we do not have budget right now')">Handle objection ↗</div>
        </div>
        ${state.chatHistory.map(m => `
          <div class="msg ${m.role === 'user' ? 'user' : 'ai'}">
            <div class="msg-label">${m.role === 'user' ? 'You' : 'Assistant'}</div>
            <div class="msg-bubble">${m.content.replace(/\n/g, '<br>')}</div>
          </div>`).join('')}
      </div>
      <div class="chat-input-area">
        <input id="chat-input" placeholder="Ask about a company, request a draft, get coaching..." onkeydown="if(event.key==='Enter')sendChat()" />
        <button class="btn btn-primary" onclick="sendChat()">Send →</button>
      </div>
    </div>`;
  scrollChat();
}

async function sendChat() {
  const input = document.getElementById('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';
  appendMsg('user', msg);
  const loadId = appendLoading();
  try {
    const reply = await askAI(msg);
    document.getElementById(loadId).outerHTML = `
      <div class="msg ai"><div class="msg-label">Assistant</div><div class="msg-bubble">${reply.replace(/\n/g, '<br>')}</div></div>`;
  } catch(e) {
    document.getElementById(loadId).outerHTML = `<div class="msg ai"><div class="msg-label">Assistant</div><div class="msg-bubble" style="color:var(--red)">Error: ${e.message}</div></div>`;
  }
  scrollChat();
}

function sendPreset(msg) {
  if (state.currentView !== 'ai') showView('ai');
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) { input.value = msg; sendChat(); }
  }, 100);
}

function openAIWithPrompt(msg) {
  showView('ai');
  setTimeout(() => {
    const input = document.getElementById('chat-input');
    if (input) { input.value = msg; sendChat(); }
  }, 150);
}

function appendMsg(role, text) {
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return;
  msgs.innerHTML += `<div class="msg ${role}"><div class="msg-label">${role === 'user' ? 'You' : 'Assistant'}</div><div class="msg-bubble">${text.replace(/\n/g, '<br>')}</div></div>`;
  scrollChat();
}

function appendLoading() {
  const id = 'load-' + Date.now();
  const msgs = document.getElementById('chat-messages');
  if (!msgs) return id;
  msgs.innerHTML += `<div class="msg ai" id="${id}"><div class="msg-bubble"><span class="spinner"></span> Thinking...</div></div>`;
  scrollChat();
  return id;
}

function scrollChat() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ── SALES COACHING ────────────────────────────────────────────────────────────
function renderCoaching() {
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🎯 Sales Coaching</h2><p>Coming soon</p></div>
    </div>
    <div class="content">
      <div style="text-align:center;padding:60px 20px">
        <div style="font-size:48px;margin-bottom:16px">🎯</div>
        <div style="font-size:18px;font-weight:600;color:var(--text);margin-bottom:8px">Sales Coaching</div>
        <div style="font-size:13px;color:var(--text2);max-width:360px;margin:0 auto 24px">Personalized coaching, objection handling scripts, and talk tracks — coming soon.</div>
        <button class="btn btn-primary" onclick="openAIWithPrompt('Give me 3 sales coaching tips specific to selling SEO to home service contractors')">✨ Ask AI for coaching now</button>
      </div>
    </div>`;
}

// ── ADMIN ─────────────────────────────────────────────────────────────────────
async function renderAdmin() {
  if (!state.isAdmin) { showView('dashboard'); return; }

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>⚙️ Admin</h2><p>Manage team members</p></div>
    </div>
    <div class="content">

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">

        <!-- SINGLE ADD -->
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
          <div class="section-title" style="margin-bottom:12px">Add one person</div>
          <div style="margin-bottom:8px">
            <div class="field-label" style="margin-bottom:4px">Full name</div>
            <input id="new-name" placeholder="Jane Smith" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" oninput="autoFillUser()" />
          </div>
          <div style="margin-bottom:8px">
            <div class="field-label" style="margin-bottom:4px">Email</div>
            <input id="new-email" placeholder="Auto-filled from name" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" />
          </div>
          <div style="margin-bottom:12px">
            <div class="field-label" style="margin-bottom:4px">Password</div>
            <input id="new-password" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" value="OllyOlly2025!" />
          </div>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2);cursor:pointer"><input type="checkbox" id="new-admin" /> Make admin</label>
          </div>
          <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="addUser()">Add user</button>
          <div id="add-msg" style="font-size:12px;margin-top:8px"></div>
        </div>

        <!-- BULK ADD -->
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
          <div class="section-title" style="margin-bottom:4px">Bulk add</div>
          <div style="font-size:11px;color:var(--text2);margin-bottom:10px">One full name per line. Email and password auto-generated.</div>
          <textarea id="bulk-names" placeholder="Jane Smith&#10;John Doe&#10;Sarah Connor" style="width:100%;height:140px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none;resize:none;font-family:inherit"></textarea>
          <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" onclick="bulkAddUsers()">Add all</button>
          <div id="bulk-msg" style="font-size:12px;margin-top:8px;line-height:1.6"></div>
        </div>
      </div>

      <div style="border-top:1px solid var(--border);padding-top:16px">
        <div class="section-title" style="margin-bottom:12px">Team members</div>
        <div id="user-list"><span class="spinner"></span> Loading...</div>
      </div>
    </div>`;

  loadUserList();
}

function autoFillUser() {
  const name = document.getElementById('new-name').value.trim();
  const parts = name.split(' ');
  if (parts.length >= 2) {
    const email = `${parts[0].toLowerCase()}.${parts[parts.length-1].toLowerCase()}@ollyolly.com`;
    document.getElementById('new-email').value = email;
  }
}

async function bulkAddUsers() {
  const names = document.getElementById('bulk-names').value.trim().split('\n').map(n => n.trim()).filter(Boolean);
  const msg = document.getElementById('bulk-msg');
  if (!names.length) { msg.style.color = 'var(--red)'; msg.textContent = 'No names entered'; return; }

  msg.style.color = 'var(--text2)';
  msg.textContent = `Adding ${names.length} users...`;

  const results = [];
  for (const name of names) {
    const parts = name.split(' ');
    if (parts.length < 2) { results.push(`⚠ ${name} — needs first and last name`); continue; }
    const email = `${parts[0].toLowerCase()}.${parts[parts.length-1].toLowerCase()}@ollyolly.com`;
    const password = 'OllyOlly2025!';
    try {
      const res = await fetch('/api/users?action=add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
        body: JSON.stringify({ name, email, password, isAdmin: false }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        results.push(`✓ ${name} — ${email}${data.ownerId ? '' : ' (no HubSpot match)'}`);
      } else {
        results.push(`✗ ${name} — ${data.error || 'Failed'}`);
      }
    } catch {
      results.push(`✗ ${name} — failed`);
    }
  }

  msg.innerHTML = results.map(r => `<div style="color:${r.startsWith('✓') ? 'var(--green)' : r.startsWith('⚠') ? 'var(--amber)' : 'var(--red)'}">${r}</div>`).join('');
  document.getElementById('bulk-names').value = '';
  loadUserList();
}

async function loadUserList() {
  const res = await fetch('/api/users?action=list', {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  const users = await res.json();
  const list = document.getElementById('user-list');
  if (!Array.isArray(users)) { list.innerHTML = '<div style="color:var(--red);font-size:13px">Failed to load users</div>'; return; }
  list.innerHTML = users.map(u => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:500">${u.name} ${u.isAdmin ? '<span style="font-size:10px;background:var(--blue-dim);color:var(--blue);padding:1px 6px;border-radius:4px">admin</span>' : ''}</div>
        <div style="font-size:11px;color:var(--text2)">${u.email} · HubSpot owner: ${u.ownerId || 'not found'}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-sm" onclick="editUser('${u.email}','${u.name}')">Edit</button>
        <button class="btn btn-sm" style="color:var(--red);border-color:rgba(240,82,82,.3)" onclick="deleteUser('${u.email}')">Remove</button>
      </div>
    </div>`).join('');
}

async function addUser() {
  const name = document.getElementById('new-name').value.trim();
  const email = document.getElementById('new-email').value.trim();
  const password = document.getElementById('new-password').value.trim();
  const isAdmin = document.getElementById('new-admin').checked;
  const msg = document.getElementById('add-msg');

  if (!email || !password) { msg.style.color = 'var(--red)'; msg.textContent = 'Email and password required'; return; }

  const res = await fetch('/api/users?action=add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ name, email, password, isAdmin }),
  });
  const data = await res.json();
  if (data.ok) {
    msg.style.color = 'var(--green)';
    msg.textContent = `✓ Added! HubSpot owner ID: ${data.ownerId || 'not found in HubSpot'}`;
    document.getElementById('new-name').value = '';
    document.getElementById('new-email').value = '';
    document.getElementById('new-password').value = '';
    loadUserList();
  } else {
    msg.style.color = 'var(--red)';
    msg.textContent = data.error || 'Failed to add user';
  }
}

async function deleteUser(email) {
  if (!confirm(`Remove ${email}?`)) return;
  await fetch('/api/users?action=delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ email }),
  });
  loadUserList();
}

// ── CONTACT MODAL ─────────────────────────────────────────────────────────────
async function openContact(id) {
  const c = state.contacts.find(x => x.id === id);
  if (!c) return;
  state.selectedContact = c;
  const notes = state.notes[id] || [];
  const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
  const cleanPhone = c.phone ? c.phone.replace(/\D/g,'') : '';

  document.getElementById('modal-title').innerHTML = `${c.name} <a href="${hsUrl}" target="_blank" style="font-size:11px;color:var(--blue);text-decoration:none;font-weight:400">Open in HubSpot ↗</a>`;
  document.getElementById('modal-body').innerHTML = `
    <div class="field-row">
      <div><div class="field-label">Location</div><div class="field-value">${c.city ? `${c.city}, ${c.state}` : '—'}</div></div>
      <div><div class="field-label">Industry</div><div class="field-value">${c.industry || '—'}</div></div>
    </div>
    <div class="field-row">
      <div><div class="field-label">Phone</div><div class="field-value">
        ${c.phone ? `<a href="tel:${cleanPhone}" style="color:var(--green);text-decoration:none;font-weight:600">📞 ${c.phone}</a>` : '—'}
      </div></div>
      <div><div class="field-label">Website</div><div class="field-value">
        ${c.website ? `<a href="${c.website}" target="_blank" style="color:var(--blue);text-decoration:none">${c.website}</a>` : '—'}
      </div></div>
    </div>
    <div class="field-row">
      <div><div class="field-label">Stage</div><div class="field-value">${c.stage}</div></div>
      <div><div class="field-label">AI Score</div><div class="field-value" style="color:var(--${c.urgency === 'urgent' ? 'red' : c.urgency === 'warm' ? 'amber' : 'blue'})">${c.score} / 100</div></div>
    </div>
    <div class="field-row">
      <div><div class="field-label">Last Contact</div><div class="field-value">${c.lastContacted}</div></div>
      <div><div class="field-label">Days Since</div><div class="field-value">${c.daysSince === 999 ? 'Never' : c.daysSince + ' days'}</div></div>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px">
      <div class="field-label" style="margin-bottom:8px">Log a note</div>
      <textarea id="note-input" placeholder="Add a call note, meeting summary, anything..."></textarea>
      <button class="btn btn-primary btn-sm" style="margin-top:6px" onclick="saveNote('${id}')">Save note to HubSpot</button>
    </div>
    <div style="border-top:1px solid var(--border);padding-top:14px">
      <div class="field-label" style="margin-bottom:8px">Notes (${notes.length})</div>
      <div class="notes-area" id="notes-list">
        ${notes.length === 0 ? '<div style="font-size:12px;color:var(--text3)">No notes yet</div>' :
          notes.map(n => `<div class="note-card"><div class="note-meta">${n.date}</div><div class="note-body">${n.text}</div></div>`).join('')}
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>
    <button class="btn btn-sm" onclick="logCall('${id}')">✅ Log call</button>
    <button class="btn btn-sm" onclick="openAIWithPrompt('Draft a follow-up email to ${c.name}. Stage: ${c.stage}. Last contacted: ${c.lastContacted}. Be warm and specific.')">✨ Draft email</button>
    <button class="btn btn-primary btn-sm" onclick="openAIWithPrompt('Give me a call script for ${c.name}. Stage: ${c.stage}. Include opener, key questions, and objection handling.')">📞 Call script</button>`;

  document.getElementById('modal').style.display = 'flex';
}

async function saveNote(contactId) {
  const input = document.getElementById('note-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await hsPost('/crm/v3/objects/notes', {
      properties: { hs_note_body: text, hs_timestamp: Date.now() },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }],
    });
    toast('Note saved to HubSpot ✓', 'success');
  } catch {
    toast('Saved locally (HubSpot sync failed)', 'error');
  }
  if (!state.notes[contactId]) state.notes[contactId] = [];
  state.notes[contactId].unshift({ text, date: new Date().toLocaleString() });
  input.value = '';
  const list = document.getElementById('notes-list');
  if (list) list.innerHTML = state.notes[contactId].map(n =>
    `<div class="note-card"><div class="note-meta">${n.date}</div><div class="note-body">${n.text}</div></div>`
  ).join('');
}

async function logCall(contactId) {
  const c = state.contacts.find(x => x.id === contactId);
  if (!c) return;
  try {
    await hsPost('/crm/v3/objects/calls', {
      properties: {
        hs_call_body: `Call logged via Olly Olly Virtual Assistant`,
        hs_timestamp: Date.now(),
        hs_call_status: 'COMPLETED',
        hs_call_duration: 0,
      },
      associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 182 }] }],
    });
    toast(`Call logged for ${c.name} ✓`, 'success');
    const contact = state.contacts.find(x => x.id === contactId);
    if (contact) {
      contact.daysSince = 0;
      contact.lastContacted = new Date().toLocaleDateString();
      contact.needsCall = false;
      contact.score = Math.min(100, contact.score + 10);
      updateBadges();
    }
  } catch {
    toast('Failed to log call', 'error');
  }
}

function closeModal() {
  document.getElementById('modal').style.display = 'none';
}

async function editUser(email, name) {
  const newName = prompt('Name:', name);
  if (!newName) return;
  const newPassword = prompt('New password (leave blank to keep current):', '');
  
  const res = await fetch('/api/users?action=edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ email, name: newName, password: newPassword || null }),
  });
  const data = await res.json();
  if (data.ok) { toast('User updated ✓', 'success'); loadUserList(); }
  else toast(data.error || 'Failed to update', 'error');
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${type === 'success' ? '✓' : '⚠'} ${msg}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
  showView('dashboard');
  await Promise.all([loadContacts(), loadDeals()]);
  if (state.currentView === 'dashboard') showView('dashboard');
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
checkSession();
