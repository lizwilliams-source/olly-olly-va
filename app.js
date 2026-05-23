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
  queue: [],
  contactsPage: 0,
  contactsTotal: 0,
  contactsPageSize: 50,
};

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value.trim();
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';
  if (!email || !password) { errorEl.textContent = 'Email and password required'; errorEl.style.display = 'block'; return; }
  try {
    const res = await fetch('/api/users?action=login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (!res.ok) { errorEl.textContent = data.error || 'Invalid email or password'; errorEl.style.display = 'block'; return; }
    localStorage.setItem('oo_token', data.token);
    state.token = data.token;
    state.user = { email: data.email, name: data.name };
    state.ownerId = data.ownerId;
    state.isAdmin = data.isAdmin;
    if (!data.ownerId) { showOwnerSetup(); } else { showApp(); }
  } catch (e) { errorEl.textContent = 'Something went wrong. Try again.'; errorEl.style.display = 'block'; }
}

async function checkSession() {
  const token = localStorage.getItem('oo_token');
  if (!token) { showLogin(); return; }
  try {
    const res = await fetch('/api/users?action=verify', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) { showLogin(); return; }
    const data = await res.json();
    state.token = token;
    state.user = { email: data.email, name: data.name };
    state.ownerId = data.ownerId;
    state.isAdmin = data.isAdmin;
    if (!state.ownerId) { showOwnerSetup(); } else { showApp(); }
  } catch (e) { showLogin(); }
}

function showLogin() {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-screen').style.display = 'none';
}

function showOwnerSetup() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'none';
  document.getElementById('owner-setup-screen').style.display = 'flex';
}

async function saveOwnerFromUrl() {
  const url = document.getElementById('hs-url-input').value.trim();
  const errorEl = document.getElementById('owner-setup-error');
  errorEl.style.display = 'none';
  const contactMatch = url.match(/\/contact\/(\d+)/);
  const companyMatch = url.match(/\/company\/(\d+)/);
  const recordMatch = url.match(/\/record\/0-[12]\/(\d+)/);
  const isCompany = !!companyMatch || url.includes('/record/0-2/');
  const recordId = contactMatch?.[1] || companyMatch?.[1] || recordMatch?.[1];
  if (!recordId) { errorEl.textContent = 'Could not find a contact or company ID in that URL.'; errorEl.style.display = 'block'; return; }
  const btn = document.getElementById('owner-setup-btn');
  btn.textContent = 'Looking up...'; btn.disabled = true;
  try {
    const path = isCompany ? `/crm/v3/objects/companies/${recordId}?properties=hubspot_owner_id` : `/crm/v3/objects/contacts/${recordId}?properties=hubspot_owner_id`;
    const res = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': path, 'X-HubSpot-Method': 'GET' }, body: JSON.stringify({}) });
    const data = await res.json();
    const ownerId = data.properties?.hubspot_owner_id;
    if (!ownerId) { errorEl.textContent = "That record doesn't have an owner assigned. Try a different one."; errorEl.style.display = 'block'; btn.textContent = 'Set up my account'; btn.disabled = false; return; }
    const saveRes = await fetch('/api/users?action=setowner', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ ownerId }) });
    const saveData = await saveRes.json();
    if (!saveData.ok) throw new Error(saveData.error || 'Failed to save');
    state.ownerId = ownerId;
    document.getElementById('owner-setup-screen').style.display = 'none';
    showApp();
  } catch (e) { errorEl.textContent = 'Something went wrong: ' + e.message; errorEl.style.display = 'block'; btn.textContent = 'Set up my account'; btn.disabled = false; }
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-screen').style.display = 'grid';
  document.getElementById('user-info').textContent = `👤 ${state.user?.name || state.user?.email}`;
  if (state.isAdmin) document.getElementById('admin-nav').style.display = 'flex';
  document.querySelectorAll('.nav-item').forEach(item => { item.addEventListener('click', () => showView(item.dataset.view)); });
  document.getElementById('modal').addEventListener('click', e => { if (e.target === document.getElementById('modal')) closeModal(); });
  init();
}

async function signOut() {
  await fetch('/api/users?action=logout', { headers: { Authorization: `Bearer ${state.token}` } });
  localStorage.removeItem('oo_token');
  state.token = null; state.user = null; state.ownerId = null;
  showLogin();
}

// ─── HubSpot API ──────────────────────────────────────────────────────────────
async function hsPost(path, body) {
  const res = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': path, 'X-HubSpot-Method': 'POST' }, body: JSON.stringify(body) });
  return res.json();
}

async function hsPatch(path, body) {
  const res = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': path, 'X-HubSpot-Method': 'PATCH' }, body: JSON.stringify(body) });
  return res.json();
}

// ─── LOAD DATA ────────────────────────────────────────────────────────────────
const COMPANY_PROPS = [
  'name', 'phone', 'city', 'state', 'website',
  'hubspot_owner_id', 'notes_last_contacted', 'num_contacted_notes',
  'lifecyclestage', 'hs_lead_status', 'createdate', 'lastmodifieddate',
  'industry', 'timezone_', 'lead_source', 'subscription_status',
  'hs_last_logged_call_date', 'dnr', 'recent_user_to_call',
  'hubspot_owner_assigneddate', 'notes_next_activity_date'
];

async function loadContacts(after = null) {
  try {
    const filterGroups = state.ownerId ? [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }] }] : [];
    const body = { filterGroups, properties: COMPANY_PROPS, sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }], limit: 100 };
    if (after) body.after = after;
    const data = await hsPost('/crm/v3/objects/companies/search', body);
    if (data.results) {
      const enriched = data.results.map(enrichContact);
      if (after) { state.contacts = [...state.contacts, ...enriched]; }
      else { state.contacts = enriched; }
      state.hsConnected = true;
      updateHsStatus(true);
      updateBadges();
      // Paginate if more exist
      if (data.paging?.next?.after) {
        loadContacts(data.paging.next.after);
      }
    }
  } catch (e) { console.error('Failed to load companies:', e); updateHsStatus(false); }
}

async function loadQueue() {
  try {
    const res = await fetch('/api/users?action=getqueue', { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await res.json();
    if (Array.isArray(data)) {
      state.queue = data;
      const badge = document.getElementById('badge-queue');
      if (badge) badge.textContent = state.queue.length;
    }
  } catch (e) { console.error('Failed to load queue:', e); }
}

async function addToQueue(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  if (!c) return;
  const company = { id: c.id, name: c.name, phone: c.phone, city: c.city, state: c.state, timezone: c.timezone, leadSource: c.leadSource, stage: c.stage };
  try {
    const res = await fetch('/api/users?action=addqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ company }) });
    const data = await res.json();
    if (data.ok) {
      if (!state.queue.find(q => q.id === companyId)) state.queue.push(company);
      const badge = document.getElementById('badge-queue');
      if (badge) badge.textContent = state.queue.length;
      toast(`${c.name} added to queue ✓`, 'success');
    }
  } catch (e) { toast('Failed to add to queue', 'error'); }
}

async function removeFromQueue(companyId) {
  try {
    const res = await fetch('/api/users?action=removequeue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ companyId }) });
    const data = await res.json();
    if (data.ok) {
      state.queue = state.queue.filter(c => c.id !== companyId);
      const badge = document.getElementById('badge-queue');
      if (badge) badge.textContent = state.queue.length;
      if (state.currentView === 'myqueue') renderMyQueue();
    }
  } catch (e) { toast('Failed to remove from queue', 'error'); }
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
    id: raw.id, name, phone: p.phone || '', city: p.city || '', state: p.state || '',
    website: p.website || '', industry: p.industry || '', timezone: p['timezone_'] || '',
    leadSource: p.lead_source || '', stage: p.lifecyclestage || p.hs_lead_status || 'lead',
    masterStage: p.subscription_status || '', ownerId: p.hubspot_owner_id || '',
    daysSince, lastContacted: lastContactedMs ? new Date(lastContactedMs).toLocaleDateString() : 'Never',
    score, urgency, initials, avatarColor: avatarColor(raw.id),
    needsCall: daysSince > 7 || !lastContactedMs, createdAt: p.createdate,
  };
}

function calcScore(p, daysSince) {
  let s = 50;
  if (daysSince <= 1) s += 20; else if (daysSince <= 3) s += 10; else if (daysSince <= 7) s += 0;
  else if (daysSince <= 14) s -= 15; else if (daysSince <= 30) s -= 25; else s -= 35;
  const stage = (p.lifecyclestage || '').toLowerCase();
  if (stage === 'opportunity') s += 20; else if (stage === 'salesqualifiedlead') s += 15;
  else if (stage === 'marketingqualifiedlead') s += 10; else if (stage === 'lead') s += 5;
  if (p.num_contacted_notes > 5) s += 10;
  return Math.max(0, Math.min(100, Math.round(s)));
}

function avatarColor(id) {
  const colors = [
    { bg: 'rgba(79,142,247,.2)', color: '#4f8ef7' }, { bg: 'rgba(62,207,142,.2)', color: '#3ecf8e' },
    { bg: 'rgba(245,166,35,.2)', color: '#f5a623' }, { bg: 'rgba(240,82,82,.2)', color: '#f05252' },
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
  document.getElementById('call-badge') && (document.getElementById('call-badge').textContent = callNeeded);
  document.getElementById('followup-badge') && (document.getElementById('followup-badge').textContent = followNeeded);
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function askAI(userMsg, extraContext = '') {
  const contactSummary = state.contacts.slice(0, 20).map(c =>
    `${c.name} (score ${c.score}, last contact: ${c.lastContacted}, stage: ${c.masterStage || c.stage}, location: ${c.city} ${c.state}, timezone: ${c.timezone}, lead source: ${c.leadSource})`
  ).join('\n');
  const system = `You are the Olly Olly Virtual Assistant — a smart sales assistant for an SEO agency that sells to home service contractors. You are helping ${state.user?.name || 'a sales rep'} manage their assigned companies.\n\nTheir current companies (top 20):\n${contactSummary}\n\n${extraContext}\n\nBe concise, friendly, and specific. When drafting emails, write the full email with subject line. When coaching, give concrete talk tracks and objection handling.`;
  const messages = [...state.chatHistory, { role: 'user', content: userMsg }];
  const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 1000, system, messages }) });
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
  document.querySelectorAll('.nav-item').forEach(n => { n.classList.toggle('active', n.dataset.view === view); });
  const views = {
    dashboard: renderDashboard,
    contacts: renderContacts,
    myqueue: renderMyQueue,
    ai: renderAI,
    coaching: renderCoaching,
    admin: renderAdmin,
    nevercalled: () => renderPriorityView('nevercalled', '📵 Never Called By Me'),
    roerisklist: () => renderPriorityView('roerisklist', '⚠️ ROE Risk'),
    followuplist: () => renderPriorityView('followuplist', '🔔 Follow-ups'),
    dnrlist: () => renderPriorityView('dnrlist', '🚫 DNR'),
  };
  document.getElementById('main').innerHTML = '';
  (views[view] || renderDashboard)();
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const hot = state.contacts.filter(c => c.score >= 80).length;
  const callNeeded = state.contacts.filter(c => c.needsCall).length;
  const followNeeded = state.contacts.filter(c => c.daysSince > 5).length;

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <h2>Good morning, ${state.user?.name || ''} 👋</h2>
        <p>${new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })} · Updates every minute</p>
      </div>
      <div class="topbar-right">
        <button id="refresh-btn" class="btn" onclick="manualRefresh()">⟳ Refresh</button>
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

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
        <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--red)" onclick="showView('nevercalled')">
          <div class="metric-label">📵 Never Called</div>
          <div class="metric-value" id="count-nevercalled" style="color:var(--red)">...</div>
          <div class="metric-sub">Click to view →</div>
        </div>
        <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--amber)" onclick="showView('roerisklist')">
          <div class="metric-label">⚠️ ROE Risk</div>
          <div class="metric-value" id="count-roe" style="color:var(--amber)">...</div>
          <div class="metric-sub">14+ days no call →</div>
        </div>
        <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--blue)" onclick="showView('followuplist')">
          <div class="metric-label">🔔 Follow-ups</div>
          <div class="metric-value" id="count-followup" style="color:var(--blue)">...</div>
          <div class="metric-sub">Active deals →</div>
        </div>
        <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--text3)" onclick="showView('dnrlist')">
          <div class="metric-label">🚫 DNR</div>
          <div class="metric-value" id="count-dnr" style="color:var(--text3)">...</div>
          <div class="metric-sub">Do not reach out →</div>
        </div>
      </div>
    </div>`;

  try {
    const insight = await askAI(`Give me a sharp 2-sentence morning briefing: which of my companies should I prioritize today and why? Be specific with names.`, `Today's date: ${new Date().toLocaleDateString()}`);
    document.querySelector('#ai-daily-insight .ai-insight-body').innerHTML = insight.replace(/\n/g,'<br>') +
      `<div class="ai-chips">
        <div class="ai-chip" onclick="openAIWithPrompt('Draft follow-up emails for my top 3 priority companies today')">Draft top 3 emails ↗</div>
        <div class="ai-chip" onclick="showView('myqueue')">Open my queue</div>
        <div class="ai-chip" onclick="openAIWithPrompt('Give me a coaching tip for my hardest objection today')">Get coaching tip ↗</div>
      </div>`;
  } catch(e) { document.querySelector('#ai-daily-insight .ai-insight-body').textContent = 'AI briefing unavailable.'; }

  loadDashboardPanels();
}

async function loadDashboardPanels() {
  if (!state.ownerId) return;
  const now = Date.now();
  const days14 = new Date(now - 14 * 86400000).toISOString();
  const days3 = new Date(now - 3 * 86400000).toISOString();

  async function fetchPanel(filterGroups, countId, badgeId) {
    try {
      const data = await hsPost('/crm/v3/objects/companies/search', { filterGroups, properties: ['name'], limit: 100 });
      const count = data.results?.length || 0;
      const countEl = document.getElementById(countId);
      if (countEl) countEl.textContent = count;
      const badge = document.getElementById(badgeId);
      if (badge) badge.textContent = count;
    } catch(e) {
      const countEl = document.getElementById(countId);
      if (countEl) countEl.textContent = '?';
    }
  }

  fetchPanel([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'recent_user_to_call', operator: 'NOT_IN', values: [state.ownerId] }] }, { filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'recent_user_to_call', operator: 'NOT_HAS_PROPERTY' }] }], 'count-nevercalled', 'badge-nevercalled');
  fetchPanel([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'dnr', operator: 'NEQ', value: 'Yes' }, { propertyName: 'hs_last_logged_call_date', operator: 'LT', value: days14 }] }, { filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'dnr', operator: 'NEQ', value: 'Yes' }, { propertyName: 'hubspot_owner_assigneddate', operator: 'LT', value: days3 }, { propertyName: 'recent_user_to_call', operator: 'NOT_IN', values: [state.ownerId] }] }], 'count-roe', 'badge-roe');
  fetchPanel([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'subscription_status', operator: 'IN', values: ['Demo Set', 'Demo Completed', 'Contract Sent', 'Contract Revision'] }, { propertyName: 'hs_last_logged_call_date', operator: 'LT', value: days3 }, { propertyName: 'notes_next_activity_date', operator: 'NOT_HAS_PROPERTY' }] }], 'count-followup', 'badge-followup');
  fetchPanel([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'dnr', operator: 'EQ', value: 'Yes' }] }], 'count-dnr', 'badge-dnr');
}

// ── MY COMPANIES ──────────────────────────────────────────────────────────────
function renderContacts() {
  const sorted = [...state.contacts].sort((a, b) => b.score - a.score);
  const pageSize = state.contactsPageSize || 50;
  const page = state.contactsPage || 0;
  const paginated = sorted.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(sorted.length / pageSize);

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🏢 My Companies</h2><p>${sorted.length} companies assigned to you</p></div>
      <div class="topbar-right">
        <input id="contact-search" placeholder="Search companies..." style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;width:200px" oninput="filterContacts(this.value)" />
        <span style="font-size:12px;color:var(--text2);margin-left:8px">Per page:</span>
        ${[25,50,100].map(n => `<button class="btn btn-sm ${pageSize===n?'btn-primary':''}" onclick="setContactsPageSize(${n})">${n}</button>`).join('')}
      </div>
    </div>
    <div class="content">
      <div style="display:grid;grid-template-columns:1fr 160px 160px auto;gap:10px;padding:6px 14px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Company</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Timezone</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Lead Source</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em"></div>
      </div>
      <div class="lead-list" id="contact-list">${paginated.map(leadCardHTML).join('')}</div>
      ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:8px;margin-top:12px">
        ${Array.from({length: totalPages}, (_, i) => `<button class="btn btn-sm ${i===page?'btn-primary':''}" onclick="setContactsPage(${i})">${i+1}</button>`).join('')}
      </div>` : ''}
    </div>`;
}

function setContactsPageSize(size) {
  state.contactsPageSize = size;
  state.contactsPage = 0;
  renderContacts();
}

function setContactsPage(page) {
  state.contactsPage = page;
  renderContacts();
  document.getElementById('contact-list')?.scrollIntoView({ behavior: 'smooth' });
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
  const inQueue = state.queue.find(q => q.id === c.id);
  return `<div class="lead-card ${c.urgency}" onclick="openContact('${c.id}')" style="display:grid;grid-template-columns:1fr 160px 160px auto;gap:10px;align-items:center">
    <div style="display:flex;align-items:center;gap:8px;min-width:0">
      <div class="avatar" style="background:${c.avatarColor.bg};color:${c.avatarColor.color};flex-shrink:0">${c.initials}</div>
      <div style="min-width:0">
        <div class="lead-name" style="display:flex;align-items:center;gap:6px">
          <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.name}</span>
          <a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px;flex-shrink:0">HS ↗</a>
        </div>
        <div style="font-size:11px;color:var(--text3)">${c.masterStage || c.stage}</div>
      </div>
    </div>
    <div style="font-size:12px;color:var(--text2)">${c.timezone ? `🕐 ${c.timezone}` : '—'}</div>
    <div style="font-size:12px;color:var(--text2)">${c.leadSource ? `📌 ${c.leadSource}` : '—'}</div>
    <div class="lead-right" style="flex-direction:row;gap:6px">
      <span class="score-badge score-${c.urgency === 'urgent' ? 'hot' : c.urgency}">${c.score}</span>
      <button class="btn btn-sm" style="${inQueue ? 'color:var(--purple);border-color:rgba(167,139,250,.4)' : ''}" onclick="event.stopPropagation();${inQueue ? `removeFromQueue('${c.id}')` : `addToQueue('${c.id}')`}">${inQueue ? '✓' : '+'}</button>
    </div>
  </div>`;
}

// ── MY QUEUE ──────────────────────────────────────────────────────────────────
async function renderMyQueue() {
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>📋 My Queue</h2><p>${state.queue.length} companies in your queue</p></div>
      <div class="topbar-right">
        <button class="btn" onclick="clearQueue()">🗑 Clear queue</button>
        <button class="btn btn-primary" onclick="openAIWithPrompt('Give me call scripts for all the companies in my queue')">✨ AI scripts</button>
      </div>
    </div>
    <div class="content">
      <div class="ai-insight" style="margin-bottom:4px">
        <div class="ai-insight-body" style="font-size:12px">
          Your persistent call queue — companies stay here until you remove them. Phone numbers are clickable for Aloware.
        </div>
      </div>
      <div id="queue-list" class="lead-list">
        ${state.queue.length === 0 ? '<div class="empty-state">Your queue is empty. Add companies from any list using the + Queue button.</div>' :
          state.queue.map(c => {
            const cleanPhone = c.phone ? c.phone.replace(/\D/g,'') : '';
            const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
            const colors = [
              {bg:'rgba(79,142,247,.2)',color:'#4f8ef7'},{bg:'rgba(62,207,142,.2)',color:'#3ecf8e'},
              {bg:'rgba(245,166,35,.2)',color:'#f5a623'},{bg:'rgba(240,82,82,.2)',color:'#f05252'},
              {bg:'rgba(167,139,250,.2)',color:'#a78bfa'},
            ];
            const ac = colors[parseInt(c.id,10) % colors.length];
            const initials = c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
            return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--purple);border-radius:var(--radius)">
              <div class="avatar" style="background:${ac.bg};color:${ac.color};flex-shrink:0;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${initials}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px">
                  ${c.name}
                  <a href="${hsUrl}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
                </div>
                <div style="font-size:11px;color:var(--text2);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">
                  ${c.timezone ? `<span>🕐 ${c.timezone}</span>` : ''}
                  ${c.leadSource ? `<span>· 📌 ${c.leadSource}</span>` : ''}
                  ${c.stage ? `<span>· <span style="color:var(--amber)">${c.stage}</span></span>` : ''}
                </div>
              </div>
              <div style="flex-shrink:0;text-align:right;display:flex;align-items:center;gap:8px">
                ${c.phone ? `<a href="tel:${cleanPhone}" style="color:var(--green);text-decoration:none;font-weight:700;font-size:14px;white-space:nowrap">📞 ${c.phone}</a>` : '<span style="color:var(--text3);font-size:12px">No phone</span>'}
                <button class="btn btn-sm" style="color:var(--red);border-color:rgba(240,82,82,.3)" onclick="removeFromQueue('${c.id}')">Remove</button>
              </div>
            </div>`;
          }).join('')}
      </div>
    </div>`;
}

async function clearQueue() {
  if (!confirm('Clear your entire queue?')) return;
  await fetch('/api/users?action=clearqueue', { headers: { Authorization: `Bearer ${state.token}` } });
  state.queue = [];
  const badge = document.getElementById('badge-queue');
  if (badge) badge.textContent = 0;
  renderMyQueue();
}

// ── PRIORITY VIEWS ────────────────────────────────────────────────────────────
const skipState = { nevercalled: new Set(), roerisklist: new Set(), followuplist: new Set(), dnrlist: new Set() };
const priorityResults = {};
let priorityPageSize = 50;
let priorityPage = 0;

async function renderPriorityView(viewKey, title) {
  const now = Date.now();
  const days14 = new Date(now - 14 * 86400000).toISOString();
  const days3 = new Date(now - 3 * 86400000).toISOString();
  priorityPage = 0;

  const filterMap = {
    nevercalled: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'recent_user_to_call', operator: 'NOT_IN', values: [state.ownerId] }] }, { filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'recent_user_to_call', operator: 'NOT_HAS_PROPERTY' }] }],
    roerisklist: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'dnr', operator: 'NEQ', value: 'Yes' }, { propertyName: 'hs_last_logged_call_date', operator: 'LT', value: days14 }] }, { filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'dnr', operator: 'NEQ', value: 'Yes' }, { propertyName: 'hubspot_owner_assigneddate', operator: 'LT', value: days3 }, { propertyName: 'recent_user_to_call', operator: 'NOT_IN', values: [state.ownerId] }] }],
    followuplist: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'subscription_status', operator: 'IN', values: ['Demo Set', 'Demo Completed', 'Contract Sent', 'Contract Revision'] }, { propertyName: 'hs_last_logged_call_date', operator: 'LT', value: days3 }, { propertyName: 'notes_next_activity_date', operator: 'NOT_HAS_PROPERTY' }] }],
    dnrlist: [{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'dnr', operator: 'EQ', value: 'Yes' }] }],
  };

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>${title}</h2><p id="priority-count">Loading...</p></div>
      <div class="topbar-right">
        <button class="btn" onclick="showView('dashboard')">← Dashboard</button>
        <button class="btn btn-primary" onclick="openAIWithPrompt('Give me call scripts for my ${title} companies')">✨ AI scripts</button>
      </div>
    </div>
    <div class="content">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" id="select-all" onchange="toggleSelectAll('${viewKey}',this.checked)" style="width:16px;height:16px;cursor:pointer;accent-color:var(--blue)" />
          <label for="select-all" style="font-size:12px;color:var(--text2);cursor:pointer">Select all on page</label>
          <button class="btn btn-sm" style="color:var(--purple);border-color:rgba(167,139,250,.3)" onclick="addPageToQueue('${viewKey}')">+ Add page to queue</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:12px;color:var(--text2)">Per page:</span>
          ${[25,50,100].map(n => `<button class="btn btn-sm per-page-btn ${priorityPageSize===n?'btn-primary':''}" data-size="${n}" onclick="setPriorityPageSize('${viewKey}','${title}',${n})">${n}</button>`).join('')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:16px 48px minmax(0,1fr) 180px 180px 160px 36px;gap:10px;padding:6px 14px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <div style="width:16px"></div>
        <div style="width:48px"></div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Company</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Timezone</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Lead Source</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Phone</div>
        <div style="width:36px"></div>
      </div>
      <div id="priority-list" class="lead-list">
        <div class="loading-state"><span class="spinner"></span> Loading...</div>
      </div>
      <div id="priority-pagination" style="display:flex;justify-content:center;gap:8px;margin-top:12px"></div>
    </div>`;

  try {
    const data = await hsPost('/crm/v3/objects/companies/search', {
      filterGroups: filterMap[viewKey],
      properties: COMPANY_PROPS,
      sorts: [{ propertyName: 'hs_last_logged_call_date', direction: 'ASCENDING' }],
      limit: 100,
    });
    const results = data.results || [];

    // Batch fetch contact phones
    if (results.length > 0) {
      try {
        const assocRes = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v4/associations/companies/contacts/batch/read', 'X-HubSpot-Method': 'POST' }, body: JSON.stringify({ inputs: results.map(r => ({ id: r.id })) }) });
        const assocData = await assocRes.json();
        const contactMap = {};
        if (assocData.results) assocData.results.forEach(r => { if (r.to?.length) contactMap[r.from.id] = r.to[0].toObjectId; });
        const contactIds = [...new Set(Object.values(contactMap))];
        if (contactIds.length > 0) {
          const contactRes = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/contacts/batch/read', 'X-HubSpot-Method': 'POST' }, body: JSON.stringify({ inputs: contactIds.map(id => ({ id })), properties: ['phone', 'mobilephone'] }) });
          const contactData = await contactRes.json();
          const phoneMap = {};
          if (contactData.results) contactData.results.forEach(c => { phoneMap[c.id] = c.properties.mobilephone || c.properties.phone || null; });
          results.forEach(r => { const cid = contactMap[r.id]; if (cid && phoneMap[cid]) r.properties.contactPhone = phoneMap[cid]; });
        }
      } catch(e) { console.error('Phone fetch failed:', e); }
    }

    priorityResults[viewKey] = results;
    const countEl = document.getElementById('priority-count');
    if (countEl) countEl.textContent = `${results.length} companies`;
    const badgeMap = { nevercalled: 'badge-nevercalled', roerisklist: 'badge-roe', followuplist: 'badge-followup', dnrlist: 'badge-dnr' };
    const badge = document.getElementById(badgeMap[viewKey]);
    if (badge) badge.textContent = results.length;
    renderPriorityPage(viewKey);
  } catch(e) {
    const list = document.getElementById('priority-list');
    if (list) list.innerHTML = '<div class="empty-state">Failed to load</div>';
  }
}

function renderPriorityPage(viewKey) {
  const results = priorityResults[viewKey] || [];
  const skipped = skipState[viewKey];
  const start = priorityPage * priorityPageSize;
  const page = results.slice(start, start + priorityPageSize);

  const list = document.getElementById('priority-list');
  if (!list) return;
  if (!results.length) { list.innerHTML = '<div class="empty-state">🎉 Nothing here!</div>'; return; }

list.innerHTML = page.map(raw => {
    const p = raw.properties;
    const name = p.name || 'Unknown';
    const initials = name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${raw.id}`;
    const rawPhone = raw.properties.contactPhone || p.phone || '';
    const cleanPhone = rawPhone ? rawPhone.replace(/\D/g,'') : '';
    const isSkipped = skipped.has(raw.id);
    const inQueue = state.queue.find(q => q.id === raw.id);
    const colors = [{bg:'rgba(79,142,247,.2)',color:'#4f8ef7'},{bg:'rgba(62,207,142,.2)',color:'#3ecf8e'},{bg:'rgba(245,166,35,.2)',color:'#f5a623'},{bg:'rgba(240,82,82,.2)',color:'#f05252'},{bg:'rgba(167,139,250,.2)',color:'#a78bfa'}];
    const ac = colors[parseInt(raw.id,10) % colors.length];

    return `<div style="display:grid;grid-template-columns:16px 48px minmax(0,1fr) 180px 180px 160px 36px;align-items:center;gap:10px;padding:8px 14px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${isSkipped ? 'var(--text3)' : inQueue ? 'var(--purple)' : 'var(--blue)'};border-radius:var(--radius);opacity:${isSkipped ? '0.5' : '1'}" id="prow-${raw.id}">
      <input type="checkbox" class="queue-cb" data-id="${raw.id}" ${inQueue ? 'checked' : ''}
        onchange="handleQueueCheckbox('${viewKey}','${raw.id}',this.checked)"
        style="width:16px;height:16px;cursor:pointer;flex-shrink:0;accent-color:var(--purple)" />
      <button class="btn btn-sm" onclick="toggleSkip('${viewKey}','${raw.id}',${isSkipped})" style="padding:3px 8px;font-size:11px;${isSkipped ? 'color:var(--blue)' : 'color:var(--text3)'}">
        ${isSkipped ? 'Unskip' : 'Skip'}
      </button>
      <div style="min-width:0;display:flex;align-items:center;gap:8px">
        <div class="avatar" style="background:${ac.bg};color:${ac.color};flex-shrink:0;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700">${initials}</div>
        <div style="min-width:0">
          <div style="font-size:13px;font-weight:600;color:${isSkipped ? 'var(--text3)' : 'var(--text)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:6px">
            ${isSkipped ? '🚫 ' : ''}${name}
            <a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 5px;border-radius:4px;flex-shrink:0">HS ↗</a>
          </div>
        </div>
      </div>
      <div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${p['timezone_'] ? `🕐 ${p['timezone_']}` : '<span style="color:var(--text3)">—</span>'}
      </div>
      <div style="font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${p.lead_source ? `📌 ${p.lead_source}` : '<span style="color:var(--text3)">—</span>'}
      </div>
      <div style="font-size:14px;font-weight:700;white-space:nowrap">
        ${isSkipped
          ? '<span style="color:var(--text3);font-size:12px">Skipped</span>'
          : rawPhone
            ? `<a href="tel:${cleanPhone}" style="color:var(--green);text-decoration:none">📞 ${rawPhone}</a>`
            : '<span style="color:var(--text3);font-size:12px">No phone</span>'}
      </div>
      <button class="btn btn-sm" onclick="openAIWithPrompt('Write a call script for ${name.replace(/'/g,"\\'")}. Include opener, discovery questions, and objection handling.')">✨</button>
    </div>`;
  }).join('');

  // Pagination
  const totalPages = Math.ceil(results.length / priorityPageSize);
  const pag = document.getElementById('priority-pagination');
  if (pag && totalPages > 1) {
    pag.innerHTML = Array.from({length: totalPages}, (_, i) => `
      <button class="btn btn-sm ${i === priorityPage ? 'btn-primary' : ''}" onclick="goPriorityPage('${viewKey}',${i})">${i+1}</button>
    `).join('');
  }
}

function goPriorityPage(viewKey, page) {
  priorityPage = page;
  renderPriorityPage(viewKey);
  document.getElementById('priority-list')?.scrollIntoView({ behavior: 'smooth' });
}

function setPriorityPageSize(viewKey, title, size) {
  priorityPageSize = size;
  priorityPage = 0;
  // Update button styles
  document.querySelectorAll('.per-page-btn').forEach(b => {
    b.classList.toggle('btn-primary', parseInt(b.dataset.size) === size);
    b.classList.toggle('btn-default', parseInt(b.dataset.size) !== size);
  });
  renderPriorityPage(viewKey);
}

function toggleSelectAll(viewKey, checked) {
  document.querySelectorAll('.queue-cb').forEach(cb => { cb.checked = checked; });
}

async function addPageToQueue(viewKey) {
  const checkboxes = document.querySelectorAll('.queue-cb:checked');
  let added = 0;
  for (const cb of checkboxes) {
    const id = cb.dataset.id;
    if (!state.queue.find(q => q.id === id)) {
      await addToQueue(id);
      added++;
    }
  }
  toast(`${added} companies added to queue ✓`, 'success');
}

async function handleQueueCheckbox(viewKey, companyId, checked) {
  if (checked) { await addToQueue(companyId); }
  else { await removeFromQueue(companyId); }
  renderPriorityPage(viewKey);
}

function toggleSkip(viewKey, companyId, currentlySkipped) {
  if (currentlySkipped) { skipState[viewKey].delete(companyId); }
  else { skipState[viewKey].add(companyId); }
  renderPriorityPage(viewKey);
}

// ── AI ASSISTANT ──────────────────────────────────────────────────────────────
function renderAI() {
  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>✨ AI Assistant</h2><p>Ask anything about your companies, get emails drafted, coaching, and more</p></div>
    </div>
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-messages">
        <div class="msg ai"><div class="msg-label">Assistant</div>
          <div class="msg-bubble">Hi ${state.user?.name || 'there'}! I'm connected to your HubSpot companies and ready to help. What do you need?</div>
        </div>
        <div class="ai-chips" style="padding:0 0 8px">
          <div class="ai-chip" onclick="sendPreset('Who are my top 3 companies to focus on today and why?')">Today's priorities ↗</div>
          <div class="ai-chip" onclick="sendPreset('Draft follow-up emails for my top 5 companies that need outreach')">Draft follow-ups ↗</div>
          <div class="ai-chip" onclick="sendPreset('Give me a cold call script for a new lead in the discovery stage')">Call script ↗</div>
          <div class="ai-chip" onclick="sendPreset('Analyze my pipeline and tell me what is at risk')">Pipeline analysis ↗</div>
          <div class="ai-chip" onclick="sendPreset('Give me tips for handling the objection: we do not have budget right now')">Handle objection ↗</div>
        </div>
        ${state.chatHistory.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}"><div class="msg-label">${m.role === 'user' ? 'You' : 'Assistant'}</div><div class="msg-bubble">${m.content.replace(/\n/g, '<br>')}</div></div>`).join('')}
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
    document.getElementById(loadId).outerHTML = `<div class="msg ai"><div class="msg-label">Assistant</div><div class="msg-bubble">${reply.replace(/\n/g, '<br>')}</div></div>`;
  } catch(e) {
    document.getElementById(loadId).outerHTML = `<div class="msg ai"><div class="msg-label">Assistant</div><div class="msg-bubble" style="color:var(--red)">Error: ${e.message}</div></div>`;
  }
  scrollChat();
}

function sendPreset(msg) {
  if (state.currentView !== 'ai') showView('ai');
  setTimeout(() => { const input = document.getElementById('chat-input'); if (input) { input.value = msg; sendChat(); } }, 100);
}

function openAIWithPrompt(msg) {
  showView('ai');
  setTimeout(() => { const input = document.getElementById('chat-input'); if (input) { input.value = msg; sendChat(); } }, 150);
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
    <div class="topbar"><div class="topbar-left"><h2>🎯 Sales Coaching</h2><p>Coming soon</p></div></div>
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
    <div class="topbar"><div class="topbar-left"><h2>⚙️ Admin</h2><p>Manage team members</p></div></div>
    <div class="content">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:1rem">
          <div class="section-title" style="margin-bottom:12px">Add one person</div>
          <div style="margin-bottom:8px"><div class="field-label" style="margin-bottom:4px">Full name</div><input id="new-name" placeholder="Jane Smith" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" oninput="autoFillUser()" /></div>
          <div style="margin-bottom:8px"><div class="field-label" style="margin-bottom:4px">Email</div><input id="new-email" placeholder="Auto-filled from name" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" /></div>
          <div style="margin-bottom:12px"><div class="field-label" style="margin-bottom:4px">Password</div><input id="new-password" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" value="OllyOlly2025!" /></div>
          <div style="margin-bottom:12px"><label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2);cursor:pointer"><input type="checkbox" id="new-admin" /> Make admin</label></div>
          <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="addUser()">Add user</button>
          <div id="add-msg" style="font-size:12px;margin-top:8px"></div>
        </div>
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
  const parts = name.split(' ').filter(p => !['jr','sr','ii','iii','iv','jr.','sr.'].includes(p.toLowerCase()));
  if (parts.length >= 2) document.getElementById('new-email').value = `${parts[0].toLowerCase()}.${parts[parts.length-1].toLowerCase()}@ollyolly.com`;
}

async function bulkAddUsers() {
  const names = document.getElementById('bulk-names').value.trim().split('\n').map(n => n.trim()).filter(Boolean);
  const msg = document.getElementById('bulk-msg');
  if (!names.length) { msg.style.color = 'var(--red)'; msg.textContent = 'No names entered'; return; }
  msg.style.color = 'var(--text2)'; msg.textContent = `Adding ${names.length} users...`;
  const results = [];
  for (const name of names) {
    const parts = name.split(' ');
    if (parts.length < 2) { results.push(`⚠ ${name} — needs first and last name`); continue; }
    const email = `${parts[0].toLowerCase()}.${parts[parts.length-1].toLowerCase()}@ollyolly.com`;
    try {
      const res = await fetch('/api/users?action=add', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ name, email, password: 'OllyOlly2025!', isAdmin: false }) });
      const data = await res.json();
      results.push(res.ok && data.ok ? `✓ ${name} — ${email}${data.ownerId ? '' : ' (no HubSpot match)'}` : `✗ ${name} — ${data.error || 'Failed'}`);
    } catch { results.push(`✗ ${name} — failed`); }
  }
  msg.innerHTML = results.map(r => `<div style="color:${r.startsWith('✓') ? 'var(--green)' : r.startsWith('⚠') ? 'var(--amber)' : 'var(--red)'}">${r}</div>`).join('');
  document.getElementById('bulk-names').value = '';
  loadUserList();
}

async function loadUserList() {
  const res = await fetch('/api/users?action=list', { headers: { Authorization: `Bearer ${state.token}` } });
  const users = await res.json();
  const list = document.getElementById('user-list');
  if (!Array.isArray(users)) { list.innerHTML = '<div style="color:var(--red);font-size:13px">Failed to load users</div>'; return; }
  list.innerHTML = users.map(u => `
    <div style="padding:12px 0;border-bottom:1px solid var(--border)">
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px;align-items:center">
        <div><div class="field-label" style="margin-bottom:3px">Name</div><input value="${u.name}" id="edit-name-${u.email.replace(/[@.]/g,'-')}" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none" /></div>
        <div><div class="field-label" style="margin-bottom:3px">Email</div><input value="${u.email}" id="edit-email-${u.email.replace(/[@.]/g,'-')}" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none" /></div>
        <div><div class="field-label" style="margin-bottom:3px">New password</div><input placeholder="Leave blank to keep" id="edit-pass-${u.email.replace(/[@.]/g,'-')}" type="password" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none" /></div>
        <div style="display:flex;flex-direction:column;gap:4px;padding-top:16px">
          <button class="btn btn-sm btn-primary" onclick="saveUser('${u.email}')">Save</button>
          <button class="btn btn-sm" style="color:var(--red);border-color:rgba(240,82,82,.3)" onclick="deleteUser('${u.email}')">Remove</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:6px">HubSpot owner: ${u.ownerId || 'not found'} · ${u.isAdmin ? '<span style="color:var(--blue)">admin</span>' : 'standard user'}</div>
    </div>`).join('');
}

async function saveUser(originalEmail) {
  const key = originalEmail.replace(/[@.]/g,'-');
  const name = document.getElementById(`edit-name-${key}`).value.trim();
  const email = document.getElementById(`edit-email-${key}`).value.trim();
  const password = document.getElementById(`edit-pass-${key}`).value.trim();
  const res = await fetch('/api/users?action=edit', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ originalEmail, email, name, password: password || null }) });
  const data = await res.json();
  if (data.ok) { toast('User updated ✓', 'success'); loadUserList(); }
  else toast(data.error || 'Failed to update', 'error');
}

async function addUser() {
  const name = document.getElementById('new-name').value.trim();
  const email = document.getElementById('new-email').value.trim();
  const password = document.getElementById('new-password').value.trim();
  const isAdmin = document.getElementById('new-admin').checked;
  const msg = document.getElementById('add-msg');
  if (!email || !password) { msg.style.color = 'var(--red)'; msg.textContent = 'Email and password required'; return; }
  const res = await fetch('/api/users?action=add', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ name, email, password, isAdmin }) });
  const data = await res.json();
  if (data.ok) {
    msg.style.color = 'var(--green)'; msg.textContent = `✓ Added! HubSpot owner ID: ${data.ownerId || 'not found in HubSpot'}`;
    document.getElementById('new-name').value = ''; document.getElementById('new-email').value = ''; document.getElementById('new-password').value = '';
    loadUserList();
  } else { msg.style.color = 'var(--red)'; msg.textContent = data.error || 'Failed to add user'; }
}

async function deleteUser(email) {
  if (!confirm(`Remove ${email}?`)) return;
  await fetch('/api/users?action=delete', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ email }) });
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
  const inQueue = state.queue.find(q => q.id === c.id);

  document.getElementById('modal-title').innerHTML = `${c.name} <a href="${hsUrl}" target="_blank" style="font-size:11px;color:var(--blue);text-decoration:none;font-weight:400">Open in HubSpot ↗</a>`;
  document.getElementById('modal-body').innerHTML = `
    <div class="field-row">
      <div><div class="field-label">Location</div><div class="field-value">${c.city ? `${c.city}, ${c.state}` : '—'}</div></div>
      <div><div class="field-label">Timezone</div><div class="field-value">${c.timezone || '—'}</div></div>
    </div>
    <div class="field-row">
      <div><div class="field-label">Phone</div><div class="field-value">${c.phone ? `<a href="tel:${cleanPhone}" style="color:var(--green);text-decoration:none;font-weight:600">📞 ${c.phone}</a>` : '—'}</div></div>
      <div><div class="field-label">Lead Source</div><div class="field-value">${c.leadSource || '—'}</div></div>
    </div>
    <div class="field-row">
      <div><div class="field-label">Stage</div><div class="field-value">${c.masterStage || c.stage}</div></div>
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
        ${notes.length === 0 ? '<div style="font-size:12px;color:var(--text3)">No notes yet</div>' : notes.map(n => `<div class="note-card"><div class="note-meta">${n.date}</div><div class="note-body">${n.text}</div></div>`).join('')}
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>
    <button class="btn btn-sm ${inQueue ? 'btn-primary' : ''}" onclick="${inQueue ? `removeFromQueue('${id}')` : `addToQueue('${id}')`}; closeModal()">
      ${inQueue ? '✓ In Queue' : '+ Add to Queue'}
    </button>
    <button class="btn btn-sm" onclick="openAIWithPrompt('Draft a follow-up email to ${c.name}. Stage: ${c.masterStage || c.stage}. Last contacted: ${c.lastContacted}. Be warm and specific.')">✨ Draft email</button>
    <button class="btn btn-sm" style="background:var(--green-dim);border-color:rgba(62,207,142,.3);color:var(--green)" onclick="closeModal();openCallLogger('${id}')">🎙️ Log Call + AI Notes</button>
    <button class="btn btn-primary btn-sm" onclick="openAIWithPrompt('Give me a call script for ${c.name}. Stage: ${c.masterStage || c.stage}. Include opener, key questions, and objection handling.')">📞 Call script</button>`;
  document.getElementById('modal').style.display = 'flex';
}

async function saveNote(contactId) {
  const input = document.getElementById('note-input');
  const text = input.value.trim();
  if (!text) return;
  try {
    await hsPost('/crm/v3/objects/notes', { properties: { hs_note_body: text, hs_timestamp: Date.now() }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }] });
    toast('Note saved to HubSpot ✓', 'success');
  } catch { toast('Saved locally (HubSpot sync failed)', 'error'); }
  if (!state.notes[contactId]) state.notes[contactId] = [];
  state.notes[contactId].unshift({ text, date: new Date().toLocaleString() });
  input.value = '';
  const list = document.getElementById('notes-list');
  if (list) list.innerHTML = state.notes[contactId].map(n => `<div class="note-card"><div class="note-meta">${n.date}</div><div class="note-body">${n.text}</div></div>`).join('');
}

async function logCall(contactId) {
  const c = state.contacts.find(x => x.id === contactId);
  if (!c) return;
  try {
    await hsPost('/crm/v3/objects/calls', { properties: { hs_call_body: `Call logged via Olly Olly Virtual Assistant`, hs_timestamp: Date.now(), hs_call_status: 'COMPLETED', hs_call_duration: 0 }, associations: [{ to: { id: contactId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 182 }] }] });
    toast(`Call logged for ${c.name} ✓`, 'success');
    const contact = state.contacts.find(x => x.id === contactId);
    if (contact) { contact.daysSince = 0; contact.lastContacted = new Date().toLocaleDateString(); contact.needsCall = false; contact.score = Math.min(100, contact.score + 10); updateBadges(); }
  } catch { toast('Failed to log call', 'error'); }
}

function closeModal() { document.getElementById('modal').style.display = 'none'; }

// ─── TOAST ────────────────────────────────────────────────────────────────────
function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `${type === 'success' ? '✓' : '⚠'} ${msg}`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ─── REFRESH ──────────────────────────────────────────────────────────────────
let refreshInterval = null;

async function init() {
  showView('dashboard');
  await Promise.all([loadContacts(), loadQueue()]);
  if (state.currentView === 'dashboard') showView('dashboard');
  startAutoRefresh();
}

function startAutoRefresh() {
  if (refreshInterval) clearInterval(refreshInterval);
  refreshInterval = setInterval(async () => {
    await loadContacts();
    if (state.currentView === 'dashboard') showView('dashboard');
    updateBadges();
  }, 60000);
}

async function manualRefresh() {
  const btn = document.getElementById('refresh-btn');
  if (btn) { btn.textContent = '⟳ Refreshing...'; btn.disabled = true; }
  await loadContacts();
  if (state.currentView === 'dashboard') showView('dashboard');
  updateBadges();
  if (btn) { btn.textContent = '⟳ Refresh'; btn.disabled = false; }
  toast('Data refreshed ✓', 'success');
}

// ─── GOOGLE CALENDAR ──────────────────────────────────────────────────────────
async function connectGoogleCalendar() {
  try {
    const res = await fetch('/api/calendar?action=authurl', {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    const data = await res.json();
    if (data.url) window.open(data.url, '_blank');
  } catch (e) {
    toast('Failed to connect Google Calendar', 'error');
  }
}

// Check if coming back from Google OAuth
if (window.location.search.includes('calendar=connected')) {
  toast('Google Calendar connected! ✓', 'success');
  window.history.replaceState({}, '', '/');
}

// ─── CALL LOGGING MODAL ───────────────────────────────────────────────────────
async function openCallLogger(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  if (!c) return;

  document.getElementById('modal-title').innerHTML = `📞 Log Call — ${c.name}`;
  document.getElementById('modal-body').innerHTML = `
    <div id="call-logger-content">
      <div style="text-align:center;padding:20px">
        <div style="font-size:40px;margin-bottom:12px">🎙️</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">Upload call recording</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:16px">Upload the Aloware recording and AI will transcribe it, write call notes, and schedule a follow-up automatically.</div>
        <input type="file" id="audio-upload" accept="audio/*,.mp3,.mp4,.m4a,.wav,.webm" style="display:none" onchange="handleAudioUpload('${companyId}')" />
        <button class="btn btn-primary" style="justify-content:center;width:100%;margin-bottom:8px" onclick="document.getElementById('audio-upload').click()">
          📁 Choose recording file
        </button>
        <div style="font-size:11px;color:var(--text3)">Supports MP3, MP4, M4A, WAV · ~$0.09 per 15 min call</div>
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancel</button>`;

  document.getElementById('modal').style.display = 'flex';
}

async function handleAudioUpload(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  const file = document.getElementById('audio-upload').files[0];
  if (!file) return;

  document.getElementById('call-logger-content').innerHTML = `
    <div style="text-align:center;padding:30px">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;margin:0 auto 16px"></div>
      <div id="transcribe-status" style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">Uploading recording...</div>
      <div style="font-size:12px;color:var(--text2)">Long calls can take 10+ min</div>
    </div>`;

  try {
    const { assemblyAiKey } = await fetch('/api/config').then(r => r.json());

    // Upload directly to AssemblyAI
    const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
      method: 'POST',
      headers: { 'Authorization': assemblyAiKey },
      body: file,
    });
    if (!uploadRes.ok) throw new Error('Upload failed');
    const { upload_url } = await uploadRes.json();

    // Submit transcription job
    document.getElementById('transcribe-status').textContent = 'Transcribing...';
    const jobRes = await fetch('https://api.assemblyai.com/v2/transcript', {
      method: 'POST',
      headers: { 'Authorization': assemblyAiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio_url: upload_url, language_code: 'en' }),
    });
    if (!jobRes.ok) throw new Error('Failed to start transcription');
    const { id: jobId } = await jobRes.json();

    // Poll AssemblyAI directly
    let transcript;
    while (true) {
      await new Promise(r => setTimeout(r, 5000));
      const statusRes = await fetch(`https://api.assemblyai.com/v2/transcript/${jobId}`, {
        headers: { 'Authorization': assemblyAiKey },
      });
      const statusData = await statusRes.json();
      if (statusData.status === 'error') throw new Error(statusData.error || 'Transcription failed');
      if (statusData.status === 'completed') { transcript = statusData.text; break; }
    }

    // Analyze with Claude
    document.getElementById('transcribe-status').textContent = 'Analyzing with AI...';
    const analysisRes = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcript, companyName: c.name }),
    });
    const { analysis } = await analysisRes.json();

    showCallAnalysis(companyId, transcript, analysis);
  } catch (e) {
    document.getElementById('call-logger-content').innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:36px;margin-bottom:12px">❌</div>
        <div style="font-size:14px;font-weight:600;color:var(--red);margin-bottom:8px">Transcription failed</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:16px">${e.message}</div>
        <button class="btn btn-primary" onclick="openCallLogger('${companyId}')">Try again</button>
      </div>`;
  }
}

function showCallAnalysis(companyId, transcript, analysis) {
  const c = state.contacts.find(x => x.id === companyId);
  const followUpDate = analysis.followUpDate ? new Date(analysis.followUpDate) : null;
  const followUpDateStr = followUpDate ? followUpDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : null;

  document.getElementById('call-logger-content').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">

      <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:12px">
        <div class="field-label" style="margin-bottom:6px">📋 Call Summary</div>
        <div style="font-size:13px;color:var(--text);line-height:1.6">${analysis.summary || 'No summary available'}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${analysis.interested ? 'var(--green-dim)' : 'var(--red-dim)'};color:${analysis.interested ? 'var(--green)' : 'var(--red)'}">
            ${analysis.interested ? '✓ Interested' : '✗ Not interested'}
          </span>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:var(--bg2);color:var(--text2)">
            ${analysis.sentiment || 'neutral'}
          </span>
        </div>
      </div>

      <div>
        <div class="field-label" style="margin-bottom:6px">📝 Call Notes</div>
        <textarea id="call-notes-input" style="width:100%;min-height:100px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:10px;color:var(--text);font-size:12px;outline:none;font-family:inherit;resize:vertical">${analysis.callNotes || ''}</textarea>
      </div>

      ${analysis.followUpCommitment ? `
      <div style="background:var(--blue-dim);border:1px solid rgba(79,142,247,.2);border-radius:var(--radius-sm);padding:12px">
        <div class="field-label" style="margin-bottom:6px;color:var(--blue)">📅 Follow-up Detected</div>
        <div style="font-size:13px;color:var(--text);margin-bottom:8px">"${analysis.followUpCommitment}"</div>
        ${followUpDateStr ? `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Suggested date: <strong style="color:var(--text)">${followUpDateStr}</strong></div>` : ''}
        <input type="datetime-local" id="followup-datetime" 
          value="${analysis.followUpDate ? analysis.followUpDate.slice(0,16) : ''}"
          style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none;margin-bottom:8px;width:100%" />
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="createCalendarEvent('${companyId}')">
            📅 Add to Google Calendar
          </button>
          <button class="btn btn-sm" style="flex:1;justify-content:center" onclick="createHubSpotTask('${companyId}')">
            ✅ Create HubSpot Task
          </button>
        </div>
      </div>` : `
      <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:12px">
        <div class="field-label" style="margin-bottom:6px">📅 Schedule Follow-up</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px">No follow-up commitment detected — set one manually:</div>
        <input type="datetime-local" id="followup-datetime"
          style="background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none;margin-bottom:8px;width:100%" />
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="createCalendarEvent('${companyId}')">
            📅 Add to Google Calendar
          </button>
          <button class="btn btn-sm" style="flex:1;justify-content:center" onclick="createHubSpotTask('${companyId}')">
            ✅ Create HubSpot Task
          </button>
        </div>
      </div>`}

      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="saveCallNotes('${companyId}')">
          💾 Save notes to HubSpot
        </button>
        <button class="btn" style="flex:1;justify-content:center" onclick="showTranscript(\`${transcript.replace(/`/g, '\\`').replace(/\$/g, '\\$').slice(0, 5000)}\`)">
          📄 View transcript
        </button>
      </div>
    </div>`;

  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>`;
}

async function createCalendarEvent(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  const dt = document.getElementById('followup-datetime')?.value;
  if (!dt) { toast('Pick a date and time first', 'error'); return; }

  const startTime = new Date(dt).toISOString();
  const endTime = new Date(new Date(dt).getTime() + 30 * 60000).toISOString();
  const notes = document.getElementById('call-notes-input')?.value || '';

  try {
    const res = await fetch('/api/calendar?action=create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({
        title: `Follow-up call — ${c.name}`,
        description: notes,
        startTime,
        endTime,
      }),
    });
    const data = await res.json();
    if (data.needsConnect) {
      if (confirm('Google Calendar not connected. Connect now?')) connectGoogleCalendar();
      return;
    }
    if (!data.ok) throw new Error(data.error);
    toast('📅 Calendar event created! ✓', 'success');
    if (data.eventLink) window.open(data.eventLink, '_blank');
  } catch (e) {
    toast('Failed to create calendar event: ' + e.message, 'error');
  }
}

async function createHubSpotTask(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  const dt = document.getElementById('followup-datetime')?.value;
  const notes = document.getElementById('call-notes-input')?.value || '';

  try {
    const dueDate = dt ? new Date(dt).getTime() : Date.now() + 14 * 86400000;
    await hsPost('/crm/v3/objects/tasks', {
      properties: {
        hs_task_subject: `Follow-up call — ${c.name}`,
        hs_task_body: notes,
        hs_timestamp: dueDate,
        hs_task_status: 'NOT_STARTED',
        hs_task_type: 'CALL',
        hubspot_owner_id: state.ownerId,
      },
      associations: [{
        to: { id: companyId },
        types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 192 }],
      }],
    });
    toast('✅ HubSpot task created! ✓', 'success');
  } catch (e) {
    toast('Failed to create HubSpot task', 'error');
  }
}

async function saveCallNotes(companyId) {
  const notes = document.getElementById('call-notes-input')?.value;
  if (!notes) { toast('No notes to save', 'error'); return; }
  try {
    await hsPost('/crm/v3/objects/notes', {
      properties: { hs_note_body: notes, hs_timestamp: Date.now() },
      associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }],
    });
    toast('Notes saved to HubSpot ✓', 'success');
  } catch {
    toast('Failed to save notes', 'error');
  }
}

function showTranscript(transcript) {
  document.getElementById('call-logger-content').innerHTML = `
    <div>
      <div class="field-label" style="margin-bottom:8px">Full Transcript</div>
      <div style="background:var(--bg3);border-radius:6px;padding:12px;font-size:12px;color:var(--text2);line-height:1.8;max-height:400px;overflow-y:auto;white-space:pre-wrap">${transcript}</div>
    </div>`;
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
checkSession();
