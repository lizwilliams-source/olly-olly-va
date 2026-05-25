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
  queues: [],
  activeQueueId: null,
  pipeline: [],
  contactsPage: 0,
  contactsTotal: 0,
  contactsPageSize: 50,
  contactsFilterTimezone: '',
  contactsFilterLeadSource: '',
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
  document.getElementById('modal').addEventListener('click', e => { if (e.target === document.getElementById('modal') && !state.transcribing) closeModal(); });
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

function updateQueueBadge() {
  const total = state.queues.reduce((sum, q) => sum + q.companies.length, 0);
  const badge = document.getElementById('badge-queue');
  if (badge) badge.textContent = total;
}

function findCompanyQueue(companyId) {
  return state.queues.find(q => q.companies.find(c => c.id === companyId)) || null;
}

async function loadQueue() {
  try {
    const res = await fetch('/api/users?action=getqueues', { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await res.json();
    if (data.queues) {
      state.queues = data.queues;
      if (!state.activeQueueId || !state.queues.find(q => q.id === state.activeQueueId)) {
        state.activeQueueId = state.queues[0]?.id || null;
      }
      updateQueueBadge();
    }
  } catch (e) { console.error('Failed to load queues:', e); }
}

async function addToQueue(companyId, queueId) {
  const c = state.contacts.find(x => x.id === companyId);
  if (!c) return;
  if (!queueId) {
    if (state.queues.length === 0) await createQueue('My Queue');
    queueId = state.queues[0].id;
  }
  const company = { id: c.id, name: c.name, phone: c.phone, city: c.city, state: c.state, timezone: c.timezone, leadSource: c.leadSource, stage: c.stage };
  try {
    const res = await fetch('/api/users?action=addtoqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId, company }) });
    const data = await res.json();
    if (data.queues) {
      state.queues = data.queues;
      updateQueueBadge();
      const q = state.queues.find(q => q.id === queueId);
      toast(`${c.name} added to "${q?.name || 'queue'}" ✓`, 'success');
    }
  } catch (e) { toast('Failed to add to queue', 'error'); }
}

async function removeFromQueue(companyId, queueId) {
  if (!queueId) {
    const q = findCompanyQueue(companyId);
    if (!q) return;
    queueId = q.id;
  }
  try {
    const res = await fetch('/api/users?action=removefromqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId, companyId }) });
    const data = await res.json();
    if (data.queues) {
      state.queues = data.queues;
      updateQueueBadge();
      if (state.currentView === 'myqueue') renderMyQueue();
    }
  } catch (e) { toast('Failed to remove from queue', 'error'); }
}

async function createQueue(name) {
  const res = await fetch('/api/users?action=createqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ name }) });
  const data = await res.json();
  if (data.queues) {
    state.queues = data.queues;
    state.activeQueueId = data.queues[data.queues.length - 1].id;
    updateQueueBadge();
    if (state.currentView === 'myqueue') renderMyQueue();
  }
}

async function renameQueue(queueId, name) {
  const res = await fetch('/api/users?action=renamequeue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId, name }) });
  const data = await res.json();
  if (data.queues) { state.queues = data.queues; if (state.currentView === 'myqueue') renderMyQueue(); }
}

async function deleteQueue(queueId) {
  if (!confirm('Delete this queue?')) return;
  const res = await fetch('/api/users?action=deletequeue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId }) });
  const data = await res.json();
  if (data.queues) {
    state.queues = data.queues;
    if (state.activeQueueId === queueId) state.activeQueueId = state.queues[0]?.id || null;
    updateQueueBadge();
    if (state.currentView === 'myqueue') renderMyQueue();
  }
}

async function clearQueue(queueId) {
  if (!confirm('Clear this queue?')) return;
  const res = await fetch('/api/users?action=clearqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId }) });
  const data = await res.json();
  if (data.queues) { state.queues = data.queues; updateQueueBadge(); if (state.currentView === 'myqueue') renderMyQueue(); }
}

function switchQueue(queueId) {
  state.activeQueueId = queueId;
  renderMyQueue();
}

async function promptCreateQueue() {
  const name = prompt('Queue name:');
  if (name?.trim()) await createQueue(name.trim());
}

async function promptRenameQueue(queueId, currentName) {
  const name = prompt('Rename queue:', currentName);
  if (name?.trim() && name.trim() !== currentName) await renameQueue(queueId, name.trim());
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
  const contactSummary = state.contacts.map(c =>
    `${c.name} (score ${c.score}, last contact: ${c.lastContacted}, stage: ${c.masterStage || c.stage}, location: ${c.city} ${c.state}, timezone: ${c.timezone}, lead source: ${c.leadSource})`
  ).join('\n');
  const system = `You are the Olly Olly Virtual Assistant — a smart pipeline management assistant for an SEO agency that sells to home service contractors. You are helping ${state.user?.name || 'a sales rep'} manage their assigned companies.\n\nTheir assigned companies:\n${contactSummary}\n\n${extraContext}\n\nBe concise, friendly, and specific. When drafting emails, write the full email with subject line.`;
  const messages = [...state.chatHistory, { role: 'user', content: userMsg }];
  const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ max_tokens: 2000, system, messages }) });
  if (!res.ok) { const errData = await res.json().catch(() => ({})); throw new Error(errData.error || `AI API error: ${res.status}`); }
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
    pipeline: renderPipeline,
    ai: renderAI,
    admin: renderAdmin,
    nevercalled: () => renderPriorityView('nevercalled', '📵 Never Called By Me'),
    roerisklist: () => renderPriorityView('roerisklist', '⚠️ ROE Risk'),
    followuplist: () => renderPriorityView('followuplist', '🔔 Follow-ups'),
    dnrlist: () => renderPriorityView('dnrlist', '💾 Do Not Recirculate'),
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
        <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--green)" onclick="showView('dnrlist')">
          <div class="metric-label">💾 Do Not Recirculate</div>
          <div class="metric-value" id="count-dnr" style="color:var(--green)">...</div>
          <div class="metric-sub">Saved in your name →</div>
        </div>
      </div>
    </div>`;

  const el = document.querySelector('#ai-daily-insight .ai-insight-body');
  if (el && state.dailyBriefing) {
    el.innerHTML = state.dailyBriefing.replace(/\n/g,'<br>') +
      `<div class="ai-chips">
        <div class="ai-chip" onclick="openAIWithPrompt('Draft follow-up emails for my top 3 priority companies today')">Draft top 3 emails ↗</div>
        <div class="ai-chip" onclick="showView('myqueue')">Open my queue</div>
      </div>`;
  }

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
function getFilteredContacts() {
  return [...state.contacts]
    .filter(c => !state.contactsFilterTimezone || c.timezone === state.contactsFilterTimezone)
    .filter(c => !state.contactsFilterLeadSource || c.leadSource === state.contactsFilterLeadSource)
    .sort((a, b) => b.score - a.score);
}

function setContactsFilter(key, val) {
  state[key] = val;
  state.contactsPage = 0;
  renderContacts();
}

function renderContacts() {
  const filtered = getFilteredContacts();
  const pageSize = state.contactsPageSize || 50;
  const page = state.contactsPage || 0;
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  const timezones = [...new Set(state.contacts.map(c => c.timezone).filter(Boolean))].sort();
  const leadSources = [...new Set(state.contacts.map(c => c.leadSource).filter(Boolean))].sort();
  const selectStyle = 'font-size:12px;padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer';

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🏢 My Companies</h2><p>${filtered.length} of ${state.contacts.length} companies</p></div>
      <div class="topbar-right">
        <input id="contact-search" placeholder="Search companies..." style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;width:180px" oninput="filterContacts(this.value)" />
        <select onchange="setContactsFilter('contactsFilterTimezone',this.value)" style="${selectStyle}">
          <option value="">All Timezones</option>
          ${timezones.map(tz => `<option value="${tz}" ${state.contactsFilterTimezone===tz?'selected':''}>${tz}</option>`).join('')}
        </select>
        <select onchange="setContactsFilter('contactsFilterLeadSource',this.value)" style="${selectStyle}">
          <option value="">All Lead Sources</option>
          ${leadSources.map(ls => `<option value="${ls}" ${state.contactsFilterLeadSource===ls?'selected':''}>${ls}</option>`).join('')}
        </select>
        <span style="font-size:12px;color:var(--text2);margin-left:4px">Per page:</span>
        ${[25,50,100].map(n => `<button class="btn btn-sm ${pageSize===n?'btn-primary':''}" onclick="setContactsPageSize(${n})">${n}</button>`).join('')}
      </div>
    </div>
    <div class="content">
      <div style="display:grid;grid-template-columns:1fr 160px 160px auto;gap:10px;padding:6px 14px;border-bottom:1px solid var(--border);margin-bottom:4px">
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Company</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Timezone</div>
        <div style="font-size:11px;font-weight:600;color:var(--text3);text-transform:uppercase;letter-spacing:.06em">Lead Source</div>
        <div></div>
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
  const inQueue = findCompanyQueue(c.id);
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
      <button class="btn btn-sm" style="${inQueue ? 'color:var(--purple);border-color:rgba(167,139,250,.4)' : ''}" onclick="event.stopPropagation();${inQueue ? `removeFromQueue('${c.id}','${inQueue.id}')` : `addToQueue('${c.id}')`}">${inQueue ? '✓' : '+'}</button>
    </div>
  </div>`;
}

// ── MY QUEUE ──────────────────────────────────────────────────────────────────
async function renderMyQueue() {
  const activeQueue = state.queues.find(q => q.id === state.activeQueueId) || state.queues[0];
  const companies = activeQueue?.companies || [];
  const totalCompanies = state.queues.reduce((s, q) => s + q.companies.length, 0);

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>📋 My Queues</h2><p>${totalCompanies} companies across ${state.queues.length} queue${state.queues.length !== 1 ? 's' : ''}</p></div>
      <div class="topbar-right">
        ${state.queues.length < 5 ? `<button class="btn" onclick="promptCreateQueue()">+ New Queue</button>` : ''}
        ${activeQueue ? `<button class="btn" onclick="clearQueue('${activeQueue.id}')">🗑 Clear</button>` : ''}
      </div>
    </div>
    <div class="content">
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
        ${state.queues.length === 0 ? '<div style="font-size:13px;color:var(--text2)">No queues yet.</div>' : state.queues.map(q => `
          <div style="display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;background:${q.id === activeQueue?.id ? 'var(--purple)' : 'var(--bg3)'};color:${q.id === activeQueue?.id ? 'white' : 'var(--text2)'};cursor:pointer;font-size:12px;font-weight:600;border:1px solid ${q.id === activeQueue?.id ? 'transparent' : 'var(--border)'}" onclick="switchQueue('${q.id}')">
            <span>${q.name}</span>
            <span style="opacity:0.65;font-size:11px">${q.companies.length}</span>
            <span onclick="event.stopPropagation();promptRenameQueue('${q.id}','${q.name.replace(/'/g, "\\'")}')" style="opacity:0.55;font-size:10px;margin-left:2px" title="Rename">✏️</span>
            ${state.queues.length > 1 ? `<span onclick="event.stopPropagation();deleteQueue('${q.id}')" style="opacity:0.55;font-size:11px;font-weight:700;margin-left:1px" title="Delete">✕</span>` : ''}
          </div>`).join('')}
      </div>
      <div id="queue-list" class="lead-list">
        ${companies.length === 0
          ? `<div class="empty-state">${state.queues.length === 0 ? 'Create a queue first using "+ New Queue" above.' : 'This queue is empty. Add companies from any list.'}</div>`
          : companies.map(c => {
              const cleanPhone = c.phone ? c.phone.replace(/\D/g,'') : '';
              const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
              const colors = [{bg:'rgba(79,142,247,.2)',color:'#4f8ef7'},{bg:'rgba(62,207,142,.2)',color:'#3ecf8e'},{bg:'rgba(245,166,35,.2)',color:'#f5a623'},{bg:'rgba(240,82,82,.2)',color:'#f05252'},{bg:'rgba(167,139,250,.2)',color:'#a78bfa'}];
              const ac = colors[parseInt(c.id,10) % colors.length];
              const initials = c.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
              return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--purple);border-radius:var(--radius)">
                <div class="avatar" style="background:${ac.bg};color:${ac.color};flex-shrink:0;width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700">${initials}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:6px">
                    <span style="cursor:pointer;text-decoration:underline;text-underline-offset:3px" onclick="openContact('${c.id}')">${c.name}</span>
                    <a href="${hsUrl}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
                  </div>
                  <div style="font-size:11px;color:var(--text2);margin-top:2px;display:flex;gap:8px;flex-wrap:wrap">
                    ${c.timezone ? `<span>🕐 ${c.timezone}</span>` : ''}
                    ${c.leadSource ? `<span>· 📌 ${c.leadSource}</span>` : ''}
                    ${c.stage ? `<span>· <span style="color:var(--amber)">${c.stage}</span></span>` : ''}
                  </div>
                </div>
                <div style="flex-shrink:0;display:flex;align-items:center;gap:8px">
                  ${c.phone ? `<a href="tel:${cleanPhone}" style="color:var(--green);text-decoration:none;font-weight:700;font-size:14px;white-space:nowrap">📞 ${c.phone}</a>` : '<span style="color:var(--text3);font-size:12px">No phone</span>'}
                  <button class="btn btn-sm" style="color:var(--red);border-color:rgba(240,82,82,.3)" onclick="removeFromQueue('${c.id}','${activeQueue.id}')">Remove</button>
                </div>
              </div>`;
            }).join('')}
      </div>
    </div>`;
}

// ── PIPELINE ──────────────────────────────────────────────────────────────────
async function loadPipeline() {
  try {
    const res = await fetch('/api/pipeline', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const { pipeline } = await res.json();
    state.pipeline = pipeline || [];
    const badge = document.getElementById('badge-pipeline');
    if (badge) badge.textContent = state.pipeline.length;
  } catch {}
}

async function addToPipeline(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  if (!c) return;
  const res = await fetch('/api/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ action: 'add', companyId, companyName: c.name }),
  });
  const { pipeline } = await res.json();
  state.pipeline = pipeline;
  const badge = document.getElementById('badge-pipeline');
  if (badge) badge.textContent = state.pipeline.length;
  toast(`${c.name} added to pipeline ✓`, 'success');
}

async function removeFromPipeline(companyId) {
  const res = await fetch('/api/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ action: 'remove', companyId }),
  });
  const { pipeline } = await res.json();
  state.pipeline = pipeline;
  const badge = document.getElementById('badge-pipeline');
  if (badge) badge.textContent = state.pipeline.length;
  if (state.currentView === 'pipeline') renderPipeline();
}

async function updatePipelineStatus(companyId, status) {
  const res = await fetch('/api/pipeline', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ action: 'update', companyId, status }),
  });
  const { pipeline } = await res.json();
  state.pipeline = pipeline;
}

const PIPELINE_STATUSES = {
  hot_lead:       { label: 'Hot Lead',       color: 'var(--red)',    bg: 'rgba(240,82,82,.15)' },
  following_up:   { label: 'Following Up',   color: 'var(--amber)',  bg: 'rgba(245,166,35,.15)' },
  contacted:      { label: 'Contacted',      color: 'var(--blue)',   bg: 'rgba(79,142,247,.15)' },
  proposal_sent:  { label: 'Proposal Sent',  color: 'var(--purple)', bg: 'rgba(167,139,250,.15)' },
  closed:         { label: 'Closed',         color: 'var(--green)',  bg: 'rgba(62,207,142,.15)' },
};

async function renderPipeline() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <h2>📌 Pipeline</h2>
        <p>${state.pipeline.length} companies being tracked</p>
      </div>
    </div>
    <div class="content">
      ${state.pipeline.length === 0
        ? `<div class="empty-state" style="text-align:center;padding:60px 20px;color:var(--text2)">
            <div style="font-size:40px;margin-bottom:12px">📌</div>
            <div style="font-size:15px;font-weight:600;margin-bottom:6px">No companies in pipeline</div>
            <div style="font-size:13px">Open any company and click "Add to Pipeline" to start tracking it.</div>
           </div>`
        : `<div class="lead-list">
            ${state.pipeline.map(p => {
              const s = PIPELINE_STATUSES[p.status] || PIPELINE_STATUSES.following_up;
              const daysIn = Math.floor((Date.now() - new Date(p.addedAt)) / 86400000);
              const contact = state.contacts.find(c => c.id === p.companyId);
              const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${p.companyId}`;
              return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="cursor:pointer;text-decoration:underline;text-underline-offset:3px" onclick="openContact('${p.companyId}')">${p.companyName}</span>
                    <a href="${hsUrl}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
                  </div>
                  <div style="font-size:11px;color:var(--text2);margin-top:3px">${daysIn === 0 ? 'Added today' : `${daysIn} day${daysIn === 1 ? '' : 's'} in pipeline`}${contact ? ` · Last contact: ${contact.lastContacted}` : ''}</div>
                </div>
                <select onchange="updatePipelineStatus('${p.companyId}', this.value)" style="font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:${s.bg};color:${s.color};cursor:pointer">
                  ${Object.entries(PIPELINE_STATUSES).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
                </select>
                <button class="btn btn-sm" style="color:var(--red);border-color:rgba(240,82,82,.3);flex-shrink:0" onclick="removeFromPipeline('${p.companyId}')">Remove</button>
              </div>`;
            }).join('')}
           </div>`}
    </div>`;
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
    const inQueue = findCompanyQueue(raw.id);
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
            ${isSkipped ? '🚫 ' : ''}<span style="cursor:pointer;text-decoration:underline;text-underline-offset:3px" onclick="openContact('${raw.id}')">${name}</span>
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
    if (!findCompanyQueue(id)) {
      await addToQueue(id);
      added++;
    }
  }
  toast(`${added} companies added to queue ✓`, 'success');
}

async function handleQueueCheckbox(viewKey, companyId, checked) {
  if (checked) { await addToQueue(companyId); }
  else { const q = findCompanyQueue(companyId); if (q) await removeFromQueue(companyId, q.id); }
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
      <div class="topbar-left"><h2>✨ AI Assistant</h2><p>Ask anything about your pipeline, get follow-up emails drafted, and more</p></div>
    </div>
    <div class="chat-wrap">
      <div class="chat-messages" id="chat-messages">
        <div class="msg ai"><div class="msg-label">Assistant</div>
          <div class="msg-bubble">Hi ${state.user?.name || 'there'}! I'm connected to your HubSpot companies and ready to help. What do you need?</div>
        </div>
        <div class="ai-chips" style="padding:0 0 8px">
          <div class="ai-chip" onclick="sendPreset('Who are my top 3 companies to focus on today and why?')">Today's priorities ↗</div>
          <div class="ai-chip" onclick="sendPreset('Draft follow-up emails for my top 5 companies that need outreach')">Draft follow-ups ↗</div>
          <div class="ai-chip" onclick="sendPreset('Analyze my pipeline and tell me what is at risk')">Pipeline analysis ↗</div>
          <div class="ai-chip" onclick="sendPreset('Give me tips for handling the objection: we do not have budget right now')">Handle objection ↗</div>
        </div>
        ${state.chatHistory.map(m => `<div class="msg ${m.role === 'user' ? 'user' : 'ai'}"><div class="msg-label">${m.role === 'user' ? 'You' : 'Assistant'}</div><div class="msg-bubble">${m.content.replace(/\n/g, '<br>')}</div></div>`).join('')}
      </div>
      <div class="chat-input-area">
        <input id="chat-input" placeholder="Ask about a company, request a follow-up draft, analyze pipeline..." onkeydown="if(event.key==='Enter')sendChat()" />
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


// ── ADMIN ─────────────────────────────────────────────────────────────────────
async function loadUsageDashboard(month) {
  const el = document.getElementById('usage-table');
  if (!el) return;
  el.innerHTML = '<span class="spinner"></span> Loading...';
  const res = await fetch(`/api/usage?month=${month}`, { headers: { Authorization: `Bearer ${state.token}` } });
  const { rows } = await res.json();
  if (!rows?.length) { el.innerHTML = '<div style="color:var(--text3);font-size:13px">No usage data for this month yet.</div>'; return; }
  const fmt = n => `$${n.toFixed(4)}`;
  const fmtMin = s => s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
  const total = rows.reduce((a, r) => ({ groq: a.groq + r.groq_cost, claude: a.claude + r.claude_cost, total: a.total + r.total_cost }), { groq: 0, claude: 0, total: 0 });
  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="color:var(--text3);text-align:left;border-bottom:1px solid var(--border)">
          <th style="padding:6px 8px">Rep</th>
          <th style="padding:6px 8px;text-align:center">Calls</th>
          <th style="padding:6px 8px;text-align:center">AI Queries</th>
          <th style="padding:6px 8px;text-align:right">Groq (audio)</th>
          <th style="padding:6px 8px;text-align:right">Groq cost</th>
          <th style="padding:6px 8px;text-align:right">Claude cost</th>
          <th style="padding:6px 8px;text-align:right">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px"><div style="font-weight:500;color:var(--text)">${r.name}</div><div style="color:var(--text3);font-size:11px">${r.email}</div></td>
            <td style="padding:8px;text-align:center;color:var(--text2)">${r.calls}</td>
            <td style="padding:8px;text-align:center;color:var(--text2)">${r.ai_queries}</td>
            <td style="padding:8px;text-align:right;color:var(--text2)">${fmtMin(r.groq_seconds)}</td>
            <td style="padding:8px;text-align:right;color:var(--text2)">${fmt(r.groq_cost)}</td>
            <td style="padding:8px;text-align:right;color:var(--text2)">${fmt(r.claude_cost)}</td>
            <td style="padding:8px;text-align:right;font-weight:600;color:var(--text)">${fmt(r.total_cost)}</td>
          </tr>`).join('')}
        <tr style="border-top:2px solid var(--border)">
          <td style="padding:8px;font-weight:600;color:var(--text)" colspan="4">Total</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:var(--text)">${fmt(total.groq)}</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:var(--text)">${fmt(total.claude)}</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:var(--green)">${fmt(total.total)}</td>
        </tr>
      </tbody>
    </table>`;
}

async function renderAdmin() {
  if (!state.isAdmin) { showView('dashboard'); return; }
  const currentMonth = new Date().toISOString().slice(0, 7);
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
      <div style="border-top:1px solid var(--border);padding-top:16px;margin-top:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div class="section-title">API Usage & Cost</div>
          <input type="month" id="usage-month" value="${currentMonth}" onchange="loadUsageDashboard(this.value)"
            style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:5px 10px;color:var(--text);font-size:12px;outline:none" />
        </div>
        <div id="usage-table"><span class="spinner"></span> Loading...</div>
      </div>
    </div>`;
  loadUserList();
  loadUsageDashboard(currentMonth);
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
  const inQueue = findCompanyQueue(id);

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

  const inPipeline = state.pipeline.find(p => p.companyId === id);
  const queueBtn = inQueue
    ? `<button class="btn btn-sm btn-primary" onclick="removeFromQueue('${id}','${inQueue.id}');closeModal()">✓ ${inQueue.name}</button>`
    : state.queues.length <= 1
      ? `<button class="btn btn-sm" onclick="addToQueue('${id}',${state.queues[0] ? `'${state.queues[0].id}'` : 'null'});closeModal()">+ Queue</button>`
      : `<select onchange="if(this.value){addToQueue('${id}',this.value);closeModal()}" style="font-size:12px;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:var(--bg2);color:var(--text);cursor:pointer"><option value="">📋 Add to queue...</option>${state.queues.map(q=>`<option value="${q.id}">${q.name}</option>`).join('')}</select>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>
    ${queueBtn}
    <button class="btn btn-sm ${inPipeline ? '' : ''}" style="${inPipeline ? 'color:var(--purple);border-color:rgba(167,139,250,.4)' : ''}" onclick="${inPipeline ? `removeFromPipeline('${id}')` : `addToPipeline('${id}')`}; closeModal()">
      ${inPipeline ? '📌 In Pipeline' : '📌 Pipeline'}
    </button>
    <button class="btn btn-sm" onclick="openAIWithPrompt('Draft a follow-up email to ${c.name}. Stage: ${c.masterStage || c.stage}. Last contacted: ${c.lastContacted}. Be warm and specific.')">✨ Draft email</button>
    <button class="btn btn-sm" style="background:var(--green-dim);border-color:rgba(62,207,142,.3);color:var(--green)" onclick="closeModal();openCallLogger('${id}')">🎙️ Log Call + AI Notes</button>
`;
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
  await Promise.all([loadContacts(), loadQueue(), loadPipeline()]);
  if (state.currentView === 'dashboard') showView('dashboard');
  loadDailyBriefing();
  startAutoRefresh();
}

async function loadDailyBriefing() {
  if (state.dailyBriefing || !state.contacts.length) return;
  try {
    const insight = await askAI(`Give me a 2-3 sentence morning briefing for my pipeline. Which of my assigned companies should I prioritize today and why? Be specific with company names. Always write complete sentences — never cut off mid-sentence.`, `Today's date: ${new Date().toLocaleDateString()}`);
    state.dailyBriefing = insight;
  } catch(e) { state.dailyBriefing = `AI briefing unavailable: ${e.message}`; }
  if (state.currentView === 'dashboard') {
    const el = document.querySelector('#ai-daily-insight .ai-insight-body');
    if (el) el.innerHTML = state.dailyBriefing.replace(/\n/g,'<br>') +
      `<div class="ai-chips">
        <div class="ai-chip" onclick="openAIWithPrompt('Draft follow-up emails for my top 3 priority companies today')">Draft top 3 emails ↗</div>
        <div class="ai-chip" onclick="showView('myqueue')">Open my queue</div>
      </div>`;
  }
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
        <div style="font-size:11px;color:var(--text3)">Supports MP3, MP4, M4A, WAV</div>
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
    <div style="padding:24px 8px">
      <div id="transcribe-status" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px;text-align:center">Processing...</div>
      <div style="background:var(--bg3);border-radius:99px;height:8px;overflow:hidden">
        <div id="transcribe-bar" style="height:100%;width:0%;background:var(--blue);border-radius:99px;transition:width 0.4s ease"></div>
      </div>
      <div id="transcribe-elapsed" style="font-size:11px;color:var(--text3);text-align:center;margin-top:8px">0s</div>
    </div>`;

  state.transcribing = true;
  try {
    const cacheKey = `transcript_${file.name}_${file.size}_${file.lastModified}`;
    let transcript = null;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      transcript = cached;
      document.getElementById('transcribe-status').textContent = 'Using cached transcript...';
    } else {
      // Get whisper server config
      const { url: whisperUrl, key: whisperKey } = await fetch('/api/transcribe').then(r => r.json());

      // Send full file directly to whisper server (no size limit)
      document.getElementById('transcribe-status').textContent = 'Uploading...';
      const uploadBar = document.getElementById('transcribe-bar');
      if (uploadBar) uploadBar.style.width = '5%';
      const uploadRes = await fetch(`${whisperUrl}/transcribe`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${whisperKey}`, 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadData.detail || uploadData.error}`);
      const { job_id } = uploadData;

      // Poll for completion
      document.getElementById('transcribe-status').textContent = 'Transcribing...';
      const transcribeBarInit = document.getElementById('transcribe-bar');
      if (transcribeBarInit) transcribeBarInit.style.width = '10%';
      const transcribeStart = Date.now();
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const statusRes = await fetch(`${whisperUrl}/status/${job_id}`, {
          headers: { 'Authorization': `Bearer ${whisperKey}` },
        });
        const statusData = await statusRes.json();
        if (statusData.status === 'error') throw new Error(statusData.error || 'Transcription failed');
        if (statusData.status === 'done') { transcript = statusData.transcript; break; }
        const elapsed = Math.round((Date.now() - transcribeStart) / 1000);
        const progress = Math.min(90, (elapsed / 180) * 90);
        const bar = document.getElementById('transcribe-bar');
        const elapsedEl = document.getElementById('transcribe-elapsed');
        if (bar) bar.style.width = `${progress}%`;
        if (elapsedEl) elapsedEl.textContent = `${elapsed}s`;
      }

      try { localStorage.setItem(cacheKey, transcript); } catch {}
    }

    // Analyze with Claude
    const bar = document.getElementById('transcribe-bar');
    if (bar) bar.style.width = '100%';
    document.getElementById('transcribe-status').textContent = 'Analyzing with AI...';
    const analysisRes = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ transcript, companyName: c.name }),
    });
    const analysisJson = await analysisRes.json();
    if (!analysisRes.ok) throw new Error(`Analysis failed: ${analysisJson.error || JSON.stringify(analysisJson)}`);
    const { analysis } = analysisJson;

    state.transcribing = false;
    showCallAnalysis(companyId, transcript, analysis);
  } catch (e) {
    state.transcribing = false;
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
