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
  pipelineSortByStage: false,
  demoTags: {},
  demoAcks: {},
  calendarDateOffset: 0,
  eventHsCache: {},
  orgSettings: {},
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
  'hubspot_owner_assigneddate', 'notes_next_activity_date',
  'most_recent_call_outcome'
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
      else { state.contacts = enriched; enrichContactPhones(); }
      state.hsConnected = true;
      updateHsStatus(true);
      updateBadges();
      if (state.currentView === 'contacts') renderContacts();
      if (data.paging?.next?.after) loadContacts(data.paging.next.after);
    } else if (!after) {
      console.error('HubSpot search error:', data);
      updateHsStatus(false);
    }
  } catch (e) { console.error('Failed to load companies:', e); updateHsStatus(false); }
}

async function enrichContactPhones() {
  try {
    const companyIds = state.contacts.map(c => c.id);
    if (!companyIds.length) return;
    // Batch fetch contact associations for all companies
    const assocRes = await hsPost('/crm/v4/associations/companies/contacts/batch/read', {
      inputs: companyIds.slice(0, 100).map(id => ({ id }))
    });
    if (!assocRes.results?.length) return;
    const contactMap = {};
    assocRes.results.forEach(r => { if (r.to?.length) contactMap[r.from.id] = r.to[0].toObjectId; });
    const contactIds = [...new Set(Object.values(contactMap))];
    if (!contactIds.length) return;
    const phoneRes = await hsPost('/crm/v3/objects/contacts/batch/read', {
      inputs: contactIds.map(id => ({ id })), properties: ['phone', 'mobilephone']
    });
    const phoneMap = {};
    (phoneRes.results || []).forEach(c => { phoneMap[c.id] = c.properties.mobilephone || c.properties.phone || null; });
    let updated = false;
    state.contacts.forEach(c => {
      const cid = contactMap[c.id];
      if (cid && phoneMap[cid] && !c.phone) { c.phone = phoneMap[cid]; updated = true; }
    });
    if (updated && state.currentView === 'contacts') renderContacts();
  } catch {}
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
  const masterStage = p.subscription_status || '';
  const followUpStages = ['Demo Set', 'Demo Completed', 'Contract Sent', 'Contract Revision'];
  const isFollowUp = followUpStages.includes(masterStage) && daysSince > 3 && !p.notes_next_activity_date;
  const isRoeRisk = p.dnr !== 'Yes' && (daysSince > 14);
  const lastCallerWasMe = p.recent_user_to_call && p.recent_user_to_call === (p.hubspot_owner_id || '');
  const isDmConnected = lastCallerWasMe && (p.most_recent_call_outcome || '').toLowerCase().includes('dm connected');
  const isDnr = p.dnr === 'Yes';
  const isNeverCalledByMe = !lastCallerWasMe;
  const hasFutureActivityDate = !!p.notes_next_activity_date && new Date(p.notes_next_activity_date) > new Date();
  return {
    id: raw.id, name, phone: p.phone || '', city: p.city || '', state: p.state || '',
    website: p.website || '', industry: p.industry || '', timezone: p['timezone_'] || '',
    leadSource: p.lead_source || '', stage: p.lifecyclestage || p.hs_lead_status || 'lead',
    masterStage, ownerId: p.hubspot_owner_id || '',
    daysSince, lastContacted: lastContactedMs ? new Date(lastContactedMs).toLocaleDateString() : 'Never',
    score, urgency, initials, avatarColor: avatarColor(raw.id),
    needsCall: daysSince > 7 || !lastContactedMs, createdAt: p.createdate,
    isFollowUp, isRoeRisk, isDmConnected, isDnr, isNeverCalledByMe, hasFutureActivityDate,
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
  const contactSummary = state.contacts.map(c => {
    const flags = [
      c.isFollowUp ? 'FOLLOW-UP NEEDED' : '',
      c.isDmConnected ? 'DM CONNECTED (call back)' : '',
      c.isRoeRisk ? 'ROE RISK' : '',
    ].filter(Boolean).join(', ');
    return `${c.name} | stage: ${c.masterStage || c.stage} | last contact: ${c.lastContacted} (${c.daysSince === 999 ? 'never' : c.daysSince + 'd ago'}) | ${flags ? 'PRIORITY: ' + flags : 'no priority flags'} | timezone: ${c.timezone} | lead source: ${c.leadSource}`;
  }).join('\n');
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
    hubspotviews: renderHubSpotViews,
    ai: renderAI,
    admin: renderAdmin,
    nevercalled: () => renderPriorityView('nevercalled', '📵 Never Called By Me'),
    roerisklist: () => renderPriorityView('roerisklist', '⚠️ ROE Risk'),
    followuplist: () => renderPriorityView('followuplist', '🔔 Follow-ups'),
    dnrlist: () => renderPriorityView('dnrlist', '💾 Do Not Recirculate'),
    settings: renderSettingsView,
    dialer: renderDialerView,
  };
  document.getElementById('main').innerHTML = '';
  (views[view] || renderDashboard)();
  if (view === 'contacts' && !state.contacts.length) {
    loadContacts().then(() => { if (state.currentView === 'contacts') renderContacts(); });
  }
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function getCalendarViewDate() {
  const d = new Date();
  d.setDate(d.getDate() + (state.calendarDateOffset || 0));
  d.setHours(0, 0, 0, 0);
  return d;
}

async function navigateCalendarDay(n) {
  if (n === null) state.calendarDateOffset = 0;
  else state.calendarDateOffset = Math.max(-31, Math.min(31, (state.calendarDateOffset || 0) + n));
  const d = getCalendarViewDate();
  const isToday = state.calendarDateOffset === 0;
  const lbl = document.getElementById('cal-date-label');
  if (lbl) lbl.textContent = d.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const todayBtn = document.getElementById('cal-today-btn');
  if (todayBtn) todayBtn.style.display = isToday ? 'none' : '';
  const el = document.getElementById('schedule-content');
  if (el) el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:40px;color:var(--text2);justify-content:center"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Loading...</div>`;
  const s = new Date(d), e = new Date(d); e.setHours(23,59,59,999);
  try {
    const calRes = await fetch(`/api/calendar?${new URLSearchParams({ action:'events', timeMin:s.toISOString(), timeMax:e.toISOString() })}`, { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await calRes.json();
    state._cachedCalEvents = data.events || [];
    if (isToday) { state.calendarEvents = data.events || []; renderDemoBanner(); }
    resolveEventCompanies(data.events || []);
  } catch {}
  renderScheduleSection();
}

async function renderDashboard() {
  const main = document.getElementById('main');
  const viewDate = getCalendarViewDate();
  const isToday = state.calendarDateOffset === 0;
  const dateStr = viewDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  const pStatuses = getPipelineStatuses();
  const stageCounts = {};
  state.pipeline.forEach(p => { stageCounts[p.status] = (stageCounts[p.status] || 0) + 1; });

  const sidePanel = () => `
    <div style="display:flex;flex-direction:column;gap:16px">
      <div>
        <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Priority</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
          <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--red);padding:10px 12px" onclick="showView('nevercalled')">
            <div class="metric-label" style="font-size:10px">📵 Never Called</div>
            <div class="metric-value" id="count-nevercalled" style="color:var(--red);font-size:22px">...</div>
          </div>
          <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--amber);padding:10px 12px" onclick="showView('roerisklist')">
            <div class="metric-label" style="font-size:10px">⚠️ ROE Risk</div>
            <div class="metric-value" id="count-roe" style="color:var(--amber);font-size:22px">...</div>
          </div>
          <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--blue);padding:10px 12px" onclick="showView('followuplist')">
            <div class="metric-label" style="font-size:10px">🔔 Follow-ups</div>
            <div class="metric-value" id="count-followup" style="color:var(--blue);font-size:22px">...</div>
          </div>
          <div class="metric-card" style="cursor:pointer;border-left:3px solid var(--green);padding:10px 12px" onclick="showView('dnrlist')">
            <div class="metric-label" style="font-size:10px">💾 DNR</div>
            <div class="metric-value" id="count-dnr" style="color:var(--green);font-size:22px">...</div>
          </div>
        </div>
      </div>
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em">Pipeline</div>
            <span style="font-size:10px;color:var(--text3);cursor:pointer;border:1px solid var(--border2);padding:1px 6px;border-radius:4px" onclick="openPipelineLabelEditor()">✏️ Edit</span>
          </div>
          <span style="font-size:11px;color:var(--blue);cursor:pointer" onclick="showView('pipeline')">${state.pipeline.length} total →</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${Object.entries(pStatuses).map(([key, { label, color }]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${color};border-radius:var(--radius);cursor:pointer" onclick="showView('pipeline')">
              <span style="font-size:12px;color:var(--text2)">${label}</span>
              <span style="font-size:14px;font-weight:700;color:${color}">${stageCounts[key] || 0}</span>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  main.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <h2>📅 Schedule</h2>
        <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
          <button class="btn btn-sm" onclick="navigateCalendarDay(-1)" style="padding:3px 10px;font-size:14px">←</button>
          <span id="cal-date-label" style="font-size:13px;color:var(--text2);min-width:190px;text-align:center">${dateStr}</span>
          <button class="btn btn-sm" onclick="navigateCalendarDay(1)" style="padding:3px 10px;font-size:14px">→</button>
          <button id="cal-today-btn" class="btn btn-sm" onclick="navigateCalendarDay(null)" style="display:${isToday ? 'none' : ''};font-size:11px">Today</button>
        </div>
      </div>
      <div class="topbar-right">
        <button id="refresh-btn" class="btn" onclick="manualRefresh()">⟳ Refresh</button>
        <button class="btn btn-primary" onclick="showView('ai')">✨ Ask AI</button>
      </div>
    </div>
    <div class="content">
      <div style="display:grid;grid-template-columns:1fr 260px;gap:20px;align-items:start">
        <div id="schedule-content">
          <div style="display:flex;align-items:center;gap:10px;padding:40px;color:var(--text2);justify-content:center">
            <div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite"></div>
            Loading schedule...
          </div>
        </div>
        ${sidePanel()}
      </div>
    </div>`;

  updateDashboardCounts();

  const _s = new Date(viewDate), _e = new Date(viewDate); _e.setHours(23,59,59,999);
  const _calParams = new URLSearchParams({ action: 'events', timeMin: _s.toISOString(), timeMax: _e.toISOString() });
  const fetches = [
    fetch(`/api/calendar?${_calParams}`, { headers: { Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({ events: [] })),
  ];
  if (isToday) fetches.unshift(fetch('/api/hubspot?action=tasks', { headers: { Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({ tasks: [] })));
  const results = await Promise.all(fetches);
  const tasksRes = isToday ? results[0] : { tasks: [] };
  const calRes = results[isToday ? 1 : 0];
  state._cachedTasks = tasksRes.tasks || [];
  state._cachedCalEvents = calRes.events || [];
  if (calRes.events) state.calendarEvents = calRes.events;
  if (calRes.calendars) state._availableCalendars = calRes.calendars;
  renderDemoBanner();
  renderScheduleSection();
}

function updateDashboardCounts() {
  const neverCalled = state.contacts.filter(c => c.isNeverCalledByMe && !c.isDnr).length;
  const roeRisk = state.contacts.filter(c => c.isRoeRisk && !c.isDnr).length;
  const followUp = state.contacts.filter(c => c.isFollowUp).length;
  const dnr = state.contacts.filter(c => c.isDnr).length;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('count-nevercalled', neverCalled); set('badge-nevercalled', neverCalled);
  set('count-roe', roeRisk);            set('badge-roe', roeRisk);
  set('count-followup', followUp);      set('badge-followup', followUp);
  set('count-dnr', dnr);               set('badge-dnr', dnr);
}

function renderScheduleSection() {
  const el = document.getElementById('schedule-content');
  if (!el) return;
  const showTasks = state.scheduleShowTasks !== false;
  const showCal = state.scheduleShowCal !== false;
  const isToday = !state.calendarDateOffset;
  const disabled = new Set(state.calendarPrefs?.disabledCalendars || []);
  const filteredCal = (state._cachedCalEvents || []).filter(e => !e.calendarId || !disabled.has(e.calendarId));
  el.innerHTML = `
    <div style="display:flex;gap:6px;margin-bottom:10px;align-items:center">
      <button class="btn btn-sm ${showCal ? 'btn-primary' : ''}" onclick="toggleScheduleFilter('calendar')" style="font-size:11px">📅 Calendar</button>
      <span onclick="showView('settings')" style="font-size:11px;color:var(--text3);margin-left:auto;cursor:pointer;text-decoration:underline">⚙️ Settings</span>
    </div>` + buildScheduleHTML(showTasks && isToday ? (state._cachedTasks || []) : [], showCal ? filteredCal : [], getCalendarViewDate());
}

function toggleScheduleFilter(type) {
  if (type === 'tasks') state.scheduleShowTasks = state.scheduleShowTasks !== false ? false : true;
  if (type === 'calendar') state.scheduleShowCal = state.scheduleShowCal !== false ? false : true;
  if (type === 'overdue') state.scheduleShowOverdue = state.scheduleShowOverdue !== false ? false : true;
  if (type === 'tasks' || type === 'overdue') {
    fetch('/api/users?action=setcalprefs', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ showTasks: state.scheduleShowTasks !== false, showOverdue: state.scheduleShowOverdue !== false }) }).catch(() => {});
  }
  renderScheduleSection();
}

function buildScheduleHTML(allTasks, calEvents, viewDate) {
  const today = new Date();
  const vd = viewDate || today;
  const isViewToday = vd.toDateString() === today.toDateString();
  const isPastDay = vd < today && !isViewToday;
  const nowMins = isViewToday ? today.getHours() * 60 + today.getMinutes() : (isPastDay ? 9999 : -1);
  const todayStart = new Date(vd); todayStart.setHours(0,0,0,0);
  const TASK_ICONS = { CALL: '📞', EMAIL: '✉️', TODO: '✅' };

  const taskCard = (task, isOverdue = false) => {
    const company = state.contacts.find(c => c.id === task.companyId);
    const hsUrl = task.companyId ? `https://app.hubspot.com/contacts/45530742/company/${task.companyId}` : null;
    return `<div style="display:flex;gap:10px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${isOverdue ? 'var(--red)' : 'var(--amber)'};border-radius:var(--radius)${company ? ';cursor:pointer' : ''}" ${company ? `onclick="openContact('${task.companyId}')"` : ''}>
      <div style="font-size:16px;flex-shrink:0">${TASK_ICONS[task.type] || '✅'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${task.subject}</div>
        ${company ? `<div style="display:flex;align-items:center;gap:6px;margin-top:3px"><span style="font-size:12px;color:var(--text2)">${company.name}</span>${hsUrl ? `<a href="${hsUrl}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 5px;border-radius:4px">HS ↗</a>` : ''}</div>` : ''}
        ${isOverdue ? `<div style="font-size:11px;color:var(--red);margin-top:2px">Due ${new Date(+task.dueAt || task.dueAt).toLocaleDateString('en-US', { month:'short', day:'numeric' })}</div>` : ''}
      </div>
    </div>`;
  };

  const autoLink = (text) => text.replace(/(https?:\/\/[^\s<>"]+)/g, u => `<a href="${u}" target="_blank" style="color:var(--blue);text-decoration:underline;word-break:break-all">${u}</a>`);

  const eventCard = (ev) => {
    const d = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
    const timeStr = d ? d.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : 'All day';
    const endD = ev.end?.dateTime ? new Date(ev.end.dateTime) : null;
    const dur = d && endD ? Math.round((endD - d) / 60000) : null;
    const durStr = dur ? (dur >= 60 ? `${Math.floor(dur/60)}h${dur%60 ? ' ' + dur%60 + 'm' : ''}` : `${dur}m`) : '';
    const hsMatch = ev.description?.match(/https:\/\/app\.hubspot\.com\/contacts\/\d+\/company\/\d+/);
    const hsUrl = hsMatch?.[0] || (ev.id ? state.eventHsCache[ev.id] : null) || null;
    const rawDesc = ev.description ? ev.description.replace(/<[^>]*>/g, '').replace(/HubSpot:.*$/m, '').trim().slice(0, 300) : null;
    const cleanDesc = rawDesc ? autoLink(rawDesc) : null;
    const locationHtml = ev.location ? autoLink(ev.location) : null;
    const tagKey = demoTagKey(ev);
    const isDemo = isTaggedDemo(ev);
    return `<div data-tag-key="${tagKey}" style="padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${isDemo ? '#f59e0b' : 'var(--blue)'};border-radius:var(--radius)">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">
        <div style="font-size:13px;font-weight:600;color:var(--text)"><span class="event-icon">${isDemo ? '🎯' : '📅'}</span> ${ev.summary || 'Event'}</div>
        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
          ${hsUrl ? `<a href="${hsUrl}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px;white-space:nowrap">HS ↗</a>` : ''}
          ${ev.htmlLink ? `<a href="${ev.htmlLink}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px;white-space:nowrap">Cal ↗</a>` : ''}
          <button class="demo-tag-btn" onclick="toggleDemoTag('${tagKey}')" style="font-size:10px;padding:2px 8px;border-radius:4px;border:1px solid ${isDemo ? 'rgba(245,158,11,.4)' : 'var(--border2)'};background:${isDemo ? 'rgba(245,158,11,.15)' : 'transparent'};color:${isDemo ? '#f59e0b' : 'var(--text3)'};cursor:pointer;white-space:nowrap">${isDemo ? '🎯 Demo' : 'Mark Demo'}</button>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text3);margin-top:2px">${timeStr}${durStr ? ' · ' + durStr : ''}</div>
      ${locationHtml ? `<div style="font-size:11px;color:var(--text3);margin-top:2px">📍 ${locationHtml}</div>` : ''}
      ${cleanDesc ? `<div style="font-size:12px;color:var(--text2);margin-top:5px;line-height:1.5">${cleanDesc}</div>` : ''}
      ${ev.attendees?.length ? `<div style="font-size:11px;color:var(--text3);margin-top:4px">👥 ${ev.attendees.join(', ')}</div>` : ''}
    </div>`;
  };

  // Separate tasks
  const overdue = allTasks.filter(t => { const d = new Date(+t.dueAt || t.dueAt); return d < todayStart; });
  const timedItems = [], untimedItems = [];
  allTasks.filter(t => { const d = new Date(+t.dueAt || t.dueAt); return d >= todayStart; }).forEach(task => {
    const d = new Date(+task.dueAt || task.dueAt);
    if (d.getHours() < 6) untimedItems.push({ kind:'task', data: task });
    else timedItems.push({ kind:'task', data: task, mins: d.getHours()*60+d.getMinutes(), hour: d.getHours() });
  });
  calEvents.forEach(ev => {
    if (ev.start?.dateTime) {
      const d = new Date(ev.start.dateTime);
      timedItems.push({ kind:'event', data: ev, mins: d.getHours()*60+d.getMinutes(), hour: d.getHours() });
    } else { untimedItems.push({ kind:'allday', data: ev }); }
  });
  timedItems.sort((a,b) => a.mins - b.mins);

  let html = '';

  // Timeline
  const START_H = 7, END_H = 21;
  let nowInserted = false, timelineHtml = '';
  for (let h = START_H; h <= END_H; h++) {
    const slotMins = h * 60;
    if (isViewToday && !nowInserted && slotMins > nowMins) {
      const nowStr = today.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
      timelineHtml += `<div style="display:flex;align-items:center;gap:8px;margin:4px 0 4px 62px"><div style="height:2px;flex:1;background:var(--red)"></div><div style="font-size:11px;font-weight:700;color:var(--red);white-space:nowrap">${nowStr}</div><div style="height:2px;flex:1;background:var(--red)"></div></div>`;
      nowInserted = true;
    }
    const items = timedItems.filter(i => i.hour === h);
    const past = slotMins + 60 <= nowMins;
    const label = new Date(2000,0,1,h).toLocaleTimeString('en-US', { hour:'numeric' });
    timelineHtml += `<div style="display:flex;gap:10px;min-height:${items.length ? 'auto' : '28px'};margin-bottom:${items.length ? '6px' : '0'}">
      <div style="width:52px;flex-shrink:0;text-align:right;padding-top:${items.length ? '10px' : '6px'}"><span style="font-size:11px;font-weight:600;color:${past ? 'var(--text3)' : 'var(--text2)'}">${label}</span></div>
      <div style="flex:1;border-top:1px solid var(--border);padding-top:${items.length ? '6px' : '0'};display:flex;flex-direction:column;gap:6px;opacity:${past ? '0.6' : '1'}">
        ${items.map(i => i.kind === 'event' ? eventCard(i.data) : taskCard(i.data)).join('')}
      </div>
    </div>`;
  }
  if (isViewToday && !nowInserted) {
    const nowStr = today.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
    timelineHtml = `<div style="display:flex;align-items:center;gap:8px;margin:4px 0 4px 62px"><div style="height:2px;flex:1;background:var(--red)"></div><div style="font-size:11px;font-weight:700;color:var(--red);white-space:nowrap">${nowStr}</div><div style="height:2px;flex:1;background:var(--red)"></div></div>` + timelineHtml;
  }

  const noCalMsg = !timedItems.length ? `<div style="margin:12px 0 8px 62px;font-size:13px;color:var(--text3);font-style:italic">nothing on the calendar yet. feeling otfy?</div>` : '';

  html += `<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px">Schedule</div>${noCalMsg}${timelineHtml}</div>`;

  if (overdue.length && state.scheduleShowOverdue !== false) html += `<div style="margin-bottom:20px"><div style="font-size:11px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">⚠️ Overdue — ${overdue.length}</div><div style="display:flex;flex-direction:column;gap:6px">${overdue.map(t => taskCard(t, true)).join('')}</div></div>`;

  const dueSectionLabel = isViewToday ? 'Due Today' : vd.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  if (untimedItems.length) html += `<div><div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">${dueSectionLabel}</div><div style="display:flex;flex-direction:column;gap:6px">${untimedItems.map(item => item.kind === 'allday' ? `<div style="padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid var(--blue);border-radius:var(--radius)"><div style="font-size:13px;font-weight:600;color:var(--text)">📅 ${item.data.summary || 'All-day event'}</div><div style="font-size:11px;color:var(--text3);margin-top:2px">All day</div></div>` : taskCard(item.data)).join('')}</div></div>`;

  if (!overdue.length && !timedItems.length && !untimedItems.length) html = `<div style="text-align:center;padding:60px 20px;color:var(--text2)"><div style="font-size:40px;margin-bottom:12px">${isPastDay ? '📭' : '🎉'}</div><div style="font-size:15px;font-weight:600;margin-bottom:6px">${isPastDay ? 'Nothing on record' : 'All caught up'}</div><div style="font-size:13px">${isPastDay ? 'No events found for this day.' : 'No tasks or events today.'}</div></div>`;

  return html;
}

async function loadDashboardPanels() {
  // Compute counts from already-loaded state.contacts (no extra HubSpot calls)
  updateDashboardCounts();
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
  if (!state.userColumns) state.userColumns = DEFAULT_COLUMNS;
  const cols = getUserColumns();
  const { field = 'score', dir = 'desc' } = state.contactsSort || {};
  let filtered = [...state.contacts]
    .filter(c => !state.contactsFilterTimezone || c.timezone === state.contactsFilterTimezone)
    .filter(c => !state.contactsFilterLeadSource || c.leadSource === state.contactsFilterLeadSource)
    .filter(c => !state.contactsSearch || c.name?.toLowerCase().includes(state.contactsSearch.toLowerCase()));
  filtered.sort((a, b) => {
    let av = a[field] ?? a.rawProps?.[field] ?? '', bv = b[field] ?? b.rawProps?.[field] ?? '';
    if (field === 'daysSince') { av = av === 999 ? 9999 : (av||9999); bv = bv === 999 ? 9999 : (bv||9999); }
    const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
    return dir === 'desc' ? -cmp : cmp;
  });
  const pageSize = state.contactsPageSize || 50;
  const page = state.contactsPage || 0;
  const paginated = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);
  const sortArrow = (col) => field === col ? (dir === 'asc' ? ' ↑' : ' ↓') : '';
  const gridCols = cols.map(() => 'minmax(120px,1fr)').join(' ') + ' 80px';

  const rows = paginated.map(c => {
    const inQueue = findCompanyQueue(c.id);
    const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${c.id}`;
    const cells = cols.map(col => {
      const val = getContactValue(c, col.name);
      if (col.name === 'name') return `<div style="padding:10px 12px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val}</div>`;
      if ((col.name === 'phone' || col.name === 'contact_phone_number__') && val) return `<div style="padding:10px 12px" onclick="event.stopPropagation()"><a href="tel:${val.replace(/\D/g,'')}" style="color:var(--green);text-decoration:none;font-weight:600;white-space:nowrap">${val}</a></div>`;
      if (col.name === 'score') return `<div style="padding:10px 12px"><span class="score-badge score-${c.urgency === 'urgent' ? 'hot' : c.urgency}">${val}</span></div>`;
      return `<div style="padding:10px 12px;font-size:12px;color:var(--text2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${val || '—'}</div>`;
    }).join('');
    const queueBtn = inQueue
      ? `<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;color:var(--purple);border-color:rgba(167,139,250,.4)" onclick="removeFromQueue('${c.id}','${inQueue.id}')">✓</button>`
      : `<button class="btn btn-sm" style="font-size:10px;padding:2px 6px" onclick="pickQueueToAdd('${c.id}')">+</button>`;
    return `<div onclick="openContact('${c.id}')" style="display:grid;grid-template-columns:${gridCols};background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:4px;cursor:pointer;align-items:center">
      ${cells}
      <div style="padding:6px 8px;display:flex;gap:4px;align-items:center" onclick="event.stopPropagation()">
        <a href="${hsUrl}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 5px;border-radius:4px">HS↗</a>
        ${queueBtn}
      </div>
    </div>`;
  }).join('');

  const pagination = totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:8px;margin-top:12px">${Array.from({length: Math.min(totalPages, 10)}, (_, i) => `<button class="btn btn-sm ${i === page ? 'btn-primary' : ''}" onclick="state.contactsPage=${i};renderContacts()">${i + 1}</button>`).join('')}${totalPages > 10 ? `<span style="color:var(--text3);font-size:12px;padding:6px">...${totalPages} pages</span>` : ''}</div>` : '';

  document.getElementById('main').innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🏢 My Companies</h2><p>${filtered.length} of ${state.contacts.length}</p></div>
      <div class="topbar-right" style="gap:6px">
        <input id="contact-search" value="${state.contactsSearch || ''}" placeholder="Search..." style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;width:160px" oninput="state.contactsSearch=this.value;state.contactsPage=0;window._restoreSearchFocus=true;clearTimeout(window._searchTimer);window._searchTimer=setTimeout(renderContacts,250)" />
        <button class="btn btn-sm" onclick="openColumnPicker()" style="font-size:12px">⚙️ Columns</button>
        ${[25, 50, 100].map(n => `<button class="btn btn-sm ${pageSize === n ? 'btn-primary' : ''}" onclick="state.contactsPageSize=${n};state.contactsPage=0;renderContacts()">${n}</button>`).join('')}
      </div>
    </div>
    <div class="content" style="overflow-x:auto">
      <div style="display:grid;grid-template-columns:${gridCols};border-bottom:2px solid var(--border);margin-bottom:4px;min-width:600px">
        ${cols.map(col => `<div onclick="setContactsSortCol('${col.name}')" style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;padding:8px 12px;cursor:pointer;white-space:nowrap;user-select:none">${col.label}${sortArrow(col.name)}</div>`).join('')}
        <div></div>
      </div>
      <div id="contact-list" style="min-width:600px">${rows}</div>
      ${pagination}
    </div>`;
  if (window._restoreSearchFocus) {
    window._restoreSearchFocus = false;
    const si = document.getElementById('contact-search');
    if (si) { si.focus(); const len = si.value.length; si.setSelectionRange(len, len); }
  }
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
// ─── HUBSPOT VIEWS ────────────────────────────────────────────────────────────
state._hsViews = null;
state._hsViewCompanies = null;
state._hsActiveView = null;
state._hsSearchBody = null;
state._hsSearchAfter = null;
state._hsActiveViewName = null;

state._hsProps = null;

async function loadHsProperties() {
  if (state._hsProps) return state._hsProps;
  try {
    const res = await fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': '/crm/v3/properties/companies?limit=500', Authorization: `Bearer ${state.token}` } });
    const data = await res.json();
    state._hsProps = (data.results || [])
      .filter(p => !p.hidden && !p.calculated)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(p => ({
        label: p.label,
        prop: p.name,
        type: p.fieldType === 'select' || p.fieldType === 'checkbox' || p.fieldType === 'booleancheckbox' ? 'enum' : p.fieldType === 'date' || p.fieldType === 'datetime' ? 'date' : p.fieldType === 'number' ? 'number' : 'text',
        values: (p.options || []).map(o => ({ label: o.label, value: o.value })),
        referencedObjectType: p.referencedObjectType || null,
      }));
  } catch {}
  return state._hsProps || [];
}

async function renderHubSpotViews() {
  const main = document.getElementById('main');
  const sel = 'background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none';
  main.innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>🔭 HS Views</h2><p>Filter companies from HubSpot and add to queue</p></div>
    </div>
    <div class="content" style="max-width:960px">
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px">Build a filter</div>
        <div id="hs-filter-rows" style="display:flex;flex-direction:column;gap:8px;margin-bottom:10px">
          <div style="font-size:12px;color:var(--text3)">Loading properties...</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="addHsFilterRow()">+ Add filter</button>
          <button class="btn btn-primary" onclick="runHsFilter()">Search →</button>
          <button class="btn btn-sm" onclick="saveHsFilter()">Save filter</button>
          <span style="font-size:11px;color:var(--text3);margin-left:4px">All filters combined with AND</span>
        </div>
        <div id="hs-saved-filters" style="display:none;margin-top:12px;border-top:1px solid var(--border);padding-top:12px"></div>
        <div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">
          <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Quick views</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            ${['Demo Set','Demo Completed','Contract Sent','Contract Revision'].map(s =>
              `<button class="btn btn-sm" onclick="loadHubSpotByStage('${s}')">${s}</button>`
            ).join('')}
            <button class="btn btn-sm" onclick="loadHsMyCompanies()">My Companies</button>
            <button class="btn btn-sm" onclick="loadHsNeverCalled()">Never Called</button>
          </div>
        </div>
      </div>
      <div id="hs-view-companies">
        <div style="text-align:center;padding:40px 20px;color:var(--text3);font-size:13px">Use the filter builder or a quick view above</div>
      </div>
    </div>`;

  await loadHsProperties();
  document.getElementById('hs-filter-rows').innerHTML = '';
  addHsFilterRow();
  renderSavedFilters();
}

const HS_OPERATORS = {
  text:   [['EQ','is equal to'],['NEQ','is not equal to'],['CONTAINS_TOKEN','contains'],['NOT_CONTAINS_TOKEN',"doesn't contain"],['STARTS_WITH','starts with'],['HAS_PROPERTY','is known'],['NOT_HAS_PROPERTY','is unknown']],
  number: [['EQ','is equal to'],['NEQ','is not equal to'],['GT','is greater than'],['GTE','is greater than or equal to'],['LT','is less than'],['LTE','is less than or equal to'],['HAS_PROPERTY','is known'],['NOT_HAS_PROPERTY','is unknown']],
  enum:   [['EQ','is equal to'],['NEQ','is not equal to'],['IN','is any of'],['NOT_IN','is none of'],['HAS_PROPERTY','is known'],['NOT_HAS_PROPERTY','is unknown']],
  date:   [['EQ','is on'],['GT','is after'],['GTE','is on or after'],['LT','is before'],['LTE','is on or before'],['HAS_PROPERTY','is known'],['NOT_HAS_PROPERTY','is unknown']],
};

function addHsFilterRow() {
  const container = document.getElementById('hs-filter-rows');
  const idx = container.children.length;
  const props = state._hsProps || [];
  const s = 'background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none';
  const div = document.createElement('div');
  div.id = `hs-filter-row-${idx}`;
  div.style.cssText = 'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
  div.innerHTML = `
    <div style="position:relative;flex-shrink:0">
      <input id="hs-fp-search-${idx}" placeholder="Search property..." style="${s};width:200px" oninput="filterHsPropOptions(${idx})" onfocus="document.getElementById('hs-fp-dd-${idx}').style.display='block'" />
      <div id="hs-fp-dd-${idx}" style="display:none;position:absolute;top:100%;left:0;margin-top:2px;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;max-height:200px;overflow-y:auto;z-index:50;min-width:220px;box-shadow:0 4px 12px rgba(0,0,0,.3)">
        ${props.map(p => `<div class="hs-prop-opt" data-idx="${idx}" data-prop="${p.prop}" data-label="${p.label.replace(/"/g,'&quot;')}" onmousedown="event.preventDefault();selectHsProp(${idx},'${p.prop}','${p.label.replace(/'/g,"\\'")}' )" style="padding:7px 12px;cursor:pointer;font-size:13px;color:var(--text)" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">${p.label} <span style="font-size:10px;color:var(--text3)">${p.prop}</span></div>`).join('')}
      </div>
    </div>
    <input id="hs-fp-${idx}" type="hidden" value="" />
    <select id="hs-fo-${idx}" style="${s}">
      ${HS_OPERATORS.text.map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
    </select>
    <div id="hs-fv-wrap-${idx}" style="flex:1;min-width:120px"><input id="hs-fv-${idx}" placeholder="value" style="${s};width:100%" /></div>
    <button onclick="document.getElementById('hs-filter-row-${idx}').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;padding:0 4px;flex-shrink:0">×</button>`;
  container.appendChild(div);
  // Close dropdown on outside click
  document.addEventListener('click', function closeDD(e) {
    const dd = document.getElementById(`hs-fp-dd-${idx}`);
    if (dd && !dd.contains(e.target) && e.target.id !== `hs-fp-search-${idx}`) { dd.style.display = 'none'; }
  }, { once: false, capture: true });
}

function filterHsPropOptions(idx) {
  const q = document.getElementById(`hs-fp-search-${idx}`)?.value.toLowerCase() || '';
  const dd = document.getElementById(`hs-fp-dd-${idx}`);
  if (!dd) return;
  dd.style.display = 'block';
  dd.querySelectorAll('.hs-prop-opt').forEach(el => {
    el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function selectHsProp(idx, prop, label) {
  const hiddenInput = document.getElementById(`hs-fp-${idx}`);
  const searchInput = document.getElementById(`hs-fp-search-${idx}`);
  const dd = document.getElementById(`hs-fp-dd-${idx}`);
  if (hiddenInput) hiddenInput.value = prop;
  if (searchInput) searchInput.value = label;
  if (dd) dd.style.display = 'none';
  updateHsFilterRow(idx);
}

function updateHsFilterRow(idx) {
  const prop = document.getElementById(`hs-fp-${idx}`)?.value;
  const valWrap = document.getElementById(`hs-fv-wrap-${idx}`);
  if (!prop || !valWrap) return;
  const def = (state._hsProps || []).find(p => p.prop === prop);
  const type = def?.type || 'text';
  const s = 'background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 10px;color:var(--text);font-size:13px;outline:none;width:100%';
  // swap operators for the selected property type
  const opSel = document.getElementById(`hs-fo-${idx}`);
  if (opSel) opSel.innerHTML = (HS_OPERATORS[type] || HS_OPERATORS.text).map(([v,l]) => `<option value="${v}">${l}</option>`).join('');
  // swap value input for the selected property type
  if (def?.referencedObjectType === 'OWNER') {
    valWrap.innerHTML = `<select id="hs-fv-${idx}" style="${s}"><option value="${state.ownerId}">Me</option></select>`;
  } else if (type === 'enum' && def.values?.length) {
    valWrap.innerHTML = `<select id="hs-fv-${idx}" style="${s}">${def.values.map(v => `<option value="${v.value}">${v.label}</option>`).join('')}</select>`;
  } else if (type === 'date') {
    valWrap.innerHTML = `<input id="hs-fv-${idx}" type="date" style="${s}" />`;
  } else if (type === 'number') {
    valWrap.innerHTML = `<input id="hs-fv-${idx}" type="number" placeholder="value" style="${s}" />`;
  } else {
    valWrap.innerHTML = `<input id="hs-fv-${idx}" placeholder="value" style="${s}" />`;
  }
}

async function enrichHsResultsWithContactPhones(results) {
  if (!results.length) return;
  try {
    const assocRes = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v4/associations/companies/contacts/batch/read', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ inputs: results.map(r => ({ id: r.id })) }) });
    const assocData = await assocRes.json();
    const contactMap = {};
    if (assocData.results) assocData.results.forEach(r => { if (r.to?.length) contactMap[r.from.id] = String(r.to[0].toObjectId); });
    const contactIds = [...new Set(Object.values(contactMap))];
    if (!contactIds.length) return;
    const phoneMap = {};
    for (let i = 0; i < contactIds.length; i += 100) {
      const chunk = contactIds.slice(i, i + 100);
      const phoneRes = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/contacts/batch/read', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ inputs: chunk.map(id => ({ id })), properties: ['phone', 'mobilephone'] }) });
      const phoneData = await phoneRes.json();
      (phoneData.results || []).forEach(c => { phoneMap[c.id] = c.properties.mobilephone || c.properties.phone || null; });
    }
    results.forEach(r => { const cid = contactMap[r.id]; if (cid && phoneMap[cid]) r.properties.contactPhone = phoneMap[cid]; });
  } catch {}
}

async function _hsSearch(filterGroups, viewName, viewId, loadingMsg) {
  const body = { filterGroups, properties: COMPANY_PROPS, sorts: [{ propertyName: 'lastmodifieddate', direction: 'DESCENDING' }], limit: 200 };
  state._hsSearchBody = body;
  state._hsSearchAfter = null;
  state._hsActiveViewName = viewName;
  state._hsActiveView = viewId;
  const panel = document.getElementById('hs-view-companies');
  panel.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text2);font-size:13px"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>${loadingMsg || 'Loading...'}</div>`;
  try {
    const res = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/companies/search', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify(body) });
    const data = await res.json();
    const results = data.results || [];
    state._hsSearchAfter = data.paging?.next?.after || null;
    renderHubSpotViewCompanies(results, viewName, viewId, false);
    enrichHsResultsWithContactPhones(results).then(() => {
      if (document.getElementById('hs-view-companies')) renderHubSpotViewCompanies(results, viewName, viewId, false);
    }).catch(() => {});
  } catch (e) { panel.innerHTML = `<div style="padding:20px;color:var(--red);font-size:13px">Failed: ${e.message}</div>`; }
}

async function loadMoreHsResults() {
  if (!state._hsSearchBody || !state._hsSearchAfter) return;
  const btn = document.getElementById('hs-load-more');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  try {
    const res = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/companies/search', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ ...state._hsSearchBody, after: state._hsSearchAfter }) });
    const data = await res.json();
    const results = data.results || [];
    state._hsSearchAfter = data.paging?.next?.after || null;
    renderHubSpotViewCompanies(results, state._hsActiveViewName, state._hsActiveView, true);
    enrichHsResultsWithContactPhones(results).then(() => {
      results.forEach(r => {
        if (r.properties?.contactPhone && state._hsViewCompanies) {
          const c = state._hsViewCompanies.find(c => c.id === r.id);
          if (c) c.phone = r.properties.contactPhone;
        }
      });
    }).catch(() => {});
  } catch (e) { if (btn) { btn.disabled = false; btn.textContent = 'Load more'; } }
}

async function runHsFilter() {
  const rows = document.getElementById('hs-filter-rows').children;
  const filters = [];
  for (const row of rows) {
    const idx = row.id.replace('hs-filter-row-', '');
    const prop = document.getElementById(`hs-fp-${idx}`)?.value;
    const op = document.getElementById(`hs-fo-${idx}`)?.value;
    const val = document.getElementById(`hs-fv-${idx}`)?.value;
    if (!prop || !op) continue;
    if (op === 'HAS_PROPERTY' || op === 'NOT_HAS_PROPERTY') {
      filters.push({ propertyName: prop, operator: op });
    } else if (val) {
      filters.push({ propertyName: prop, operator: op, value: val });
    }
  }
  if (!filters.length) { toast('Add at least one filter', 'error'); return; }
  await _hsSearch([{ filters }], 'Filter results', 'custom', 'Searching...');
}

async function loadHsMyCompanies() {
  await _hsSearch([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }] }], 'My Companies', 'myco');
}

async function loadHsNeverCalled() {
  await _hsSearch([{ filters: [{ propertyName: 'hubspot_owner_id', operator: 'EQ', value: state.ownerId }, { propertyName: 'recent_user_to_call', operator: 'NOT_IN', values: [state.ownerId] }] }], 'Never Called', 'never');
}

async function loadHubSpotByStage(stage) {
  await _hsSearch([{ filters: [{ propertyName: 'subscription_status', operator: 'EQ', value: stage }] }], stage, stage, `Loading ${stage}...`);
}

function renderHubSpotViewCompanies(results, viewName, viewId, append) {
  const panel = document.getElementById('hs-view-companies');
  const activeQueue = state.queues.find(q => q.id === state.activeQueueId) || state.queues[0];
  const inQueue = new Set((activeQueue?.companies || []).map(c => c.id));

  const makeCard = r => {
    const p = r.properties || {};
    const id = r.id;
    const name = p.name || '—';
    const phone = p.contactPhone || p.phone || p.contact_phone_number__ || '';
    const city = p.city || ''; const st = p.state || '';
    const stage = p.lifecyclestage || p.hs_lead_status || p.subscription_status || '';
    const already = inQueue.has(id);
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius)">
      <div style="flex:1;min-width:0;cursor:pointer" onclick="openContact('${id}')">
        <div style="font-size:13px;font-weight:600;color:var(--text)">${name}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${[phone, [city,st].filter(Boolean).join(', '), stage].filter(Boolean).join(' · ')}</div>
      </div>
      <button class="btn btn-sm ${already ? '' : 'btn-primary'}" style="flex-shrink:0;font-size:11px${already ? ';color:var(--text3)' : ''}"
        onclick="addHsCompanyToQueue('${id}','${name.replace(/'/g,"\\'")}','${phone.replace(/'/g,"\\'")}',this)" ${already ? 'disabled' : ''}>
        ${already ? '✓ In queue' : '+ Queue'}
      </button>
    </div>`;
  };

  if (append) {
    const list = document.getElementById('hs-view-company-list');
    if (list && results.length) {
      list.insertAdjacentHTML('beforeend', results.map(makeCard).join(''));
      state._hsViewCompanies = [...(state._hsViewCompanies || []), ...results.map(r => ({ id: r.id, name: r.properties?.name || '', phone: r.properties?.contactPhone || r.properties?.phone || r.properties?.contact_phone_number__ || '' }))];
      const countEl = document.getElementById('hs-view-count');
      if (countEl) countEl.textContent = `${state._hsViewCompanies.length} companies`;
    }
    const loadMoreWrap = document.getElementById('hs-load-more-wrap');
    if (loadMoreWrap) loadMoreWrap.style.display = state._hsSearchAfter ? '' : 'none';
    return;
  }

  if (!results.length) { panel.innerHTML = `<div style="padding:20px;color:var(--text3)">No companies found.</div>`; return; }

  state._hsViewCompanies = results.map(r => ({ id: r.id, name: r.properties?.name || '', phone: r.properties?.contactPhone || r.properties?.phone || r.properties?.contact_phone_number__ || '' }));

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
      <div style="font-size:14px;font-weight:600;color:var(--text)">${viewName} <span id="hs-view-count" style="font-size:12px;color:var(--text3);font-weight:400">${results.length} companies</span></div>
      <button class="btn btn-sm btn-primary" onclick="addAllHsViewToQueue()" style="font-size:11px">+ Add all to queue</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px" id="hs-view-company-list">
      ${results.map(makeCard).join('')}
    </div>
    <div id="hs-load-more-wrap" style="text-align:center;padding:14px 0;${state._hsSearchAfter ? '' : 'display:none'}">
      <button id="hs-load-more" class="btn btn-sm" onclick="loadMoreHsResults()">Load more</button>
    </div>`;
}

function addHsCompanyToQueue(id, name, phone, btn) {
  const activeQueue = state.queues.find(q => q.id === state.activeQueueId) || state.queues[0];
  if (!activeQueue) { toast('No active queue', 'error'); return; }
  if (activeQueue.companies.find(c => c.id === id)) return;
  activeQueue.companies.push({ id, name, phone });
  fetch('/api/users?action=reorderqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId: activeQueue.id, companies: activeQueue.companies }) }).catch(() => {});
  if (btn) { btn.textContent = '✓ In queue'; btn.disabled = true; btn.className = 'btn btn-sm'; btn.style.color = 'var(--text3)'; }
  const badge = document.getElementById('badge-queue');
  if (badge) badge.textContent = state.queues.reduce((s, q) => s + q.companies.length, 0);
  toast(`${name} added to queue ✓`, 'success');
}

async function addAllHsViewToQueue() {
  const companies = state._hsViewCompanies || [];
  const activeQueue = state.queues.find(q => q.id === state.activeQueueId) || state.queues[0];
  if (!activeQueue) { toast('No active queue', 'error'); return; }
  const existing = new Set(activeQueue.companies.map(c => c.id));
  let added = 0;
  companies.forEach(c => { if (!existing.has(c.id)) { activeQueue.companies.push(c); added++; } });
  if (added) {
    await fetch('/api/users?action=reorderqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId: activeQueue.id, companies: activeQueue.companies }) }).catch(() => {});
    const badge = document.getElementById('badge-queue');
    if (badge) badge.textContent = state.queues.reduce((s, q) => s + q.companies.length, 0);
    toast(`${added} companies added to queue ✓`, 'success');
    renderHubSpotViewCompanies(state._hsViewCompanies.map(c => ({ id: c.id, properties: { name: c.name, phone: c.phone } })), state._hsActiveViewName || state._hsActiveView, state._hsActiveView, false);
  } else {
    toast('All already in queue', 'success');
  }
}

function saveHsFilter() {
  const name = prompt('Name this filter:');
  if (!name?.trim()) return;
  const rows = document.getElementById('hs-filter-rows')?.children || [];
  const filters = [];
  for (const row of rows) {
    const idx = row.id.replace('hs-filter-row-', '');
    const prop = document.getElementById(`hs-fp-${idx}`)?.value;
    const propLabel = document.getElementById(`hs-fp-search-${idx}`)?.value;
    const op = document.getElementById(`hs-fo-${idx}`)?.value;
    const val = document.getElementById(`hs-fv-${idx}`)?.value || '';
    if (prop && op) filters.push({ prop, propLabel, op, val });
  }
  if (!filters.length) { toast('Add at least one filter first', 'error'); return; }
  const saved = JSON.parse(localStorage.getItem('hs_saved_filters') || '[]');
  saved.push({ name: name.trim(), filters });
  localStorage.setItem('hs_saved_filters', JSON.stringify(saved));
  renderSavedFilters();
  toast(`"${name.trim()}" saved`, 'success');
}

function deleteSavedHsFilter(idx) {
  const saved = JSON.parse(localStorage.getItem('hs_saved_filters') || '[]');
  saved.splice(idx, 1);
  localStorage.setItem('hs_saved_filters', JSON.stringify(saved));
  renderSavedFilters();
}

function loadSavedHsFilter(idx) {
  const saved = JSON.parse(localStorage.getItem('hs_saved_filters') || '[]');
  const f = saved[idx];
  if (!f) return;
  const container = document.getElementById('hs-filter-rows');
  if (!container) return;
  container.innerHTML = '';
  f.filters.forEach((filter, i) => {
    addHsFilterRow();
    const fp = document.getElementById(`hs-fp-${i}`);
    const fpSearch = document.getElementById(`hs-fp-search-${i}`);
    if (fp) fp.value = filter.prop;
    if (fpSearch) fpSearch.value = filter.propLabel;
    updateHsFilterRow(i);
    const fo = document.getElementById(`hs-fo-${i}`);
    if (fo) fo.value = filter.op;
    const fv = document.getElementById(`hs-fv-${i}`);
    if (fv) fv.value = filter.val;
  });
}

function renderSavedFilters() {
  const container = document.getElementById('hs-saved-filters');
  if (!container) return;
  const saved = JSON.parse(localStorage.getItem('hs_saved_filters') || '[]');
  if (!saved.length) { container.style.display = 'none'; return; }
  container.style.display = '';
  container.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Saved filters</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px">
      ${saved.map((f, i) => `
        <div style="display:flex;align-items:center;gap:2px">
          <button class="btn btn-sm" onclick="loadSavedHsFilter(${i})">${f.name}</button>
          <button onmousedown="event.preventDefault();deleteSavedHsFilter(${i})" style="background:none;border:none;color:var(--text3);cursor:pointer;padding:0 3px;font-size:16px;line-height:1" title="Delete">×</button>
        </div>`).join('')}
    </div>`;
}

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
  hot_lead:       { label: 'Hot Lead',       color: '#f05252', bg: 'rgba(240,82,82,.15)' },
  following_up:   { label: 'Following Up',   color: '#f5a623', bg: 'rgba(245,166,35,.15)' },
  contacted:      { label: 'Contacted',      color: '#4f8ef7', bg: 'rgba(79,142,247,.15)' },
  proposal_sent:  { label: 'Proposal Sent',  color: '#a78bfa', bg: 'rgba(167,139,250,.15)' },
  closed:         { label: 'Closed',         color: '#3ecf8e', bg: 'rgba(62,207,142,.15)' },
};

async function renderPipeline() {
  const main = document.getElementById('main');
  const STATUSES = getPipelineStatuses();
  const stageOrder = Object.keys(STATUSES);
  let items = [...state.pipeline];
  if (state.pipelineSortByStage) {
    items.sort((a, b) => {
      const ai = stageOrder.indexOf(a.status ?? ''), bi = stageOrder.indexOf(b.status ?? '');
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }
  main.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <h2>📌 Pipeline</h2>
        <p>${state.pipeline.length} companies being tracked</p>
      </div>
      <div class="topbar-right" style="display:flex;gap:8px">
        <button class="btn btn-sm ${state.pipelineSortByStage ? 'btn-primary' : ''}" onclick="state.pipelineSortByStage=!state.pipelineSortByStage;renderPipeline()">Sort by Stage</button>
        <button class="btn btn-sm" onclick="openPipelineLabelEditor()">✏️ Edit Stages</button>
      </div>
    </div>
    <div class="content">
      ${items.length === 0
        ? `<div class="empty-state" style="text-align:center;padding:60px 20px;color:var(--text2)">
            <div style="font-size:40px;margin-bottom:12px">📌</div>
            <div style="font-size:15px;font-weight:600;margin-bottom:6px">No companies in pipeline</div>
            <div style="font-size:13px">Open any company and click "Add to Pipeline" to start tracking it.</div>
           </div>`
        : `<div class="lead-list">
            ${items.map(p => {
              const s = STATUSES[p.status] || STATUSES.following_up || Object.values(STATUSES)[0];
              const daysIn = Math.floor((Date.now() - new Date(p.addedAt)) / 86400000);
              const contact = state.contacts.find(c => c.id === p.companyId);
              const hsUrl = `https://app.hubspot.com/contacts/45530742/company/${p.companyId}`;
              return `<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${s.color};border-radius:var(--radius)">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span style="cursor:pointer;text-decoration:underline;text-underline-offset:3px" onclick="openContact('${p.companyId}')">${p.companyName}</span>
                    <a href="${hsUrl}" target="_blank" style="font-size:10px;color:var(--text3);text-decoration:none;border:1px solid var(--border2);padding:1px 6px;border-radius:4px">HS ↗</a>
                  </div>
                  <div style="font-size:11px;color:var(--text2);margin-top:3px">${daysIn === 0 ? 'Added today' : `${daysIn} day${daysIn === 1 ? '' : 's'} in pipeline`}${contact ? ` · Last contact: ${contact.lastContacted}` : ''}</div>
                </div>
                <select onchange="updatePipelineStatus('${p.companyId}', this.value)" style="font-size:11px;font-weight:600;padding:4px 8px;border-radius:6px;border:1px solid var(--border);background:${s.bg};color:${s.color};cursor:pointer">
                  ${Object.entries(STATUSES).map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v.label}</option>`).join('')}
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
      <div style="display:grid;grid-template-columns:16px 48px minmax(0,1fr) 140px 140px 160px 160px 36px;gap:10px;padding:6px 14px;border-bottom:1px solid var(--border);margin-bottom:4px">
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

    return `<div style="display:grid;grid-template-columns:16px 48px minmax(0,1fr) 180px 180px 160px 36px;align-items:center;gap:10px;padding:8px 14px;background:var(--bg2);border:1px solid var(--border);border-left:3px solid ${isSkipped ? 'var(--text3)' : inQueue ? 'var(--purple)' : (() => {
          if (viewKey !== 'roerisklist') return 'var(--blue)';
          const now = Date.now();
          const lastCall = p.hs_last_logged_call_date ? new Date(p.hs_last_logged_call_date).getTime() : null;
          return lastCall && (now - lastCall) > 14*86400000 ? 'var(--red)' : 'var(--amber)';
        })()};border-radius:var(--radius);opacity:${isSkipped ? '0.5' : '1'}" id="prow-${raw.id}">
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
      <div style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
        ${viewKey === 'roerisklist' ? (() => {
          const now = Date.now();
          const lastCall = p.hs_last_logged_call_date ? new Date(p.hs_last_logged_call_date).getTime() : null;
          const assigned = p.hubspot_owner_assigneddate ? new Date(p.hubspot_owner_assigneddate).getTime() : null;
          if (lastCall && (now - lastCall) > 14*86400000) {
            const d = Math.floor((now-lastCall)/86400000);
            return `<span style="background:rgba(240,82,82,.15);color:var(--red);padding:2px 6px;border-radius:4px">No call ${d}d</span>`;
          }
          if (assigned) {
            const d = Math.floor((now-assigned)/86400000);
            return `<span style="background:rgba(245,166,35,.15);color:var(--amber);padding:2px 6px;border-radius:4px">Assigned ${d}d ago</span>`;
          }
          return '';
        })() : ''}
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
  const fmt = n => n < 0.01 ? `<$0.01` : `$${n.toFixed(2)}`;
  const fmtTokens = n => n >= 1_000_000 ? `${(n/1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n/1000).toFixed(1)}k` : `${n}`;
  const fmtMin = s => s < 60 ? `${s}s` : `${Math.floor(s/60)}m ${s%60}s`;
  const totals = rows.reduce((a, r) => ({
    calls: a.calls + r.calls,
    ai_queries: a.ai_queries + r.ai_queries,
    claude_input: a.claude_input + r.claude_input,
    claude_output: a.claude_output + r.claude_output,
    claude_cost: a.claude_cost + r.claude_cost,
  }), { calls: 0, ai_queries: 0, claude_input: 0, claude_output: 0, claude_cost: 0 });
  el.innerHTML = `
    <div style="font-size:11px;color:var(--text3);margin-bottom:8px">Transcription via Whisper (flat-rate VPS). AI via Claude Haiku ($0.80/$4.00 per 1M tokens).</div>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead>
        <tr style="color:var(--text3);text-align:left;border-bottom:1px solid var(--border)">
          <th style="padding:6px 8px">Rep</th>
          <th style="padding:6px 8px;text-align:center">Calls Transcribed</th>
          <th style="padding:6px 8px;text-align:center">AI Queries</th>
          <th style="padding:6px 8px;text-align:right">Whisper Audio</th>
          <th style="padding:6px 8px;text-align:right">Claude Tokens</th>
          <th style="padding:6px 8px;text-align:right">Claude Cost</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r => `
          <tr style="border-bottom:1px solid var(--border)">
            <td style="padding:8px"><div style="font-weight:500;color:var(--text)">${r.name}</div><div style="color:var(--text3);font-size:11px">${r.email}</div></td>
            <td style="padding:8px;text-align:center;color:var(--text2)">${r.calls}</td>
            <td style="padding:8px;text-align:center;color:var(--text2)">${r.ai_queries}</td>
            <td style="padding:8px;text-align:right;color:var(--text2)">${fmtMin(r.whisper_seconds)}</td>
            <td style="padding:8px;text-align:right;color:var(--text2)">${fmtTokens(r.claude_input + r.claude_output)}</td>
            <td style="padding:8px;text-align:right;font-weight:600;color:var(--text)">${fmt(r.claude_cost)}</td>
          </tr>`).join('')}
        <tr style="border-top:2px solid var(--border)">
          <td style="padding:8px;font-weight:600;color:var(--text)">Total</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:var(--text)">${totals.calls}</td>
          <td style="padding:8px;text-align:center;font-weight:600;color:var(--text)">${totals.ai_queries}</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:var(--text)">—</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:var(--text)">${fmtTokens(totals.claude_input + totals.claude_output)}</td>
          <td style="padding:8px;text-align:right;font-weight:600;color:var(--green)">${fmt(totals.claude_cost)}</td>
        </tr>
      </tbody>
    </table>`;
}

async function renderAdmin() {
  showView('settings'); return;
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
          <div class="section-title">Usage & API Cost</div>
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
  if (!state.notes) state.notes = {};
  try {
    const nr = await fetch(`/api/users?action=getnotes&companyId=${id}`, { headers: { Authorization: `Bearer ${state.token}` } });
    if (nr.ok) {
      const { notes: kv } = await nr.json();
      const sess = state.notes[id] || [];
      const seen = new Set(sess.map(n => n.date + n.text));
      state.notes[id] = [...sess, ...kv.filter(n => !seen.has(n.date + n.text))];
    }
  } catch {}
  if (!state.notes) state.notes = {};
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
    <button class="btn btn-sm" onclick="openEmailCompose('${id}')">✉️ Send email</button>
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
    toast('Note saved ✓', 'success');
  } catch { toast('Saved locally', 'error'); }
  fetch('/api/users?action=savenote', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ companyId: contactId, text, date: new Date().toLocaleString() }) }).catch(() => {});
  if (!state.notes) state.notes = {};
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
  await Promise.all([loadContacts(), loadQueue(), loadPipeline(), loadCalendarEvents(), loadCalendarPrefs(), loadPipelineLabels(), loadDemoTags(), loadOrgSettings()]);
  if (state.currentView === 'dashboard') showView('dashboard');
  loadDailyBriefing();
  startAutoRefresh();
}

async function loadDailyBriefing() {
  if (state.dailyBriefingLoaded || !state.contacts.length) return;
  state.dailyBriefingLoaded = true;

  const pipelineIds = new Set(state.pipeline.map(p => p.companyId));
  const noScheduled = c => !c.hasFutureActivityDate;

  const followUps     = state.contacts.filter(c => c.isFollowUp && noScheduled(c));
  const pipelineOverdue = state.contacts.filter(c => pipelineIds.has(c.id) && !c.isFollowUp && noScheduled(c));
  const roeRisk       = state.contacts.filter(c => c.isRoeRisk && !c.isFollowUp && !pipelineIds.has(c.id) && noScheduled(c));
  const neverCalled   = state.contacts.filter(c => c.isNeverCalledByMe && !c.isDnr && !c.isFollowUp && noScheduled(c));
  const dnrStale      = state.contacts.filter(c => c.isDnr && c.daysSince > 30 && noScheduled(c));

  function fmtBucket(label, companies, max = 5) {
    if (!companies.length) return '';
    const items = companies.slice(0, max).map(c =>
      `  - ${c.name} (${c.daysSince === 999 ? 'never contacted' : c.daysSince + 'd since last contact'}, stage: ${c.masterStage || c.stage})`
    ).join('\n');
    return `${label} (${companies.length} total):\n${items}`;
  }

  const companyContext = [
    fmtBucket('1. FOLLOW-UPS — active deals needing attention', followUps),
    fmtBucket('2. PIPELINE — overdue check-in, no upcoming activity scheduled', pipelineOverdue),
    fmtBucket('3. ROE RISK — 14+ days without contact', roeRisk),
    fmtBucket('4. NEVER CALLED BY ME', neverCalled),
    fmtBucket('5. DO NOT RECIRCULATE — stale (30+ days no contact)', dnrStale),
  ].filter(Boolean).join('\n\n');

  let calendarContext = '';
  try {
    const _cn = new Date(), _cs = new Date(_cn), _ce = new Date(_cn);
    _cs.setHours(0,0,0,0); _ce.setHours(23,59,59,999);
    const calRes = await fetch(`/api/calendar?${new URLSearchParams({ action:'events', timeMin:_cs.toISOString(), timeMax:_ce.toISOString() })}`, { headers: { Authorization: `Bearer ${state.token}` } });
    const calData = await calRes.json();
    if (calData.events?.length) {
      const eventList = calData.events.map(e => {
        const start = e.start?.dateTime
          ? new Date(e.start.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : 'All day';
        const end = e.end?.dateTime
          ? new Date(e.end.dateTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
          : '';
        return `  - ${e.summary || 'Busy'}: ${start}${end ? '–' + end : ''}`;
      }).join('\n');
      calendarContext = `\n\nToday's calendar:\n${eventList}`;
    } else {
      calendarContext = '\n\nCalendar: No events scheduled today.';
    }
  } catch {}

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const prompt = `Write a morning briefing for ${state.user?.name || 'me'}. Today is ${today}.\n\nCompanies to prioritize today:\n${companyContext || 'No flagged companies at the moment.'}${calendarContext}\n\nPlease:\n1. Name the 3–5 most important companies to call today and briefly explain why each is a priority (1 sentence each), in priority order.\n2. Summarize today's calendar in 1–2 sentences.\n3. Suggest 1–2 specific call blocks based on open time today.\n\nBe friendly and direct. Write in complete sentences.`;

  try {
    const res = await fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({
        system: 'You are a concise, actionable sales assistant for an SEO agency. Help the rep prioritize their day.',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 2000,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `AI error: ${res.status}`);
    state.dailyBriefing = data.content?.[0]?.text || 'Briefing unavailable.';
  } catch(e) {
    state.dailyBriefing = `AI briefing unavailable: ${e.message}`;
  }

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
  let _calTick = 0;
  refreshInterval = setInterval(async () => {
    await loadContacts();
    _calTick++;
    if (_calTick % 5 === 0) await loadCalendarEvents();
    else renderDemoBanner();
    if (state.currentView === 'dashboard') showView('dashboard');
    updateBadges();
  }, 300000);
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

  document.getElementById('modal-title').innerHTML = `🎙️ Log Call — ${c.name}`;
  document.getElementById('modal-body').innerHTML = `<div id="call-logger-content"></div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancel</button>`;
  document.getElementById('modal').style.display = 'flex';

  // Default: show HubSpot call picker
  await showHubSpotCallPicker(companyId);
}

async function showHubSpotCallPicker(companyId) {
  const content = document.getElementById('call-logger-content');
  if (!content) return;
  content.innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text2);font-size:13px;justify-content:center"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Fetching calls from HubSpot...</div>`;

  try {
    // Step 1: get call IDs via direct company assoc + via contacts (in parallel)
    const [directRes, contactsRes] = await Promise.all([
      fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${companyId}/associations/calls`, Authorization: `Bearer ${state.token}` } }).then(r => r.json()),
      fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${companyId}/associations/contacts`, Authorization: `Bearer ${state.token}` } }).then(r => r.json()),
    ]);
    console.log('[calls] direct:', directRes, 'contacts:', contactsRes);

    const directCallIds = (directRes.results || []).map(a => a.id);
    const contactIds = (contactsRes.results || []).map(a => a.id).slice(0, 8);

    let contactCallIds = [];
    if (contactIds.length) {
      const perContact = await Promise.all(
        contactIds.map(cid =>
          fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/contacts/${cid}/associations/calls`, Authorization: `Bearer ${state.token}` } })
            .then(r => r.json()).then(d => (d.results || []).map(a => a.id))
        )
      );
      contactCallIds = perContact.flat();
    }

    const allCallIds = [...new Set([...directCallIds, ...contactCallIds])];
    console.log('[calls] all IDs:', allCallIds);

    if (!allCallIds.length) {
      content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text2)">
        <div style="font-size:13px;margin-bottom:12px">No calls found in HubSpot for this company.</div>
        <button class="btn btn-primary" onclick="showUploadInterface('${companyId}')">📁 Upload recording instead</button>
      </div>`;
      return;
    }

    // Step 2: batch-read properties for those calls (cap at 25 most recent)
    const batchRes = await fetch('/api/hubspot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/calls/batch/read', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ inputs: allCallIds.slice(0, 25).map(id => ({ id })), properties: ['hs_call_recording_url','hs_timestamp','hs_call_duration','hs_call_status','hs_call_disposition','hs_call_direction','hs_call_body'] }),
    });
    const batchData = await batchRes.json();
    console.log('[calls] batch results:', batchData.results?.map(c => ({ id: c.id, recording: !!c.properties.hs_call_recording_url, status: c.properties.hs_call_status })));
    const calls = (batchData.results || [])
      .filter(c => c.properties.hs_call_recording_url)
      .sort((a, b) => new Date(b.properties.hs_timestamp) - new Date(a.properties.hs_timestamp));

    const DISPOSITION_ICONS = { 'Connected':'🟢','Left live message':'💬','Left voicemail':'📬','No answer':'📵','Busy':'🔴','Wrong number':'❌' };
    const DISPOSITIONS = { '17b47fee-58de-441e-a44c-c6300d46f273':'Connected','73a0d17f-1163-4015-bdd5-ec830791da20':'Left live message','a4c4c377-d246-4b32-a13b-75a56a4cd0ff':'Left voicemail','f240bbac-87c9-4f6e-bf70-924b57d47db7':'No answer','9d9162e7-6cf3-4944-bf63-4dff82258764':'Busy','b2cf5968-551e-4856-9783-52b3da59a7d0':'Wrong number' };

    if (!calls.length) {
      content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text2)">
        <div style="font-size:13px;margin-bottom:12px">No recorded calls found in HubSpot for this company.</div>
        <button class="btn btn-primary" onclick="showUploadInterface('${companyId}')">📁 Upload recording instead</button>
      </div>`;
      return;
    }

    const rows = calls.map((call, i) => {
      const p = call.properties;
      const date = p.hs_timestamp ? new Date(p.hs_timestamp).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' }) : 'Unknown date';
      const secs = p.hs_call_duration ? Math.round(parseInt(p.hs_call_duration)/1000) : null;
      const dur = secs ? (secs >= 60 ? `${Math.floor(secs/60)}m ${secs%60}s` : `${secs}s`) : '';
      const disp = DISPOSITIONS[p.hs_call_disposition] || p.hs_call_disposition || '';
      const dispIcon = DISPOSITION_ICONS[disp] || '';
      return `<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border-radius:6px;border:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${date}</div>
          <div style="font-size:12px;color:var(--text2);margin-top:3px;display:flex;gap:8px">
            ${dispIcon && disp ? `<span>${dispIcon} ${disp}</span>` : ''}
            ${dur ? `<span style="color:var(--text3)">⏱ ${dur}</span>` : ''}
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="selectHubSpotCall('${companyId}',${i})">Select</button>
      </div>`;
    }).join('');

    state._hubspotCalls = calls;
    content.innerHTML = `<div>
      <div style="font-size:12px;color:var(--text3);margin-bottom:10px">${calls.length} recorded call${calls.length !== 1 ? 's' : ''} found</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">${rows}</div>
      <div style="border-top:1px solid var(--border);padding-top:12px">
        <button class="btn" style="width:100%;justify-content:center;font-size:12px" onclick="showUploadInterface('${companyId}')">📁 Upload recording instead</button>
      </div>
    </div>`;
  } catch (e) {
    content.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text2)">
      <div style="font-size:13px;margin-bottom:12px">Could not load HubSpot calls: ${e.message}</div>
      <button class="btn btn-primary" onclick="showUploadInterface('${companyId}')">📁 Upload recording instead</button>
    </div>`;
  }
}

function selectHubSpotCall(companyId, idx) {
  state._selectedHsCallIdx = idx;
  showCallTypeSelector(companyId, 'hubspot');
}

function showUploadInterface(companyId) {
  state._selectedHsCallIdx = null;
  showCallTypeSelector(companyId, 'upload');
}

function showCallTypeSelector(companyId, source) {
  const content = document.getElementById('call-logger-content');
  if (!content) return;
  const sourceLabel = source === 'hubspot' ? '🔗 HubSpot call selected' : '📁 Upload recording';
  content.innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
    <div style="padding:8px 10px;background:var(--bg3);border-radius:6px;font-size:12px;color:var(--text2)">${sourceLabel}</div>
    <div>
      <div class="field-label" style="margin-bottom:8px">Note type</div>
      <div style="display:flex;flex-direction:column;gap:6px" id="call-type-selector">
        ${[
          { key: 'general', icon: '📝', label: 'General Notes', desc: 'Summary, call notes, follow-up scheduling' },
          { key: 'sales', icon: '📊', label: 'Sales Notes', desc: 'Goals, pain points, current provider, primary services' },
          { key: 'demo', icon: '🎯', label: 'Set Call Notes', desc: 'Current marketing, pain points, objections, decision maker' },
          { key: 'coaching', icon: '🏆', label: 'Coaching Notes', desc: 'Full scorecard across 12 areas' },
        ].map(t => `<div class="call-type-option" data-type="${t.key}" onclick="selectCallType('${t.key}')" style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--bg3);border:2px solid var(--border);border-radius:var(--radius);cursor:pointer">
          <div style="font-size:20px;flex-shrink:0">${t.icon}</div>
          <div><div style="font-size:13px;font-weight:600;color:var(--text)">${t.label}</div><div style="font-size:11px;color:var(--text2);margin-top:1px">${t.desc}</div></div>
        </div>`).join('')}
      </div>
    </div>
    ${source === 'upload' ? `<div id="upload-trigger-area"></div>` : ''}
  </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="showHubSpotCallPicker('${companyId}')">← Back</button>
    <button class="btn btn-primary btn-sm" id="start-transcription-btn" disabled onclick="startTranscription('${companyId}','${source}')">Start →</button>`;
}

function startTranscription(companyId, source) {
  if (source === 'upload') {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'audio/*,.mp3,.mp4,.m4a,.wav,.webm';
    input.onchange = async () => {
      if (input.files[0]) await processCallRecordingWithFile(companyId, input.files[0], null);
    };
    input.click();
  } else if (source === 'hubspot') {
    const call = state._hubspotCalls?.[state._selectedHsCallIdx];
    if (call) useHubSpotRecording(companyId, encodeURIComponent(call.properties.hs_call_recording_url));
  }
}


function toggleCoaching() {
  state.coachingEnabled = !state.coachingEnabled;
  const toggle = document.getElementById('coaching-toggle');
  const knob = document.getElementById('coaching-toggle-knob');
  if (toggle) toggle.style.background = state.coachingEnabled ? 'var(--amber)' : 'var(--bg3)';
  if (knob) {
    knob.style.left = state.coachingEnabled ? '20px' : '2px';
    knob.style.background = state.coachingEnabled ? '#fff' : 'var(--text3)';
  }
}

function selectCallType(type) {
  state.selectedCallType = type;
  state._selectedCallType = type;
  document.querySelectorAll('.call-type-option').forEach(el => {
    const isSelected = el.dataset.type === type;
    el.style.borderColor = isSelected ? 'var(--blue)' : 'var(--border)';
    el.style.background = isSelected ? 'var(--blue-dim)' : 'var(--bg3)';
  });
  const btn = document.getElementById('start-transcription-btn');
  if (btn) btn.disabled = false;
  const uploadSec = document.getElementById('upload-section');
  if (uploadSec) uploadSec.style.display = 'block';
  const label = document.getElementById('selected-type-label');
  if (label) label.textContent = { general:'📝 General Notes', sales:'📊 Sales Notes', demo:'🎯 Set Call Notes', coaching:'🏆 Coaching Notes' }[type] || '';
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
      body: JSON.stringify({ transcript, companyName: c.name, callType: state.selectedCallType || 'general', includeCoaching: state.coachingEnabled || false }),
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
  // Store transcript + analysis for email template use
  state.lastCallContext = `TRANSCRIPT:\n${transcript}\n\nANALYSIS SUMMARY:\n${analysis.summary || ''}\nInterested: ${analysis.interested}\nSentiment: ${analysis.sentiment || ''}${analysis.followUpCommitment ? '\nFollow-up: ' + analysis.followUpCommitment : ''}`;
  state.lastCallCompanyId = companyId;
  state.lastCallDate = new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
  // Auto-save to KV so it persists across sessions
  fetch('/api/users?action=savenote', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ companyId, text: state.lastCallContext, date: new Date().toLocaleString(), type: 'call_transcript' }) }).catch(() => {});
  if (!state.notes) state.notes = {};
  if (!state.notes[companyId]) state.notes[companyId] = [];
  if (!state.notes[companyId].find(n => n.type === 'call_transcript' && n.date === new Date().toLocaleString()))
    state.notes[companyId].unshift({ text: state.lastCallContext, date: new Date().toLocaleString(), type: 'call_transcript' });

  const c = state.contacts.find(x => x.id === companyId);
  const followUpDate = analysis.followUpDate ? new Date(analysis.followUpDate) : null;
  const followUpDateStr = followUpDate ? followUpDate.toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : null;
  const type = state.selectedCallType || 'general';

  const followUpBlock = `
    ${analysis.followUpCommitment ? `
    <div style="background:var(--blue-dim);border:1px solid rgba(79,142,247,.2);border-radius:var(--radius-sm);padding:12px">
      <div class="field-label" style="margin-bottom:6px;color:var(--blue)">📅 Follow-up Detected</div>
      <div style="font-size:13px;color:var(--text);margin-bottom:8px">"${analysis.followUpCommitment}"</div>
      ${followUpDateStr ? `<div style="font-size:12px;color:var(--text2);margin-bottom:10px">Suggested date: <strong style="color:var(--text)">${followUpDateStr}</strong></div>` : ''}
      <input type="datetime-local" id="followup-datetime"
        value="${analysis.followUpDate ? analysis.followUpDate.slice(0,16) : ''}"
        style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none;margin-bottom:8px;width:100%" />
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="createCalendarEvent('${companyId}')">📅 Google Calendar</button>
        <button class="btn btn-sm" style="flex:1;justify-content:center" onclick="createHubSpotTask('${companyId}')">✅ HubSpot Task</button>
      </div>
    </div>` : `
    <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:12px">
      <div class="field-label" style="margin-bottom:6px">📅 Schedule Follow-up</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:8px">No follow-up commitment detected — set one manually:</div>
      <input type="datetime-local" id="followup-datetime"
        style="background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:6px 10px;color:var(--text);font-size:12px;outline:none;margin-bottom:8px;width:100%" />
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="createCalendarEvent('${companyId}')">📅 Google Calendar</button>
        <button class="btn btn-sm" style="flex:1;justify-content:center" onclick="createHubSpotTask('${companyId}')">✅ HubSpot Task</button>
      </div>
    </div>`}`;

  const saveBar = `
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1;justify-content:center" onclick="saveCallNotes('${companyId}')">💾 Save to HubSpot</button>
      <button class="btn" style="flex:1;justify-content:center" onclick="showTranscript(\`${transcript.replace(/`/g, '\\`').replace(/\$/g, '\\$').slice(0, 5000)}\`)">📄 Transcript</button>
    </div>`;

  let typeBlock = '';

  if (type === 'sales') {
    const sn = analysis.salesNotes || {};
    typeBlock = `
      <div style="background:linear-gradient(135deg,rgba(167,139,250,.08),rgba(79,142,247,.06));border:1px solid rgba(167,139,250,.2);border-radius:var(--radius);padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--purple);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">📊 Sales Notes</div>
        ${[
          { id: 'sn-goals', label: "Customer's Goals with Olly Olly", val: sn.customerGoals },
          { id: 'sn-pain', label: 'Pain Points', val: sn.painPoints },
          { id: 'sn-company', label: 'Currently with Another Company?', val: sn.currentCompany },
          { id: 'sn-services', label: 'Primary Services / What They Want to Showcase', val: sn.primaryServices },
        ].map(f => `
          <div style="margin-bottom:10px">
            <div class="field-label" style="margin-bottom:4px;color:var(--text2)">${f.label}</div>
            <textarea id="${f.id}" style="width:100%;min-height:60px;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12px;outline:none;font-family:inherit;resize:vertical">${f.val || ''}</textarea>
          </div>`).join('')}
        <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center" onclick="saveSalesNotes('${companyId}')">💾 Save Sales Notes to HubSpot</button>
        <div id="sn-save-msg" style="font-size:11px;color:var(--green);margin-top:6px;text-align:center"></div>
      </div>`;
  }

  if (type === 'demo') {
    const dn = analysis.demoNotes || {};
    typeBlock = `
      <div style="background:linear-gradient(135deg,rgba(62,207,142,.06),rgba(79,142,247,.06));border:1px solid rgba(62,207,142,.2);border-radius:var(--radius);padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--green);text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px">🎯 Set Call Notes</div>
        ${[
          { id: 'dn-marketing', label: 'Current Marketing / Initial Pain', val: dn.currentMarketing },
          { id: 'dn-goals', label: 'Goals for Business (job gap, revenue gap, etc)', val: dn.businessGoals },
          { id: 'dn-history', label: 'Marketing History & Pain Points', val: dn.marketingHistory },
          { id: 'dn-objections', label: 'Anticipated Objections', val: dn.anticipatedObjections },
          { id: 'dn-pain', label: 'Biggest Pain Points', val: dn.biggestPainPoints },
          { id: 'dn-dm', label: 'Sole Decision Maker?', val: dn.soleDecisionMaker },
        ].map(f => `
          <div style="margin-bottom:10px">
            <div class="field-label" style="margin-bottom:4px;color:var(--text2)">${f.label}</div>
            <textarea id="${f.id}" style="width:100%;min-height:55px;background:var(--bg2);border:1px solid var(--border2);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12px;outline:none;font-family:inherit;resize:vertical">${f.val || ''}</textarea>
          </div>`).join('')}
        <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center" onclick="saveDemoNotes('${companyId}')">💾 Save Demo Notes to HubSpot</button>
        <div id="dn-save-msg" style="font-size:11px;color:var(--green);margin-top:6px;text-align:center"></div>
      </div>`;
  }

  if (state.coachingEnabled) {
    const cn = analysis.coachingNotes || {};
    const areas = [
      { key: 'intro', label: 'Intro', q: 'Did the rep confidently introduce themself and use the DM\'s name?' },
      { key: 'elevatorPitch', label: 'Elevator Pitch', q: 'Did the rep ask probing questions and actively listen?' },
      { key: 'otf', label: 'Shoot for the OTF', q: 'Did the rep confidently assume time and avoid unnecessary objections?' },
      { key: 'settingDemo', label: 'Setting the Demo', q: 'Did the rep ask questions to uncover the DM\'s needs?' },
      { key: 'website', label: 'Website Situation', q: 'Did the rep address website-related pain points?' },
      { key: 'confirmingDMs', label: 'Confirming DMs', q: 'Did the rep confirm all decision-makers?' },
      { key: 'recap', label: 'Research & Recap', q: 'Did the rep recap key points and confirm the time?' },
      { key: 'pace', label: 'Pace', q: 'Did the rep maintain an even, professional pace?' },
      { key: 'tonality', label: 'Tonality', q: 'Did the rep sound confident, professional, and enthusiastic?' },
      { key: 'listening', label: 'Active Listening', q: 'Did the rep actively listen and respond to the DM\'s answers?' },
      { key: 'communication', label: 'Communication', q: 'Did the rep avoid verbal crutches and communicate clearly?' },
      { key: 'tailoredPitch', label: 'Tailored Pitch', q: 'Did the rep tailor the pitch to the DM\'s unique situation?' },
    ];
    typeBlock += `
      <div style="background:linear-gradient(135deg,rgba(245,166,35,.06),rgba(240,82,82,.04));border:1px solid rgba(245,166,35,.2);border-radius:var(--radius);padding:14px">
        <div style="font-size:12px;font-weight:700;color:var(--amber);text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">🏆 Coaching Scorecard</div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:14px">Score each area 1–5. AI pre-fills based on the transcript — edit as needed.</div>
        ${areas.map(a => `
          <div style="margin-bottom:12px;padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm)">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
              <div style="font-size:12px;font-weight:600;color:var(--text)">${a.label}</div>
              <div style="display:flex;gap:4px">
                ${[1,2,3,4,5].map(n => `
                  <button onclick="setScore('${a.key}',${n})" id="score-${a.key}-${n}"
                    style="width:28px;height:28px;border-radius:50%;border:1px solid var(--border2);background:${(cn[a.key]?.score === n) ? 'var(--amber)' : 'var(--bg3)'};color:${(cn[a.key]?.score === n) ? '#fff' : 'var(--text2)'};font-size:11px;font-weight:700;cursor:pointer">
                    ${n}
                  </button>`).join('')}
              </div>
            </div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:6px">${a.q}</div>
            <textarea id="coaching-${a.key}" style="width:100%;min-height:50px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;color:var(--text);font-size:11px;outline:none;font-family:inherit;resize:vertical" placeholder="Notes...">${cn[a.key]?.notes || ''}</textarea>
          </div>`).join('')}
        <div style="padding:10px 12px;background:var(--bg2);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:12px">
          <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:6px">Overall Feedback</div>
          <textarea id="coaching-overall" style="width:100%;min-height:70px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:6px 8px;color:var(--text);font-size:11px;outline:none;font-family:inherit;resize:vertical">${cn.overall || ''}</textarea>
        </div>
        <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center" onclick="saveCoachingNotes('${companyId}')">💾 Save Coaching Notes to HubSpot</button>
        <div id="cn-save-msg" style="font-size:11px;color:var(--green);margin-top:6px;text-align:center"></div>
      </div>`;
  }

  document.getElementById('call-logger-content').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div style="background:var(--bg3);border-radius:var(--radius-sm);padding:12px">
        <div class="field-label" style="margin-bottom:6px">📋 Call Summary</div>
        <div style="font-size:13px;color:var(--text);line-height:1.6">${analysis.summary || 'No summary available'}</div>
        <div style="margin-top:8px;display:flex;gap:8px">
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:${analysis.interested ? 'var(--green-dim)' : 'var(--red-dim)'};color:${analysis.interested ? 'var(--green)' : 'var(--red)'}">
            ${analysis.interested ? '✓ Interested' : '✗ Not interested'}
          </span>
          <span style="font-size:11px;padding:2px 8px;border-radius:99px;background:var(--bg2);color:var(--text2)">${analysis.sentiment || 'neutral'}</span>
        </div>
      </div>
      <div>
        <div class="field-label" style="margin-bottom:6px">📝 Call Notes</div>
        <textarea id="call-notes-input" style="width:100%;min-height:100px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:10px;color:var(--text);font-size:12px;outline:none;font-family:inherit;resize:vertical">${analysis.callNotes || ''}</textarea>
      </div>
      ${typeBlock}
      ${followUpBlock}
      ${saveBar}
    </div>`;

  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>`;
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
        description: [notes, `HubSpot: https://app.hubspot.com/contacts/45530742/company/${companyId}`].filter(Boolean).join('\n\n'),
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

async function saveSalesNotes(companyId) {
  const goals = document.getElementById('sn-goals')?.value || '';
  const pain = document.getElementById('sn-pain')?.value || '';
  const company = document.getElementById('sn-company')?.value || '';
  const services = document.getElementById('sn-services')?.value || '';

const body = `<h3>📊 SALES NOTES</h3>` + [
    `<p><strong>Customer Goals:</strong><br>${goals.replace(/\n/g, '<br>')}</p>`,
    `<p><strong>Pain Points:</strong><br>${pain.replace(/\n/g, '<br>')}</p>`,
    `<p><strong>Current Provider:</strong><br>${company.replace(/\n/g, '<br>')}</p>`,
    `<p><strong>Primary Services:</strong><br>${services.replace(/\n/g, '<br>')}</p>`,
  ].join('');
  try {
    await hsPost('/crm/v3/objects/notes', {
      properties: { hs_note_body: body, hs_timestamp: Date.now() },
      associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }],
    });
    const msg = document.getElementById('sn-save-msg');
    if (msg) msg.textContent = '✓ Saved to HubSpot!';
    toast('Sales notes saved to HubSpot ✓', 'success');
  } catch {
    toast('Failed to save sales notes', 'error');
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

function setScore(area, score) {
  state.coachingScores = state.coachingScores || {};
  state.coachingScores[area] = score;
  [1,2,3,4,5].forEach(n => {
    const btn = document.getElementById(`score-${area}-${n}`);
    if (btn) {
      btn.style.background = n === score ? 'var(--amber)' : 'var(--bg3)';
      btn.style.color = n === score ? '#fff' : 'var(--text2)';
    }
  });
}

async function saveDemoNotes(companyId) {
  const fields = [
    ['Current Marketing / Initial Pain', 'dn-marketing'],
    ['Goals for Business (job gap, revenue gap, etc)', 'dn-goals'],
    ['Marketing History & Pain Points', 'dn-history'],
    ['Anticipated Objections', 'dn-objections'],
    ['Biggest Pain Points', 'dn-pain'],
    ['Sole Decision Maker?', 'dn-dm'],
  ];
  const body = `<h3>🎯 SET CALL NOTES</h3>` + fields.map(([label, id]) => 
    `<p><strong>${label}:</strong><br>${(document.getElementById(id)?.value || '—').replace(/\n/g, '<br>')}</p>`
  ).join('');
   try {
    await hsPost('/crm/v3/objects/notes', {
      properties: { hs_note_body: body, hs_timestamp: Date.now() },
      associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }],
    });
    const msg = document.getElementById('dn-save-msg');
    if (msg) msg.textContent = '✓ Saved to HubSpot!';
    toast('Demo notes saved to HubSpot ✓', 'success');
  } catch { toast('Failed to save demo notes', 'error'); }
}

async function saveCoachingNotes(companyId) {
  const areas = ['intro','elevatorPitch','otf','settingDemo','website','confirmingDMs','recap','pace','tonality','listening','communication','tailoredPitch'];
  const areaLabels = { intro:'Intro', elevatorPitch:'Elevator Pitch', otf:'Shoot for the OTF', settingDemo:'Setting the Demo', website:'Website Situation', confirmingDMs:'Confirming DMs', recap:'Research & Recap', pace:'Pace', tonality:'Tonality', listening:'Active Listening', communication:'Communication', tailoredPitch:'Tailored Pitch' };
  const scores = state.coachingScores || {};
  const lines = areas.map(a => {
    const score = scores[a] || '—';
    const notes = document.getElementById(`coaching-${a}`)?.value || '';
    return `${areaLabels[a]}: ${score}/5\n${notes}`;
  });
  const overall = document.getElementById('coaching-overall')?.value || '';
  const total = Object.values(scores).reduce((s, n) => s + n, 0);
  const avg = Object.keys(scores).length ? (total / Object.keys(scores).length).toFixed(1) : '—';
const body = `<h3>🏆 COACHING SCORECARD — Average Score: ${avg}/5</h3>` + 
    lines.map(l => `<p><strong>${l.split('\n')[0]}</strong><br>${l.split('\n').slice(1).join('<br>')}</p>`).join('') +
    (overall ? `<p><strong>Overall Feedback:</strong><br>${overall.replace(/\n/g, '<br>')}</p>` : '');
  try {
    await hsPost('/crm/v3/objects/notes', {
      properties: { hs_note_body: body, hs_timestamp: Date.now() },
      associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }],
    });
    const msg = document.getElementById('cn-save-msg');
    if (msg) msg.textContent = '✓ Saved to HubSpot!';
    toast('Coaching notes saved to HubSpot ✓', 'success');
  } catch { toast('Failed to save coaching notes', 'error'); }
}

async function pickFromHubSpot(companyId) {
  const btn = document.querySelector('[onclick^="pickFromHubSpot"]');
  if (btn) { btn.textContent = '⏳ Loading calls...'; btn.disabled = true; }

  try {
    // Fetch recent calls associated with this company
    const res = await fetch('/api/hubspot', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-HubSpot-Path': `/crm/v3/objects/calls/search`,
        'X-HubSpot-Method': 'POST',
      },
      body: JSON.stringify({
        filterGroups: [{
          filters: [{
            propertyName: 'associations.company',
            operator: 'EQ',
            value: companyId,
          }]
        }],
        properties: ['hs_call_title', 'hs_call_recording_url', 'hs_timestamp', 'hs_call_duration', 'hs_call_status', 'hs_call_disposition'],
        sorts: [{ propertyName: 'hs_timestamp', direction: 'DESCENDING' }],
        limit: 10,
      }),
    });
    const data = await res.json();
    console.log('RAW CALLS:', JSON.stringify(data.results?.map(c => ({ 
      title: c.properties.hs_call_title,
      disposition: c.properties.hs_call_disposition,
      recording: !!c.properties.hs_call_recording_url
    }))));
    const calls = (data.results || []).filter(c => 
      c.properties.hs_call_recording_url &&
      (c.properties.hs_call_disposition || '').toLowerCase() !== 'no message left'
    );

    if (!calls.length) {
      toast('No calls with recordings found in HubSpot for this company', 'error');
      if (btn) { btn.textContent = '📞 Pick from HubSpot calls (beta)'; btn.disabled = false; }
      return;
    }

    // Show call picker
    const picker = document.createElement('div');
    picker.style.cssText = 'margin-top:12px;border-top:1px solid var(--border);padding-top:12px';
    picker.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:var(--text);margin-bottom:8px">Select a call recording:</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${calls.map(call => {
          const date = call.properties.hs_timestamp
            ? new Date(parseInt(call.properties.hs_timestamp)).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' })
            : 'Unknown date';
          const duration = call.properties.hs_call_duration
            ? `${Math.round(parseInt(call.properties.hs_call_duration) / 60000)}m`
            : '';
          const title = call.properties.hs_call_title || 'Call';
          return `
            <div onclick="useHubSpotRecording('${companyId}', '${encodeURIComponent(call.properties.hs_call_recording_url)}')"
              style="padding:10px 12px;background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius-sm);cursor:pointer;transition:all .15s"
              onmouseover="this.style.borderColor='var(--blue)'" onmouseout="this.style.borderColor='var(--border)'">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${title}</div>
              <div style="font-size:11px;color:var(--text2);margin-top:2px">${date}${duration ? ` · ${duration}` : ''}</div>
            </div>`;
        }).join('')}
      </div>`;

    const uploadSection = document.getElementById('upload-section');
    const existing = uploadSection.querySelector('.hs-call-picker');
    if (existing) existing.remove();
    picker.className = 'hs-call-picker';
    uploadSection.appendChild(picker);
    if (btn) { btn.textContent = '📞 Pick from HubSpot calls (beta)'; btn.disabled = false; }

  } catch (e) {
    toast('Failed to load HubSpot calls: ' + e.message, 'error');
    if (btn) { btn.textContent = '📞 Pick from HubSpot calls (beta)'; btn.disabled = false; }
  }
}

async function useHubSpotRecording(companyId, encodedUrl) {
  const recordingUrl = decodeURIComponent(encodedUrl);
  const c = state.contacts.find(x => x.id === companyId);

  document.getElementById('call-logger-content').innerHTML = `
    <div style="padding:24px 8px">
      <div id="transcribe-status" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px;text-align:center">Downloading recording...</div>
      <div style="background:var(--bg3);border-radius:99px;height:8px;overflow:hidden">
        <div id="transcribe-bar" style="height:100%;width:20%;background:var(--blue);border-radius:99px;transition:width 0.4s ease"></div>
      </div>
      <div id="transcribe-elapsed" style="font-size:11px;color:var(--text3);text-align:center;margin-top:8px">Fetching from HubSpot...</div>
    </div>`;

  state.transcribing = true;
  try {
    // Resolve the auth-gated HubSpot recording URL server-side, then fetch audio
    const resolveRes = await fetch(`/api/hubspot?action=recording-url&url=${encodeURIComponent(recordingUrl)}`, {
      headers: { Authorization: `Bearer ${state.token}` },
    });
    if (!resolveRes.ok) {
      const err = await resolveRes.json().catch(() => ({}));
      throw new Error(err.error || `Recording resolve failed (${resolveRes.status})`);
    }
    const contentType = resolveRes.headers.get('content-type') || '';
    let audioBlob;
    if (contentType.startsWith('audio') || contentType.startsWith('video')) {
      // Backend streamed the audio directly
      audioBlob = await resolveRes.blob();
    } else {
      const { url, error } = await resolveRes.json();
      if (!url) throw new Error(error || 'Failed to resolve recording URL');
      const audioRes = await fetch(url);
      if (!audioRes.ok) throw new Error('Failed to download recording from CDN');
      audioBlob = await audioRes.blob();
    }

    document.getElementById('transcribe-status').textContent = 'Uploading to transcription server...';
    document.getElementById('transcribe-bar').style.width = '30%';

    // Get whisper server config
    const { url: whisperUrl, key: whisperKey } = await fetch('/api/transcribe').then(r => r.json());

    // Send to whisper
    const uploadRes = await fetch(`${whisperUrl}/transcribe`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${whisperKey}`, 'Content-Type': 'application/octet-stream' },
      body: audioBlob,
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadData.detail || uploadData.error}`);
    const { job_id } = uploadData;

    // Poll for completion
    document.getElementById('transcribe-status').textContent = 'Transcribing...';
    document.getElementById('transcribe-bar').style.width = '40%';
    const transcribeStart = Date.now();
    while (true) {
      await new Promise(r => setTimeout(r, 3000));
      const statusRes = await fetch(`${whisperUrl}/status/${job_id}`, {
        headers: { 'Authorization': `Bearer ${whisperKey}` },
      });
      const statusData = await statusRes.json();
      if (statusData.status === 'error') throw new Error(statusData.error || 'Transcription failed');
      if (statusData.status === 'done') {
        // Analyze
        document.getElementById('transcribe-bar').style.width = '100%';
        document.getElementById('transcribe-status').textContent = 'Analyzing with AI...';
        const analysisRes = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
          body: JSON.stringify({ transcript: statusData.transcript, companyName: c.name, callType: state.selectedCallType || 'general', includeCoaching: state.coachingEnabled || false }),
        });
        const analysisJson = await analysisRes.json();
        if (!analysisRes.ok) throw new Error(`Analysis failed: ${analysisJson.error}`);
        state.transcribing = false;
        showCallAnalysis(companyId, statusData.transcript, analysisJson.analysis);
        return;
      }
      const elapsed = Math.round((Date.now() - transcribeStart) / 1000);
      const progress = Math.min(90, 40 + (elapsed / 180) * 50);
      document.getElementById('transcribe-bar').style.width = `${progress}%`;
      document.getElementById('transcribe-elapsed').textContent = `${elapsed}s`;
    }
  } catch (e) {
    state.transcribing = false;
    document.getElementById('call-logger-content').innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:36px;margin-bottom:12px">❌</div>
        <div style="font-size:14px;font-weight:600;color:var(--red);margin-bottom:8px">Failed</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:16px">${e.message}</div>
        <button class="btn btn-primary" onclick="openCallLogger('${companyId}')">Try again</button>
      </div>`;
  }
}


// ─── SETTINGS ─────────────────────────────────────────────────────────────────
async function renderSettingsView() {
  const main = document.getElementById('main');
  main.innerHTML = `
    <div class="topbar">
      <div class="topbar-left"><h2>⚙️ Settings</h2></div>
    </div>
    <div class="content" style="max-width:560px">
      <div style="display:flex;flex-direction:column;gap:28px">

        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">🗓️ Schedule Preferences</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:14px">Control what shows up on your daily schedule view.</div>
          <div style="display:flex;flex-direction:column;gap:10px">
            <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg3);border-radius:6px;cursor:pointer" onclick="toggleScheduleFilter('tasks')">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text)">✅ Show HubSpot Tasks</div>
                <div style="font-size:12px;color:var(--text3);margin-top:2px">Display today's tasks from HubSpot on the schedule</div>
              </div>
              <div style="width:36px;height:20px;border-radius:10px;background:${state.scheduleShowTasks !== false ? 'var(--blue)' : 'var(--border2)'};position:relative;flex-shrink:0;transition:background .15s" id="toggle-tasks-pill">
                <div style="width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:2px;${state.scheduleShowTasks !== false ? 'right:2px' : 'left:2px'};transition:all .15s" id="toggle-tasks-knob"></div>
              </div>
            </label>
            <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg3);border-radius:6px;cursor:pointer" onclick="toggleScheduleFilter('overdue')">
              <div>
                <div style="font-size:13px;font-weight:600;color:var(--text)">⚠️ Show Overdue Tasks</div>
                <div style="font-size:12px;color:var(--text3);margin-top:2px">Show tasks past their due date at the bottom of the schedule</div>
              </div>
              <div style="width:36px;height:20px;border-radius:10px;background:${state.scheduleShowOverdue !== false ? 'var(--blue)' : 'var(--border2)'};position:relative;flex-shrink:0;transition:background .15s" id="toggle-overdue-pill">
                <div style="width:16px;height:16px;border-radius:50%;background:#fff;position:absolute;top:2px;${state.scheduleShowOverdue !== false ? 'right:2px' : 'left:2px'};transition:all .15s" id="toggle-overdue-knob"></div>
              </div>
            </label>
          </div>
        </div>

        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">📅 Calendar Preferences</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:14px">Choose which calendars appear on your dashboard. Saves permanently to your account.</div>
          <div id="cal-prefs-section">
            <div style="font-size:13px;color:var(--text3)">Loading calendars...</div>
          </div>
        </div>

        ${state.isAdmin ? `<div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">🔗 Company Resource Links</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:14px">Links to case studies, blog posts, or resources that reps can include in demo follow-up emails when a prospect asks for them. One URL per line — optionally add a label like "Case Study: Accent Awnings | https://..."</div>
          <textarea id="org-resources" style="width:100%;min-height:120px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:10px 12px;color:var(--text);font-size:13px;outline:none;font-family:inherit;resize:vertical" placeholder="Case Study: Accent Awnings | https://ollyolly.com/case-studies/accent-awnings&#10;Blog: Why GBP Matters | https://ollyolly.com/blog/gbp&#10;https://ollyolly.com/resources">${(state.orgSettings?.resourceLinks || []).join('\n').replace(/</g,'&lt;')}</textarea>
          <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="saveOrgResources()">Save resource links</button>
        </div>

        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">👥 Team Members</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:14px">Add and manage reps.</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
              <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Add one person</div>
              <div style="margin-bottom:8px"><div class="field-label" style="margin-bottom:4px">Full name</div><input id="new-name" placeholder="Jane Smith" style="width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" oninput="autoFillUser()" /></div>
              <div style="margin-bottom:8px"><div class="field-label" style="margin-bottom:4px">Email</div><input id="new-email" placeholder="Auto-filled from name" style="width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" /></div>
              <div style="margin-bottom:12px"><div class="field-label" style="margin-bottom:4px">Password</div><input id="new-password" style="width:100%;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" value="OllyOlly2025!" /></div>
              <div style="margin-bottom:12px"><label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text2);cursor:pointer"><input type="checkbox" id="new-admin" /> Make admin</label></div>
              <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="addUser()">Add user</button>
              <div id="add-msg" style="font-size:12px;margin-top:8px"></div>
            </div>
            <div style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--radius);padding:14px">
              <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Bulk add</div>
              <div style="font-size:11px;color:var(--text3);margin-bottom:10px">One full name per line. Email and password auto-generated.</div>
              <textarea id="bulk-names" placeholder="Jane Smith&#10;John Doe&#10;Sarah Connor" style="width:100%;height:140px;background:var(--bg);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none;resize:none;font-family:inherit"></textarea>
              <button class="btn btn-primary" style="width:100%;justify-content:center;margin-top:8px" onclick="bulkAddUsers()">Add all</button>
              <div id="bulk-msg" style="font-size:12px;margin-top:8px;line-height:1.6"></div>
            </div>
          </div>
          <div id="user-list"><span class="spinner"></span> Loading...</div>
        </div>

        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">📊 Usage & API Cost</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:14px;display:flex;align-items:center;gap:10px">
            Month: <input type="month" id="usage-month" value="${new Date().toISOString().slice(0,7)}" onchange="loadUsageDashboard(this.value)" style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:5px 10px;color:var(--text);font-size:12px;outline:none" />
          </div>
          <div id="usage-table"><span class="spinner"></span> Loading...</div>
        </div>` : ''}

        <div>
          <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:4px">🔑 Change Password</div>
          <div style="font-size:13px;color:var(--text2);margin-bottom:14px">Update your login password.</div>
          <div style="display:flex;flex-direction:column;gap:10px;max-width:340px">
            <div>
              <div class="field-label" style="margin-bottom:4px">Current password</div>
              <input type="password" id="pw-current" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" />
            </div>
            <div>
              <div class="field-label" style="margin-bottom:4px">New password</div>
              <input type="password" id="pw-new" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" />
            </div>
            <div>
              <div class="field-label" style="margin-bottom:4px">Confirm new password</div>
              <input type="password" id="pw-confirm" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" />
            </div>
            <div id="pw-error" style="font-size:12px;color:var(--red);display:none"></div>
            <button class="btn btn-primary" style="justify-content:center" onclick="changePassword()">Update password</button>
          </div>
        </div>

      </div>
    </div>`;

  if (state.isAdmin) {
    loadUserList();
    loadUsageDashboard(new Date().toISOString().slice(0, 7));
  }

  // Load calendars
  try {
    const res = await fetch('/api/calendar?action=calendarlist', { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await res.json();
    const sec = document.getElementById('cal-prefs-section');
    if (!sec) return;
    if (data.notConnected || !data.calendars?.length) {
      sec.innerHTML = `<div style="font-size:13px;color:var(--text3)">Google Calendar not connected. <button class="btn btn-sm btn-primary" style="margin-left:8px" onclick="connectGoogleCalendar()">Connect now</button></div>`;
      return;
    }
    const disabled = new Set(state.calendarPrefs?.disabledCalendars || []);
    window._settingsCalendars = data.calendars;
    sec.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
        ${data.calendars.map(c => `
          <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px 12px;background:var(--bg3);border-radius:6px">
            <input type="checkbox" id="cal-cb-${c.id.replace(/[^a-z0-9]/gi,'_')}" ${!disabled.has(c.id) ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--blue);cursor:pointer" />
            <span style="font-size:13px;color:var(--text)">${c.name}</span>
            ${c.primary ? '<span style="font-size:10px;color:var(--text3);margin-left:4px">(primary)</span>' : ''}
          </label>`).join('')}
      </div>
      <button class="btn btn-primary" onclick="saveCalendarPrefs()" style="font-size:13px">Save preferences</button>`;
  } catch {
    const sec = document.getElementById('cal-prefs-section');
    if (sec) sec.innerHTML = `<div style="font-size:13px;color:var(--text3)">Could not load calendars. <button class="btn btn-sm" onclick="connectGoogleCalendar()">Reconnect Google</button></div>`;
  }
}

async function saveOrgResources() {
  const raw = document.getElementById('org-resources')?.value || '';
  const resourceLinks = raw.split('\n').map(l => l.trim()).filter(Boolean);
  try {
    await fetch('/api/users?action=setorgsettings', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ resourceLinks }) });
    state.orgSettings.resourceLinks = resourceLinks;
    toast('Resource links saved ✓', 'success');
  } catch { toast('Failed to save', 'error'); }
}

async function saveCalendarPrefs() {
  const cals = window._settingsCalendars || [];
  const disabled = cals.filter(c => {
    const cb = document.getElementById('cal-cb-' + c.id.replace(/[^a-z0-9]/gi,'_'));
    return cb && !cb.checked;
  }).map(c => c.id);
  state.calendarPrefs = { disabledCalendars: disabled };
  try {
    await fetch('/api/users?action=setcalprefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ disabledCalendars: disabled }),
    });
    toast('Calendar preferences saved ✓', 'success');
  } catch { toast('Failed to save', 'error'); }
}

async function changePassword() {
  const current = document.getElementById('pw-current')?.value;
  const newPw = document.getElementById('pw-new')?.value;
  const confirm = document.getElementById('pw-confirm')?.value;
  const errEl = document.getElementById('pw-error');
  if (errEl) errEl.style.display = 'none';
  if (!current || !newPw || !confirm) { if (errEl) { errEl.textContent = 'All fields required'; errEl.style.display = 'block'; } return; }
  if (newPw !== confirm) { if (errEl) { errEl.textContent = 'New passwords do not match'; errEl.style.display = 'block'; } return; }
  if (newPw.length < 6) { if (errEl) { errEl.textContent = 'Must be at least 6 characters'; errEl.style.display = 'block'; } return; }
  try {
    const res = await fetch('/api/users?action=changepassword', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ currentPassword: current, newPassword: newPw }),
    });
    const data = await res.json();
    if (!res.ok) { if (errEl) { errEl.textContent = data.error || 'Failed'; errEl.style.display = 'block'; } return; }
    toast('Password updated ✓', 'success');
    ['pw-current','pw-new','pw-confirm'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  } catch { if (errEl) { errEl.textContent = 'Something went wrong'; errEl.style.display = 'block'; } }
}

// ─── BOOT ─────────────────────────────────────────────────────────────────────
checkSession();

// ─── DIALER ───────────────────────────────────────────────────────────────────

state.dialerCompany = null;
state.calendarEvents = [];
state.calendarPrefs = { disabledCalendars: [] };
state._cachedTasks = [];
state._cachedCalEvents = [];
state._availableCalendars = [];

async function loadCalendarEvents() {
  try {
    const now = new Date();
    const s = new Date(now); s.setHours(0,0,0,0);
    const e = new Date(now); e.setHours(23,59,59,999);
    const params = new URLSearchParams({ action: 'events', timeMin: s.toISOString(), timeMax: e.toISOString() });
    const res = await fetch(`/api/calendar?${params}`, { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await res.json();
    if (data.events) { state.calendarEvents = data.events; resolveEventCompanies(data.events); }
    if (data.calendars) state._availableCalendars = data.calendars;
  } catch {}
  renderDemoBanner();
}

async function loadDemoTags() {
  try {
    const res = await fetch('/api/users?action=getdemotags', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const { tags, acks } = await res.json();
    state.demoTags = tags || {};
    state.demoAcks = acks || {};
  } catch {}
}

async function resolveEventCompanies(events) {
  const unresolved = (events || []).filter(ev => {
    if (!ev.id) return false;
    if (state.eventHsCache[ev.id]) return false;
    if (ev.description?.match(/https:\/\/app\.hubspot\.com\/contacts\/\d+\/company\/\d+/)) return false;
    return ev.attendeeEmails?.length > 0;
  });
  if (!unresolved.length) return;
  const emails = [...new Set(unresolved.flatMap(ev => ev.attendeeEmails || []))];
  try {
    const res = await fetch('/api/hubspot?action=companiesByEmail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
      body: JSON.stringify({ emails }),
    });
    const { map } = await res.json();
    for (const ev of unresolved) {
      const match = (ev.attendeeEmails || []).find(e => map[e]);
      if (match) state.eventHsCache[ev.id] = map[match];
    }
    renderScheduleSection();
  } catch {}
}

async function loadOrgSettings() {
  try {
    const res = await fetch('/api/users?action=getorgsettings', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const { settings } = await res.json();
    state.orgSettings = settings || {};
  } catch {}
}

async function loadCalendarPrefs() {
  try {
    const res = await fetch('/api/users?action=getcalprefs', { headers: { Authorization: `Bearer ${state.token}` } });
    const data = await res.json();
    if (data.prefs) {
      state.calendarPrefs = { disabledCalendars: data.prefs.disabledCalendars || [] };
      if (data.prefs.showTasks !== undefined) state.scheduleShowTasks = data.prefs.showTasks;
      if (data.prefs.showOverdue !== undefined) state.scheduleShowOverdue = data.prefs.showOverdue;
    }
  } catch {}
}

// ─── DEMO BLOCKER ─────────────────────────────────────────────────────────────
function demoAckKey(ev) { return `demo_ack_${ev.summary || ''}_${ev.start?.dateTime || ''}`; }
function demoTagKey(ev) { return `demo_tag_${ev.id || (ev.summary || '') + '_' + (ev.start?.dateTime || ev.start?.date || '')}`; }
function isTaggedDemo(ev) { return !!state.demoTags[demoTagKey(ev)]; }
function toggleDemoTag(key) {
  const isNowDemo = !state.demoTags[key];
  if (isNowDemo) state.demoTags[key] = 1; else delete state.demoTags[key];
  fetch('/api/users?action=setdemotag', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ key, value: isNowDemo }) }).catch(() => {});
  const card = document.querySelector(`[data-tag-key="${key}"]`);
  if (card) {
    card.style.borderLeftColor = isNowDemo ? '#f59e0b' : 'var(--blue)';
    const icon = card.querySelector('.event-icon');
    if (icon) icon.textContent = isNowDemo ? '🎯' : '📅';
    const btn = card.querySelector('.demo-tag-btn');
    if (btn) {
      btn.textContent = isNowDemo ? '🎯 Demo' : 'Mark Demo';
      btn.style.borderColor = isNowDemo ? 'rgba(245,158,11,.4)' : 'var(--border2)';
      btn.style.background = isNowDemo ? 'rgba(245,158,11,.15)' : 'transparent';
      btn.style.color = isNowDemo ? '#f59e0b' : 'var(--text3)';
    }
  }
  renderDemoBanner();
}

function checkUpcomingDemo() {
  if (!state.calendarEvents?.length) return null;
  const now = Date.now(), in10 = now + 10 * 60 * 1000;
  return state.calendarEvents.find(ev => {
    if (!ev.start?.dateTime) return false;
    if (!isTaggedDemo(ev)) return false;
    const s = new Date(ev.start.dateTime).getTime();
    return s > now && s <= in10 && !state.demoAcks[demoAckKey(ev)];
  }) || null;
}

function playDemoSiren() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.4, 0.8].forEach((delay, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      osc.frequency.value = i === 2 ? 1100 : 880;
      gain.gain.setValueAtTime(0.6, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + 0.35);
      osc.start(ctx.currentTime + delay); osc.stop(ctx.currentTime + delay + 0.35);
    });
  } catch {}
}

let _demoTitleInterval = null, _demoSirenInterval = null;

function renderDemoBanner() {
  const existing = document.getElementById('demo-alert-banner');
  const flash = document.getElementById('demo-screen-flash');
  const upcoming = checkUpcomingDemo();

  if (!upcoming) {
    if (existing) existing.remove();
    if (flash) flash.remove();
    if (_demoTitleInterval) { clearInterval(_demoTitleInterval); _demoTitleInterval = null; document.title = 'Olly Olly'; }
    if (_demoSirenInterval) { clearInterval(_demoSirenInterval); _demoSirenInterval = null; }
    updateDialerOverlay();
    return;
  }

  const start = new Date(upcoming.start.dateTime);
  const minsUntil = Math.max(1, Math.round((start.getTime() - Date.now()) / 60000));
  const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ack = demoAckKey(upcoming);
  const isNew = !existing;

  if (!document.getElementById('demo-screen-flash')) {
    const f = document.createElement('div');
    f.id = 'demo-screen-flash';
    f.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;pointer-events:none;border:6px solid #ef4444;z-index:998;animation:demoPulse 0.8s ease-in-out infinite';
    if (!document.getElementById('demo-pulse-style')) {
      const s = document.createElement('style'); s.id = 'demo-pulse-style';
      s.textContent = '@keyframes demoPulse{0%,100%{opacity:0}50%{opacity:1}} @keyframes demoBanner{0%,100%{background:#f59e0b}50%{background:#ef4444}}';
      document.head.appendChild(s);
    }
    document.body.appendChild(f);
  }

  if (!_demoTitleInterval) {
    _demoTitleInterval = setInterval(() => {
      document.title = document.title.startsWith('⚠️') ? 'Olly Olly' : `⚠️ DEMO IN ${minsUntil}m — WRAP UP!`;
    }, 1000);
  }
  if (isNew) { playDemoSiren(); _demoSirenInterval = setInterval(playDemoSiren, 120000); }

  const html = `<div id="demo-alert-banner" style="position:fixed;top:0;left:0;right:0;z-index:1000;color:#111;padding:12px 20px;display:flex;align-items:center;gap:12px;font-size:14px;font-weight:700;box-shadow:0 4px 20px rgba(239,68,68,0.5);animation:demoBanner 0.8s ease-in-out infinite">
    <span style="font-size:24px">🚨</span>
    <div style="flex:1;min-width:0">DEMO IN <strong style="font-size:18px">${minsUntil} MIN</strong> — "${upcoming.summary}" at ${timeStr} — FINISH YOUR CALL AND GET READY</div>
    ${upcoming.htmlLink ? `<a href="${upcoming.htmlLink}" target="_blank" style="color:#111;font-size:11px;border:1px solid rgba(0,0,0,0.3);padding:4px 10px;border-radius:4px;text-decoration:none;white-space:nowrap;font-weight:400">View ↗</a>` : ''}
    <button onclick="acknowledgeDemoEvent('${ack}')" style="background:#111;color:#f59e0b;border:none;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">I KNOW — Acknowledge</button>
  </div>`;
  if (existing) existing.outerHTML = html;
  else document.body.insertAdjacentHTML('afterbegin', html);
  updateDialerOverlay();
}

function acknowledgeDemoEvent(ackKey) {
  state.demoAcks[ackKey] = 1;
  fetch('/api/users?action=ackdemoevent', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ key: ackKey }) }).catch(() => {});
  if (_demoTitleInterval) { clearInterval(_demoTitleInterval); _demoTitleInterval = null; document.title = 'Olly Olly'; }
  if (_demoSirenInterval) { clearInterval(_demoSirenInterval); _demoSirenInterval = null; }
  const f = document.getElementById('demo-screen-flash'); if (f) f.remove();
  renderDemoBanner();
}

function showDemoBlocker(upcoming, onContinue) {
  const start = new Date(upcoming.start.dateTime);
  const minsUntil = Math.max(1, Math.round((start.getTime() - Date.now()) / 60000));
  const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const ack = demoAckKey(upcoming);
  document.getElementById('modal-title').innerHTML = '⏰ Upcoming Demo';
  document.getElementById('modal-body').innerHTML = `
    <div style="text-align:center;padding:16px 0">
      <div style="font-size:52px;margin-bottom:16px">⏰</div>
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:8px">You have a demo in ${minsUntil} minute${minsUntil !== 1 ? 's' : ''}</div>
      <div style="font-size:14px;color:var(--text2);margin-bottom:4px">"${upcoming.summary}"</div>
      <div style="font-size:13px;color:var(--text3)">at ${timeStr}</div>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal();showView('dashboard')">View Today →</button>
    <button class="btn btn-primary btn-sm" onclick="acknowledgeDemoEvent('${ack}');closeModal();(${onContinue.toString()})()">Acknowledge & Continue</button>`;
  document.getElementById('modal').style.display = 'flex';
}

// ─── DIALER VIEW ──────────────────────────────────────────────────────────────
async function renderDialerView() {
  const main = document.getElementById('main');
  const co = state.dialerCompany;

  if (!state.notes) state.notes = {};
  if (co?.id) {
    try {
      const nr = await fetch(`/api/users?action=getnotes&companyId=${co.id}`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (nr.ok) { const { notes: kv } = await nr.json(); state.notes[co.id] = kv || []; }
    } catch {}
  }

  // Fetch associated contacts for this company
  let assocContacts = [];
  if (co?.id) {
    try {
      const assocRes = await fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${co.id}/associations/contacts`, Authorization: `Bearer ${state.token}` } }).then(r => r.json());
      const cids = (assocRes.results || []).slice(0, 5).map(r => r.id);
      if (cids.length) {
        const batch = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/contacts/batch/read', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ inputs: cids.map(id => ({ id })), properties: ['firstname','lastname','email','phone','jobtitle'] }) }).then(r => r.json());
        assocContacts = (batch.results || []).map(c => ({
          name: [c.properties.firstname, c.properties.lastname].filter(Boolean).join(' ') || '—',
          email: c.properties.email || '',
          phone: c.properties.phone || '',
          title: c.properties.jobtitle || '',
        }));
      }
    } catch {}
  }

  const notes = co ? (state.notes?.[co.id] || []) : [];
  const contact = co ? state.contacts.find(c => c.id === co.id) : null;
  const ta = 'width:100%;min-height:60px;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 10px;color:var(--text);font-size:12px;outline:none;font-family:inherit;resize:vertical';
  const activeQueue = state.queues.find(q => q.id === state.activeQueueId) || state.queues[0];
  const queueCompanies = activeQueue?.companies || [];

  const field = (label, value, extra = '') => value ? `<div style="display:flex;justify-content:space-between;align-items:baseline;padding:5px 0;border-bottom:1px solid var(--border)"><span style="font-size:11px;color:var(--text3);flex-shrink:0;margin-right:8px">${label}</span><span style="font-size:12px;color:var(--text);text-align:right">${extra || value}</span></div>` : '';

  const rightPanel = co ? `
    <div style="width:320px;flex-shrink:0;background:var(--bg);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:2px">${co.name}</div>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="openCallLogger('${co.id}')" style="font-size:11px">📝 Log call</button>
          <button class="btn btn-sm" onclick="openEmailCompose('${co.id}')" style="font-size:11px">✉️ Email</button>
          <a href="https://app.hubspot.com/contacts/45530742/company/${co.id}" target="_blank" class="btn btn-sm" style="font-size:11px;text-decoration:none">HS ↗</a>
        </div>
      </div>
      <div style="flex:1;overflow-y:auto">
        <div style="padding:10px 16px;border-bottom:1px solid var(--border)">
          ${field('Phone', contact?.phone, contact?.phone ? `<a href="tel:${(contact.phone||'').replace(/\D/g,'')}" style="color:var(--green);text-decoration:none;font-weight:600">${contact.phone}</a>` : '')}
          ${field('Location', contact?.city || contact?.state, [contact?.city, contact?.state].filter(Boolean).join(', '))}
          ${field('Timezone', contact?.timezone)}
          ${field('Stage', contact?.masterStage || contact?.stage)}
          ${field('Score', contact?.score, `<span style="color:var(--${contact?.urgency === 'urgent' ? 'red' : contact?.urgency === 'warm' ? 'amber' : 'blue'})">${contact?.score}/100</span>`)}
          ${field('Lead Source', contact?.leadSource)}
          ${field('Last Contact', contact?.lastContacted)}
          ${field('Website', contact?.rawProps?.website, contact?.rawProps?.website ? `<a href="${contact.rawProps.website.startsWith('http') ? contact.rawProps.website : 'https://'+contact.rawProps.website}" target="_blank" style="color:var(--blue);text-decoration:none">${contact.rawProps.website}</a>` : '')}
        </div>
        ${assocContacts.length ? `<div style="padding:10px 16px;border-bottom:1px solid var(--border)">
          <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Contacts</div>
          ${assocContacts.map(ac => `<div style="padding:5px 0;border-bottom:1px solid var(--border)">
            <div style="font-size:12px;font-weight:600;color:var(--text)">${ac.name}${ac.title ? ` <span style="font-weight:400;color:var(--text3)">· ${ac.title}</span>` : ''}</div>
            ${ac.email ? `<div style="font-size:11px;color:var(--text3)">${ac.email}</div>` : ''}
            ${ac.phone ? `<a href="tel:${ac.phone.replace(/\D/g,'')}" style="font-size:11px;color:var(--green);text-decoration:none">${ac.phone}</a>` : ''}
          </div>`).join('')}
        </div>` : ''}
        <div style="padding:10px 16px">
          <div style="font-size:11px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px">Notes</div>
          <div id="dialer-notes-list">
            ${notes.length ? notes.slice(0,15).map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--border)"><div style="font-size:10px;color:var(--text3);margin-bottom:2px">${n.date}${n.type ? ' · '+n.type : ''}</div><div style="font-size:12px;color:var(--text2);line-height:1.5;white-space:pre-wrap">${(n.text||'').slice(0,300)}</div></div>`).join('') : '<div style="font-size:12px;color:var(--text3)">No notes yet</div>'}
          </div>
        </div>
      </div>
      <div style="padding:10px 16px;border-top:1px solid var(--border)">
        <textarea id="dialer-note-input" placeholder="Quick note..." style="${ta}"></textarea>
        <button class="btn btn-primary btn-sm" style="margin-top:6px;width:100%;justify-content:center" onclick="saveDialerNote('${co.id}')">Save note</button>
      </div>
      <div style="padding:10px 16px;border-top:1px solid var(--border)">
        <button class="btn btn-sm" style="width:100%;justify-content:center" onclick="state.dialerCompany=null;renderDialerView()">← Back to Queue</button>
      </div>
    </div>` : `
    <div style="width:300px;flex-shrink:0;background:var(--bg);border-left:1px solid var(--border);display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:12px 16px;border-bottom:1px solid var(--border)">
        <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em">📋 ${activeQueue?.name || 'Queue'}</div>
        <div style="font-size:11px;color:var(--text3);margin-top:2px">${queueCompanies.length} companies — click to load info</div>
      </div>
      <div style="flex:1;overflow-y:auto">
        ${queueCompanies.length === 0 ? `<div style="padding:20px;font-size:13px;color:var(--text3);text-align:center">Queue is empty.<br><br>Add companies from the Companies view.</div>` :
          queueCompanies.map(qc => {
            const qContact = state.contacts.find(x => x.id === qc.id);
            return `<div onclick="state.dialerCompany={id:'${qc.id}',name:'${(qc.name||'').replace(/'/g,"\\'")}',phone:'${(qc.phone||'').replace(/'/g,"\\'")}'}; renderDialerView()" style="padding:10px 16px;border-bottom:1px solid var(--border);cursor:pointer;transition:background .1s" onmouseover="this.style.background='var(--bg3)'" onmouseout="this.style.background=''">
              <div style="font-size:13px;font-weight:600;color:var(--text)">${qc.name}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">${qc.phone ? `<span style="color:var(--green)">${qc.phone}</span>` : 'No phone'}${qContact ? ` · ${qContact.masterStage || qContact.stage || ''}` : ''}</div>
            </div>`;
          }).join('')}
      </div>
    </div>`;

  main.innerHTML = `
    <div class="topbar">
      <div class="topbar-left">
        <h2>📞 Dialer</h2>
        ${co ? `<p style="font-weight:600;color:var(--text)">${co.name}${co.phone ? ' · ' + co.phone : ''}</p>` : '<p>Aloware</p>'}
      </div>
      <div class="topbar-right" style="gap:6px">
        <button id="perm-mic" class="btn btn-sm" onclick="requestDialerPermissions()" style="font-size:12px">🎤 Mic</button>
        <a href="https://app.aloware.io" target="_blank" class="btn btn-sm" style="font-size:12px;text-decoration:none">↗ New tab</a>
      </div>
    </div>
    <div style="display:flex;height:calc(100vh - 61px)">
      <div style="flex:1;position:relative;min-width:0">
        <iframe id="aloware-frame" src="https://app.aloware.io" style="width:100%;height:100%;border:none;display:block" allow="microphone *; camera *; notifications *; autoplay *; clipboard-write *"></iframe>
        <div id="dialer-demo-overlay" style="display:none;position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(15,0,0,0.6);backdrop-filter:blur(2px);z-index:10;flex-direction:column;align-items:center;justify-content:center;gap:16px">
          <div style="font-size:52px">⏰</div>
          <div id="dialer-overlay-msg" style="font-size:16px;font-weight:700;color:#fff;text-align:center"></div>
          <div style="font-size:13px;color:rgba(255,255,255,0.6);text-align:center">Acknowledge your upcoming demo before dialing outbound.</div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button onclick="showView('dashboard')" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,0.3);padding:8px 18px;border-radius:6px;font-size:13px;cursor:pointer">View Today</button>
            <button id="dialer-ack-btn" style="background:#f59e0b;color:#111;border:none;padding:8px 20px;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer">Acknowledge & Open Dialer</button>
          </div>
        </div>
      </div>
      ${rightPanel}
    </div>`;

  updateDialerOverlay();
}

async function saveDialerNote(companyId) {
  const input = document.getElementById('dialer-note-input');
  const text = input?.value.trim();
  if (!text) return;
  try { await hsPost('/crm/v3/objects/notes', { properties: { hs_note_body: text, hs_timestamp: Date.now() }, associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 190 }] }] }); } catch {}
  try { await fetch('/api/notes', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ companyId, text, date: new Date().toLocaleString() }) }); } catch {}
  if (!state.notes) state.notes = {};
  if (!state.notes[companyId]) state.notes[companyId] = [];
  state.notes[companyId].unshift({ text, date: new Date().toLocaleString() });
  if (input) input.value = '';
  const list = document.getElementById('dialer-notes-list');
  if (list) list.innerHTML = state.notes[companyId].slice(0,15).map(n => `<div style="padding:8px 0;border-bottom:1px solid var(--border)"><div style="font-size:10px;color:var(--text3);margin-bottom:3px">${n.date}</div><div style="font-size:12px;color:var(--text2);line-height:1.5;white-space:pre-wrap">${(n.text||'').slice(0,300)}</div></div>`).join('') || '<div style="font-size:12px;color:var(--text3)">No notes yet</div>';
  toast('Note saved ✓', 'success');
}

function updateDialerOverlay() {
  if (state.currentView !== 'dialer') return;
  const overlay = document.getElementById('dialer-demo-overlay');
  const frame = document.getElementById('aloware-frame');
  if (!overlay || !frame) return;
  const upcoming = checkUpcomingDemo();
  if (upcoming) {
    const start = new Date(upcoming.start.dateTime);
    const minsUntil = Math.max(1, Math.round((start.getTime() - Date.now()) / 60000));
    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const msg = document.getElementById('dialer-overlay-msg');
    if (msg) msg.textContent = `🚨 DEMO IN ${minsUntil} MINUTE${minsUntil !== 1 ? 'S' : ''} — "${upcoming.summary}" at ${timeStr}`;
    const ackBtn = document.getElementById('dialer-ack-btn');
    if (ackBtn) ackBtn.onclick = () => { acknowledgeDemoEvent(demoAckKey(upcoming)); updateDialerOverlay(); };
    overlay.style.display = 'flex';
    frame.style.pointerEvents = 'none'; frame.style.filter = 'blur(3px) brightness(0.4)';
  } else {
    overlay.style.display = 'none';
    frame.style.pointerEvents = ''; frame.style.filter = '';
  }
}

async function requestDialerPermissions() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach(t => t.stop()); toast('Mic granted ✓', 'success'); } catch { toast('Mic blocked — check browser settings', 'error'); }
  try { await Notification.requestPermission(); } catch {}
}

// ─── STANDALONE TRANSCRIPTION ─────────────────────────────────────────────────
function openStandaloneTranscription() {
  state._pendingCallFile = null;
  document.getElementById('modal-title').innerHTML = '🎙️ Transcribe Call';
  document.getElementById('modal-body').innerHTML = `
    <div id="call-logger-content">
      <input type="file" id="audio-upload-standalone" accept="audio/*,.mp3,.mp4,.m4a,.wav,.webm" style="display:none" onchange="handleStandaloneUpload()" />
      <div style="display:flex;flex-direction:column;gap:10px">
        <div><div class="field-label" style="margin-bottom:4px">Company name <span style="font-weight:400;color:var(--text3)">(optional)</span></div>
          <input id="standalone-company" placeholder="e.g. ABC Plumbing" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" /></div>
        <button class="btn btn-primary" style="justify-content:center;width:100%" onclick="document.getElementById('audio-upload-standalone').click()">📁 Upload recording</button>
        <div style="font-size:11px;color:var(--text3);text-align:center">MP3, MP4, M4A, WAV supported</div>
      </div>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>`;
  document.getElementById('modal').style.display = 'flex';
}

async function handleStandaloneUpload() {
  const file = document.getElementById('audio-upload-standalone')?.files[0];
  if (!file) return;
  const companyName = document.getElementById('standalone-company')?.value.trim() || 'Unknown';
  await processCallRecordingWithFile(null, file, companyName);
}

async function processCallRecordingWithFile(companyId, file, companyNameOverride) {
  const c = companyId ? state.contacts.find(x => x.id === companyId) : null;
  const companyName = c?.name || companyNameOverride || 'Unknown';
  const callType = state._selectedCallType || 'general';

  document.getElementById('call-logger-content').innerHTML = `
    <div style="padding:24px 8px">
      <div id="transcribe-status" style="font-size:13px;font-weight:600;color:var(--text);margin-bottom:12px;text-align:center">Processing...</div>
      <div style="background:var(--bg3);border-radius:99px;height:8px;overflow:hidden"><div id="transcribe-bar" style="height:100%;width:0%;background:var(--blue);border-radius:99px;transition:width 0.4s ease"></div></div>
      <div id="transcribe-elapsed" style="font-size:11px;color:var(--text3);text-align:center;margin-top:8px">0s</div>
    </div>`;

  state.transcribing = true;
  try {
    const cacheKey = `transcript_${file.name}_${file.size}_${file.lastModified}`;
    let transcript = localStorage.getItem(cacheKey);
    if (transcript) { document.getElementById('transcribe-status').textContent = 'Using cached transcript...'; }
    else {
      const { url: whisperUrl, key: whisperKey } = await fetch('/api/transcribe').then(r => r.json());
      document.getElementById('transcribe-status').textContent = 'Uploading...';
      document.getElementById('transcribe-bar').style.width = '5%';
      const uploadRes = await fetch(`${whisperUrl}/transcribe`, { method: 'POST', headers: { 'Authorization': `Bearer ${whisperKey}`, 'Content-Type': 'application/octet-stream' }, body: file });
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadData.detail || uploadData.error}`);
      const { job_id } = uploadData;
      document.getElementById('transcribe-status').textContent = 'Transcribing...';
      document.getElementById('transcribe-bar').style.width = '10%';
      const t0 = Date.now();
      while (true) {
        await new Promise(r => setTimeout(r, 3000));
        const statusData = await fetch(`${whisperUrl}/status/${job_id}`, { headers: { 'Authorization': `Bearer ${whisperKey}` } }).then(r => r.json());
        if (statusData.status === 'error') throw new Error(statusData.error || 'Transcription failed');
        if (statusData.status === 'done') { transcript = statusData.transcript; break; }
        const elapsed = Math.round((Date.now() - t0) / 1000);
        document.getElementById('transcribe-bar').style.width = `${Math.min(90, (elapsed/180)*90)}%`;
        document.getElementById('transcribe-elapsed').textContent = `${elapsed}s`;
      }
      try { localStorage.setItem(cacheKey, transcript); } catch {}
    }
    document.getElementById('transcribe-bar').style.width = '100%';
    document.getElementById('transcribe-status').textContent = 'Analyzing with AI...';
    const analysisRes = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ transcript, companyName, callType }) });
    const analysisJson = await analysisRes.json();
    if (!analysisRes.ok) throw new Error(analysisJson.error || 'Analysis failed');
    state.transcribing = false;
    showCallAnalysis(companyId || '__standalone__', transcript, analysisJson.analysis);
  } catch (e) {
    state.transcribing = false;
    document.getElementById('call-logger-content').innerHTML = `
      <div style="text-align:center;padding:20px">
        <div style="font-size:36px;margin-bottom:12px">❌</div>
        <div style="font-size:14px;font-weight:600;color:var(--red);margin-bottom:8px">Transcription failed</div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:16px">${e.message}</div>
        <button class="btn btn-primary" onclick="${companyId ? `openCallLogger('${companyId}')` : 'openStandaloneTranscription()'}">Try again</button>
      </div>`;
  }
}

// ─── QUEUE DRAG AND DROP ──────────────────────────────────────────────────────
let _dragQueueCompanyId = null;
function queueDragStart(e, id) { _dragQueueCompanyId = id; e.dataTransfer.effectAllowed = 'move'; setTimeout(() => { const el = document.getElementById(`qrow-${id}`); if (el) el.style.opacity = '0.4'; }, 0); }
function queueDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function queueDragEnd() { if (_dragQueueCompanyId) { const el = document.getElementById(`qrow-${_dragQueueCompanyId}`); if (el) el.style.opacity = ''; } }
async function queueDrop(e, targetId, queueId) {
  e.preventDefault();
  if (!_dragQueueCompanyId || _dragQueueCompanyId === targetId) return;
  const q = state.queues.find(q => q.id === queueId);
  if (!q) return;
  const from = q.companies.findIndex(c => c.id === _dragQueueCompanyId);
  const to = q.companies.findIndex(c => c.id === targetId);
  if (from === -1 || to === -1) return;
  const companies = [...q.companies];
  const [moved] = companies.splice(from, 1);
  companies.splice(to, 0, moved);
  q.companies = companies;
  _dragQueueCompanyId = null;
  renderMyQueue();
  fetch('/api/users?action=reorderqueue', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ queueId, companies }) }).catch(() => {});
}

function pickQueueToAdd(companyId) {
  if (state.queues.length === 0) { toast('Create a queue first', 'error'); return; }
  if (state.queues.length === 1) { addToQueue(companyId, state.queues[0].id); return; }
  const c = state.contacts.find(x => x.id === companyId);
  document.getElementById('modal-title').innerHTML = `Add to Queue — ${c?.name || ''}`;
  document.getElementById('modal-body').innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">${state.queues.map(q => `<button class="btn" style="justify-content:flex-start;padding:12px 16px" onclick="addToQueue('${companyId}','${q.id}');closeModal()"><span style="font-weight:600">${q.name}</span><span style="font-size:11px;color:var(--text3);margin-left:auto">${q.companies.length} companies</span></button>`).join('')}</div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancel</button>`;
  document.getElementById('modal').style.display = 'flex';
}

// ─── TEL: INTERCEPTOR ─────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="tel:"]');
  if (!link) return;
  e.preventDefault();
  const phone = link.href.replace('tel:', '').replace(/\D/g, '');
  const company = state.contacts.find(c => c.phone?.replace(/\D/g,'') === phone) || null;
  const proceed = () => {
    state.dialerCompany = company;
    if (company?.phone) navigator.clipboard.writeText(company.phone).catch(() => {});
    showView('dialer');
  };
  const upcoming = checkUpcomingDemo();
  if (upcoming) showDemoBlocker(upcoming, proceed);
  else proceed();
}, true);


// ─── PIPELINE LABELS ──────────────────────────────────────────────────────────
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function getPipelineStatuses() {
  const defaults = {
    hot_lead:      { label: 'Hot Lead',      color: '#f05252' },
    following_up:  { label: 'Following Up',  color: '#f5a623' },
    contacted:     { label: 'Contacted',     color: '#4f8ef7' },
    proposal_sent: { label: 'Proposal Sent', color: '#a78bfa' },
    closed:        { label: 'Closed',        color: '#3ecf8e' },
  };
  const statuses = {};
  for (const [k, v] of Object.entries(defaults)) statuses[k] = { ...v };
  if (state.pipelineLabels) {
    for (const [k, v] of Object.entries(state.pipelineLabels)) {
      if (typeof v === 'string') {
        if (statuses[k]) statuses[k].label = v;
      } else {
        if (statuses[k]) {
          if (v.label) statuses[k].label = v.label;
          if (v.color) statuses[k].color = v.color;
        } else {
          statuses[k] = { label: v.label || k, color: v.color || '#4f8ef7' };
        }
      }
    }
  }
  for (const s of Object.values(statuses)) s.bg = hexToRgba(s.color, 0.15);
  return statuses;
}

async function loadPipelineLabels() {
  try {
    const res = await fetch('/api/pipeline?action=labels', { headers: { Authorization: `Bearer ${state.token}` } });
    if (!res.ok) return;
    const { labels } = await res.json();
    if (labels) state.pipelineLabels = labels;
  } catch {}
}

const DEFAULT_PIPELINE_KEYS = new Set(['hot_lead','following_up','contacted','proposal_sent','closed']);

function openPipelineLabelEditor() {
  const statuses = getPipelineStatuses();
  const rowHtml = (key, { label, color }, isCustom) =>
    `<div id="label-row-${key}" style="display:flex;align-items:center;gap:10px">
      <input type="color" id="color-${key}" value="${color}" style="width:32px;height:32px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;padding:2px;background:var(--bg3)" />
      <input id="label-${key}" value="${label}" placeholder="Stage name" style="flex:1;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" />
      ${isCustom ? `<button onclick="document.getElementById('label-row-${key}').remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;flex-shrink:0">×</button>` : `<div style="width:28px"></div>`}
    </div>`;
  document.getElementById('modal-title').innerHTML = '✏️ Customize Pipeline Stages';
  document.getElementById('modal-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div style="font-size:13px;color:var(--text2)">Rename stages, change colors, or add up to 10 total. Default stages can't be removed.</div>
      <div id="label-rows" style="display:flex;flex-direction:column;gap:8px">
        ${Object.entries(statuses).map(([k, v]) => rowHtml(k, v, !DEFAULT_PIPELINE_KEYS.has(k))).join('')}
      </div>
      <button onclick="addPipelineLabelRow()" style="background:none;border:1px dashed var(--border2);border-radius:6px;padding:9px;color:var(--text2);cursor:pointer;font-size:13px;text-align:center;width:100%">+ Add Stage</button>
    </div>`;
  document.getElementById('modal-footer').innerHTML = `
    <button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" onclick="savePipelineLabels()">Save</button>`;
  document.getElementById('modal').style.display = 'flex';
}

function addPipelineLabelRow() {
  const rows = document.getElementById('label-rows');
  if (rows.children.length >= 10) { toast('Maximum 10 stages', 'error'); return; }
  const key = `custom_${Date.now()}`;
  const div = document.createElement('div');
  div.id = `label-row-${key}`;
  div.style.cssText = 'display:flex;align-items:center;gap:10px';
  div.innerHTML = `
    <input type="color" id="color-${key}" value="#4f8ef7" style="width:32px;height:32px;border:1px solid var(--border2);border-radius:4px;cursor:pointer;padding:2px;background:var(--bg3)" />
    <input id="label-${key}" value="" placeholder="Stage name" style="flex:1;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none" />
    <button onclick="this.parentElement.remove()" style="background:none;border:none;color:var(--red);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;flex-shrink:0">×</button>`;
  rows.appendChild(div);
}

async function savePipelineLabels() {
  const rows = document.getElementById('label-rows');
  const labels = {};
  for (const row of rows.children) {
    const key = row.id.replace('label-row-', '');
    const label = document.getElementById(`label-${key}`)?.value.trim();
    const color = document.getElementById(`color-${key}`)?.value || '#4f8ef7';
    if (!label) continue;
    labels[key] = { label, color };
  }
  try {
    await fetch('/api/pipeline', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ action: 'labels', labels }) });
    state.pipelineLabels = labels;
    toast('Stage labels saved ✓', 'success');
    closeModal();
    if (state.currentView === 'pipeline') renderPipeline();
    if (state.currentView === 'dashboard') renderDashboard();
  } catch { toast('Failed to save labels', 'error'); }
}

// ─── EMAIL COMPOSE ─────────────────────────────────────────────────────────────
state._emailNotes = [];

async function openEmailCompose(companyId, useCallContext = false) {
  const c = state.contacts.find(x => x.id === companyId);
  if (!c) return;
  if (!state.notes) state.notes = {};
  if (!state.notes[companyId]?.length) {
    try {
      const nr = await fetch(`/api/users?action=getnotes&companyId=${companyId}`, { headers: { Authorization: `Bearer ${state.token}` } });
      if (nr.ok) { const { notes: kv } = await nr.json(); state.notes[companyId] = kv; }
    } catch {}
  }
  if (useCallContext && state.lastCallContext) {
    const existing = state.notes[companyId] || [];
    if (!existing.find(n => n.text === state.lastCallContext))
      state.notes[companyId] = [{ text: state.lastCallContext, date: 'Current call', type: 'call_analysis' }, ...existing];
  }
  document.getElementById('modal-title').innerHTML = `✉️ Email — ${c.name}`;
  document.getElementById('modal-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;padding:4px 0">
      <div style="font-size:12px;font-weight:700;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Choose email type</div>
      ${EMAIL_TEMPLATES.map(t => `
        <button onclick="applyEmailTemplate('${companyId}','${t.id}')" style="text-align:left;background:var(--bg3);border:1px solid var(--border2);border-radius:8px;padding:12px 14px;cursor:pointer;width:100%">
          <div style="font-size:13px;font-weight:600;color:var(--text)">${t.name}</div>
          <div style="font-size:12px;color:var(--text3);margin-top:3px">${t.description}</div>
        </button>`).join('')}
    </div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Close</button>`;
  document.getElementById('modal').style.display = 'flex';
}

async function generateDemoEmail() {
  const meta = state._demoEmailMeta;
  if (!meta) return;
  const { companyId, templateId, contactEmail, firstName, callDate } = meta;
  const c = state.contacts.find(x => x.id === companyId);
  const senderName = state.user?.name || '[Your Name]';
  const isFullDemo = templateId === 'full_demo';
  const ta = 'width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none';

  const attendees  = document.getElementById('demo-attendees')?.value.trim() || '';
  const covered    = document.getElementById('demo-covered')?.value.trim() || '';
  const pkg        = document.getElementById('demo-package')?.value.trim() || '';
  const clientAsk  = document.getElementById('demo-client-ask')?.value.trim() || '';
  const docSent    = document.getElementById('demo-doc-sent')?.value.trim() || '';

  document.getElementById('modal-body').innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text2);font-size:13px"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Writing email...</div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="applyEmailTemplate('${companyId}','${templateId}')">← Back</button>`;

  try {
    // Case studies — try org links first, then auto-discover from ollyolly.com
    const orgLinks = state.orgSettings?.resourceLinks || [];
    let csAccent   = orgLinks.find(l => /accent/i.test(l))    || '';
    let csForte    = orgLinks.find(l => /forte/i.test(l))     || '';
    let csGreenoak = orgLinks.find(l => /green|oak/i.test(l)) || '';

    if (!csAccent || !csForte || !csGreenoak) {
      try {
        const ooRes = await fetch('/api/scrape?action=oo-resources', { headers: { Authorization: `Bearer ${state.token}` } }).then(r => r.json());
        const urls = [...(ooRes.resourceUrls || []), ...(ooRes.allUrls || [])];
        const find = (...kws) => urls.find(u => kws.some(kw => u.toLowerCase().includes(kw))) || '';
        if (!csAccent)   csAccent   = find('accent', 'awning');
        if (!csForte)    csForte    = find('forte', 'remodel');
        if (!csGreenoak) csGreenoak = find('greenoak', 'green-oak', 'roofing');
        // Generic fallback: find any case study / results page
        const fallback = find('case-stud', 'result', 'client-stor', 'success');
        if (!csAccent)   csAccent   = fallback || 'https://www.ollyolly.com';
        if (!csForte)    csForte    = fallback || 'https://www.ollyolly.com';
        if (!csGreenoak) csGreenoak = fallback || 'https://www.ollyolly.com';
      } catch {
        csAccent   = csAccent   || 'https://www.ollyolly.com';
        csForte    = csForte    || 'https://www.ollyolly.com';
        csGreenoak = csGreenoak || 'https://www.ollyolly.com';
      }
    }

    const caseStudies = `Available Olly Olly case studies — if client asked for resources, include the most relevant one in the email body with its link. Write it naturally ("Here's one we did with a similar contractor: [link]"), not as a bullet list.
- Accent Awnings (CA, awning installation): page 3 → #1 San Diego + #2 Orange County in ~90 days | ${csAccent}
- Forte Builders (UT, remodeling/GC): couldn't rank for specific services → top 3 across multiple cities | ${csForte}
- GreenOak Exteriors (VA, roofing): nearly invisible → top 3 across DC metro | ${csGreenoak}
Include whichever fits the prospect's industry. Keep the link in the email body as-is (rep will fill in [paste X link] before sending if needed).`;

    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({
      system: `You write post-demo follow-up emails for Olly Olly sales reps. Match this style EXACTLY:

EXAMPLE (full demo, rep recommending Growth Essentials):
---
Hey Don,

Great talking with you, Judy, and Cameron this morning! Love that you guys are a family operation.

You mentioned wanting to know more about who we are and how we work. Quick version: we've been doing this for home service contractors for a while now. We're not a big corporate thing — we actually work one-on-one with our clients and stick around to make sure the work we do turns into calls. No "set it and forget it" nonsense.

I recommend the Growth Essentials package at $600/month. You guys are solid at what you do, but your Google visibility is all over the place. One month you're getting calls, the next month it's crickets. That package gets you consistent, which means consistent lead flow. For that, we manage your website, your Google listings, and your reviews — which leads to more visibility on Google, and more calls.

Liz Williams
National Account Executive
Olly Olly
---

RULES — non-negotiable:
- SHORT: 3-4 paragraphs max, each 1-3 sentences
- Start with "Hey [First Name]," not "Hi" or "Hello"
- Second line: warm specific opener referencing who was on the call + one real observation
- Address their specific ask directly, plainly
- Package paragraph: name it, price it, give ONE reason it fits THEIR specific situation using their actual words, then what it does in plain English
- No corporate words: no "leverage", "synergy", "circle back", "moving forward", "touch base", "reach out"
- No filler: no "I hope this finds you well", no "as per our conversation", no "please don't hesitate"
- Sign off is JUST: [Name] / National Account Executive / Olly Olly — nothing else
- NEVER say Olly Olly works with businesses in their area unless told
- Use the actual call date — do NOT say "yesterday" unless that's literally the date`,
      messages: [{ role: 'user', content: `Write a ${isFullDemo ? 'post-full-demo follow-up' : 'partial demo follow-up (they didn\'t finish the demo)'} email.

Rep: ${senderName}
Prospect first name: ${firstName || '[First Name]'}
Company: ${c?.name || ''}
Call date: ${callDate || 'recent'}

What the rep filled in:
- Who was present: ${attendees || '(not provided)'}
- What was covered in the demo: ${covered || '(not provided)'}
- Package recommended + price: ${pkg || '(not provided)'}
- What the client asked about or wanted: ${clientAsk || '(not provided)'}
- Document sent: ${docSent || 'none'}

${caseStudies}

${isFullDemo
  ? `This was a full demo. Write a follow-up that:
1. Opens with the call date reference + names everyone who was there + one specific warm observation
2. If they asked for info about OO, answer it casually (1-2 sentences — who OO is, how they work)
3. Recommends the package with their specific situation as the reason + what it does in one sentence
4. If they asked for a case study/resources, reference the most relevant one by name + result`
  : `This demo got cut short. Write a follow-up that:
1. Opens warmly referencing what you DID cover
2. Teases the 2-3 most valuable things they didn't get to see (heat map, website analysis, pricing/setup fee waiver)
3. Soft ask to finish — 20-30 min is all it takes`}

Return ONLY JSON: { "subject": "...", "body": "..." }. Body uses plain \\n, no markdown, no bullet points.` }],
      max_tokens: 600,
    })});
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    let subject = '', body = '';
    try { const p = JSON.parse(text.replace(/```json|```/g,'').trim()); subject = p.subject || ''; body = p.body || text; }
    catch { subject = isFullDemo ? `Great talking today, ${firstName || '[First Name]'}` : `Picking up where we left off, ${firstName || '[First Name]'}`; body = text; }

    state._emailImages = [];
    document.getElementById('modal-body').innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="field-label" style="margin-bottom:4px">To</div><input id="email-to" value="${contactEmail}" placeholder="recipient@example.com" style="${ta}" /></div>
      <div><div class="field-label" style="margin-bottom:4px">Subject</div><input id="email-subject" value="${subject.replace(/"/g,'&quot;')}" style="${ta}" /></div>
      <div><div class="field-label" style="margin-bottom:4px">Body</div><textarea id="email-body" style="${ta};min-height:300px;font-family:inherit;resize:vertical;line-height:1.6">${body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea></div>
    </div>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="applyEmailTemplate('${companyId}','${templateId}')">← Back</button>
      <button class="btn btn-sm" onclick="copyEmailDraft()">📋 Copy</button>
      <button class="btn btn-sm" onclick="openMailto()">↗ Open in Gmail</button>
      <button class="btn btn-primary btn-sm" onclick="sendEmail('${companyId}')">Send</button>`;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px">Failed: ${e.message}</div>`;
    document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="applyEmailTemplate('${companyId}','${templateId}')">← Back</button>`;
  }
}

async function generateEmailDraft(companyId) {
  const c = state.contacts.find(x => x.id === companyId);
  const displayNotes = state._emailNotes || [];
  const checked = [...document.querySelectorAll('.note-check:checked')];
  const selectedNotes = checked.map(cb => displayNotes[parseInt(cb.dataset.idx)]).filter(Boolean);
  const tone = document.getElementById('email-tone')?.value || 'professional';
  const instructions = document.getElementById('email-instructions')?.value?.trim() || '';
  const toneMap = { professional:'professional and polished', casual:'casual and friendly', consultative:'consultative and expert', direct:'direct and concise — no fluff', warm:'warm and relationship-focused' };
  const notesContext = selectedNotes.length > 0 ? `\n\nNotes:\n${selectedNotes.map(n => `[${n.date}]\n${n.text}`).join('\n\n---\n\n')}` : '';

  document.getElementById('modal-body').innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text2);font-size:13px"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Drafting...</div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>`;

  try {
    const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({
      system: `You write sales follow-up emails for Olly Olly, an SEO agency selling to home service contractors. Tone: ${toneMap[tone] || 'professional'}. Return ONLY a JSON object with "subject" and "body" fields.`,
      messages: [{ role: 'user', content: `${instructions}\n\nCompany: ${c.name}\nStage: ${c.masterStage || c.stage}\nLast contacted: ${c.lastContacted}${notesContext}` }],
      max_tokens: 1000,
    })});
    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    let subject = '', body = '';
    try { const parsed = JSON.parse(text.replace(/```json|```/g,'').trim()); subject = parsed.subject||''; body = parsed.body||text; }
    catch { const m = text.match(/Subject:\s*(.+)/i); subject = m ? m[1].trim() : 'Following up'; body = text.replace(/Subject:\s*.+\n?/i,'').trim(); }
    const ta2 = 'width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none';
    document.getElementById('modal-body').innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="field-label" style="margin-bottom:4px">To</div><input id="email-to" placeholder="recipient@example.com" style="${ta2}" /></div>
      <div><div class="field-label" style="margin-bottom:4px">Subject</div><input id="email-subject" value="${subject.replace(/"/g,'&quot;')}" style="${ta2}" /></div>
      <div><div class="field-label" style="margin-bottom:4px">Body</div><textarea id="email-body" style="${ta2};min-height:220px;font-family:inherit;resize:vertical;line-height:1.6">${body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea></div>
    </div>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>
      <button class="btn btn-sm" onclick="copyEmailDraft()">📋 Copy</button>
      <button class="btn btn-sm" onclick="openMailto()">↗ Open in Gmail</button>
      <button class="btn btn-primary btn-sm" onclick="sendEmail('${companyId}')">Send</button>`;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px">Failed: ${e.message}</div>`;
    document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>`;
  }
}

async function sendEmail(companyId) {
  const to = document.getElementById('email-to')?.value.trim();
  const subject = document.getElementById('email-subject')?.value.trim();
  const body = document.getElementById('email-body')?.value.trim();
  if (!to) { toast('Enter a recipient email address', 'error'); return; }
  if (!subject) { toast('Enter a subject line', 'error'); return; }
  if (!body) { toast('Email body is empty', 'error'); return; }
  const btn = document.querySelector('#modal-footer .btn-primary');
  if (btn) { btn.textContent = 'Sending...'; btn.disabled = true; }
  try {
    const res = await fetch('/api/calendar?action=send-email', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ to, subject, body, images: state._emailImages || [] }) });
    const data = await res.json();
    if (data.needsConnect) { if (confirm('Gmail permission needed. Reconnect Google?')) connectGoogleCalendar(); if (btn) { btn.textContent = 'Send'; btn.disabled = false; } return; }
    if (!res.ok) throw new Error(data.error || 'Send failed');
    toast('Email sent ✓', 'success');
    if (companyId && companyId !== '__standalone__') {
      fetch('/api/users?action=savenote', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ companyId, text: `Email sent to ${to}\nSubject: ${subject}\n\n${body}`, type: 'email' }) }).catch(() => {});
    }
    closeModal();
  } catch (e) { toast('Failed: ' + e.message, 'error'); if (btn) { btn.textContent = 'Send'; btn.disabled = false; } }
}

async function applyEmailTemplate(companyId, templateId) {
  const c = state.contacts.find(x => x.id === companyId);
  const template = EMAIL_TEMPLATES.find(t => t.id === templateId);
  if (!c || !template) return;

  const ta = 'width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 12px;color:var(--text);font-size:13px;outline:none';
  document.getElementById('modal-body').innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text2);font-size:13px"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Drafting with AI...</div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>`;

  const notes = (state.notes?.[companyId] || []).slice(0, 5).map(n => n.text).join('\n---\n');

  // ── DEMO FOLLOW-UP TEMPLATES ────────────────────────────────────────────────
  if (templateId === 'full_demo' || templateId === 'partial_demo') {
    try {
      // Always re-fetch notes fresh for demo templates — don't use stale cache
      try {
        const nr = await fetch(`/api/users?action=getnotes&companyId=${companyId}`, { headers: { Authorization: `Bearer ${state.token}` } });
        if (nr.ok) { const { notes: kv } = await nr.json(); if (!state.notes) state.notes = {}; state.notes[companyId] = kv || []; }
      } catch {}

      const contactIds = await fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${companyId}/associations/contacts`, Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({}));
      const firstContactId = (contactIds.results || [])[0]?.id;
      const contactDetail = firstContactId ? await fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/contacts/${firstContactId}?properties=firstname,lastname,email`, Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({})) : {};
      const firstName = contactDetail?.properties?.firstname || '';
      const contactEmail = contactDetail?.properties?.email || '';

      // Build notes context — prioritize transcripts over call body notes
      const allNotes = (state.notes?.[companyId] || []).slice(0, 15);
      const transcriptNotes = allNotes.filter(n => n.type === 'call_transcript' || n.type === 'call_analysis');
      const otherNotes = allNotes.filter(n => n.type !== 'call_transcript' && n.type !== 'call_analysis');
      const savedNotes = [
        ...transcriptNotes.map(n => `[${n.date} · TRANSCRIPT]\n${n.text}`),
        ...otherNotes.map(n => `[${n.date}${n.type ? ' · ' + n.type : ''}]\n${n.text}`),
      ].join('\n---\n');

      // If this is the company from the last analyzed call, use that transcript
      const sessionTranscript = (state.lastCallCompanyId === companyId && state.lastCallContext)
        ? `[Current session transcript]\n${state.lastCallContext}` : '';

      // Get the most recent call date from HubSpot for accurate date reference
      let mostRecentCallDate = state.lastCallDate || '';
      let hsCallBody = '';
      try {
        const assocRes = await fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${companyId}/associations/calls?limit=50`, Authorization: `Bearer ${state.token}` } }).then(r => r.json());
        const callIds = (assocRes.results || []).map(r => r.id);
        if (callIds.length) {
          const batchRes = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/calls/batch/read', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ inputs: callIds.slice(0, 25).map(id => ({ id })), properties: ['hs_call_body', 'hs_timestamp'] }) }).then(r => r.json());
          const sorted = (batchRes.results || []).sort((a, b) => (b.properties.hs_timestamp || 0) - (a.properties.hs_timestamp || 0));
          if (sorted[0]?.properties.hs_timestamp && !mostRecentCallDate) {
            mostRecentCallDate = new Date(+sorted[0].properties.hs_timestamp).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });
          }
          const PLACEHOLDER = /call logged via olly olly/i;
          hsCallBody = sorted
            .filter(c => c.properties.hs_call_body && !PLACEHOLDER.test(c.properties.hs_call_body))
            .slice(0, 3)
            .map(c => `[HubSpot call note · ${new Date(+c.properties.hs_timestamp).toLocaleDateString()}]\n${c.properties.hs_call_body}`)
            .join('\n---\n');
        }
      } catch {}

      // Also fetch HubSpot engagement notes (where coaching notes + manual notes live)
      let hsNoteBody = '';
      try {
        const noteAssocRes = await fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${companyId}/associations/notes?limit=20`, Authorization: `Bearer ${state.token}` } }).then(r => r.json());
        const noteIds = (noteAssocRes.results || []).map(r => r.id);
        if (noteIds.length) {
          const noteBatchRes = await fetch('/api/hubspot', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-HubSpot-Path': '/crm/v3/objects/notes/batch/read', 'X-HubSpot-Method': 'POST', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({ inputs: noteIds.slice(0, 10).map(id => ({ id })), properties: ['hs_note_body', 'hs_timestamp'] }) }).then(r => r.json());
          hsNoteBody = (noteBatchRes.results || [])
            .filter(n => n.properties.hs_note_body)
            .sort((a, b) => (b.properties.hs_timestamp || 0) - (a.properties.hs_timestamp || 0))
            .slice(0, 5)
            .map(n => `[HubSpot note · ${new Date(+n.properties.hs_timestamp).toLocaleDateString()}]\n${n.properties.hs_note_body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`)
            .join('\n---\n');
        }
      } catch {}

      const allNotesCtx = [sessionTranscript, savedNotes, hsNoteBody, hsCallBody].filter(Boolean).join('\n---\n');
      const debugInfo = `KV notes: ${(state.notes?.[companyId] || []).length} | HubSpot notes: ${hsNoteBody ? hsNoteBody.split('---').length : 0} | Transcript: ${sessionTranscript ? 'yes' : 'no'}`;

      // Extract demo details from call notes
      let extracted = { attendees: '', covered: '', package: '', clientAsk: '' };
      if (allNotesCtx) {
        const extractRes = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({
          system: `Extract specific details from sales call notes and coaching scorecards. Return only a JSON object, no explanation. Notes may be formatted as HTML coaching scorecards — extract info from the section labels and score notes. Be specific.`,
          messages: [{ role: 'user', content: `Extract from these notes. Notes may include coaching scorecards with section labels (Intro, Setting the Demo, Website Situation, etc.) and freeform notes.\n\nNotes:\n${allNotesCtx.slice(0, 3000)}\n\nReturn JSON:\n- "attendees": who was on the call — look for names, owner, spouse, partner, family mentions\n- "covered": what was shown — look for mentions of SERP, GBP, website, pricing, heat map, social, reviews, citations\n- "package": package and price — look for Growth Essentials/Strategic Advantage/Elite Expansion + dollar amounts\n- "clientAsk": what they were interested in or asked about — look for questions, requests, pain points mentioned in notes` }],
          max_tokens: 300,
        })});
        const extractData = await extractRes.json();
        try { extracted = JSON.parse((extractData.content?.[0]?.text || '{}').replace(/```json|```/g,'').trim()); } catch {}
      }

      const toStr = v => Array.isArray(v) ? v.join(', ') : (v ? String(v) : '');
      extracted.attendees  = toStr(extracted.attendees);
      extracted.covered    = toStr(extracted.covered);
      extracted.package    = toStr(extracted.package);
      extracted.clientAsk  = toStr(extracted.clientAsk);
      const hasExtracted = extracted.attendees || extracted.covered || extracted.package || extracted.clientAsk;
      state._demoEmailMeta = { companyId, templateId, contactEmail, firstName, callDate: mostRecentCallDate };

      // Show first 600 chars of notes so rep can fill in manually if extraction missed things
      const notesPreview = allNotesCtx.slice(0, 600).replace(/</g,'&lt;').replace(/>/g,'&gt;');

      document.getElementById('modal-body').innerHTML = `
        <div style="display:flex;flex-direction:column;gap:14px">
          <div style="font-size:12px;color:var(--text3)">${hasExtracted ? 'Pulled from call — verify anything missing.' : 'Extraction came up blank — fill in from the notes below.'}</div>
          ${allNotesCtx ? `<details style="background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:8px 10px">
            <summary style="font-size:11px;color:var(--text2);cursor:pointer;font-weight:600">📋 Notes found (${debugInfo})</summary>
            <div style="font-size:11px;color:var(--text3);margin-top:8px;white-space:pre-wrap;line-height:1.5;max-height:140px;overflow-y:auto">${notesPreview}${allNotesCtx.length > 600 ? '…' : ''}</div>
          </details>` : `<div style="font-size:11px;color:var(--amber);padding:6px 10px;background:var(--bg3);border-radius:6px">⚠️ No notes found (${debugInfo}) — fill in from memory.</div>`}
          <div>
            <div class="field-label" style="margin-bottom:4px">Who was present?</div>
            <input id="demo-attendees" value="${(extracted.attendees || '').replace(/"/g,'&quot;')}" placeholder="e.g. John (owner), wife Sarah" style="${ta}" />
          </div>
          <div>
            <div class="field-label" style="margin-bottom:4px">What did you go over?</div>
            <textarea id="demo-covered" placeholder="e.g. live SERP, GBP audit, website gaps, pricing" style="${ta};min-height:60px;font-family:inherit;resize:vertical">${(extracted.covered || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
          </div>
          <div>
            <div class="field-label" style="margin-bottom:4px">Package + price?</div>
            <input id="demo-package" value="${(extracted.package || '').replace(/"/g,'&quot;')}" placeholder="e.g. Growth Essentials at $600/mo" style="${ta}" />
          </div>
          <div>
            <div class="field-label" style="margin-bottom:4px">What did they ask about or want?</div>
            <textarea id="demo-client-ask" placeholder="e.g. wanted to know who else we work with, asked about reviews" style="${ta};min-height:60px;font-family:inherit;resize:vertical">${(extracted.clientAsk || '').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
          </div>
          <div>
            <div class="field-label" style="margin-bottom:4px">Was a doc sent?</div>
            <input id="demo-doc-sent" value="" placeholder="e.g. PandaDoc proposal (leave blank if none)" style="${ta}" />
          </div>
        </div>`;
      document.getElementById('modal-footer').innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>
        <button class="btn btn-primary btn-sm" onclick="generateDemoEmail()">Generate Email →</button>`;
    } catch (e) {
      document.getElementById('modal-body').innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px">Failed: ${e.message}</div>`;
      document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>`;
    }
    return;
  }
  // ── END DEMO TEMPLATES ──────────────────────────────────────────────────────
  const website = c.rawProps?.website || c.rawProps?.domain || '';

  try {
    // Step 1: scrape + contact fetch in parallel (fast)
    const scrapeParams = new URLSearchParams({ name: c.name, city: c.city || '', state: c.state || '', ...(website ? { website } : {}) });
    const [contactRes, scrape] = await Promise.all([
      fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/companies/${companyId}/associations/contacts`, Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({})),
      fetch(`/api/scrape?${scrapeParams}`, { headers: { Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({})),
    ]);

    // Build research context from real data
    const researchCtx = [
      scrape.gbpCategory ? `GBP category: ${scrape.gbpCategory}` : '',
      scrape.gbpFound ? `GBP reviews: ${scrape.gbpReviews ?? 0} reviews${scrape.gbpRating ? ', ' + scrape.gbpRating + ' stars' : ''}` : 'GBP listing: not found on Google',
      scrape.schemaType ? `Website schema type: ${scrape.schemaType}` : '',
      scrape.title ? `Website title: ${scrape.title}` : '',
      scrape.description ? `Website description: ${scrape.description}` : '',
    ].filter(Boolean).join('\n');

    // Compute effective website before AI call so prompt is accurate
    const effectiveWebsite = website || scrape.gbpWebsite || '';

    // Step 2: contact details + AI in parallel (scrape already done)
    const contactIds = (contactRes.results || []).map(a => a.id);
    const [aiRes, contactDetail] = await Promise.all([
      fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` }, body: JSON.stringify({
        system: `You are an SEO research assistant for Olly Olly, an agency that sells digital marketing to home service contractors. Generate specific, credible findings based on the actual data provided — no placeholders, no brackets, no made-up facts.

Framing: findings should highlight what is NOT actively being done for this business — as if someone should be managing it but isn't. The subtext is "your current marketing setup isn't doing this for you." This makes the prospect wonder why, not feel attacked. Do not pitch Olly Olly. Do not mention competitors by name. Just surface the gap naturally.`,
        messages: [{ role: 'user', content: `Company: ${c.name}\nLocation: ${[c.city, c.state].filter(Boolean).join(', ') || 'Unknown'}\n${effectiveWebsite ? 'Website: ' + effectiveWebsite : 'No website found'}\n${notes ? 'Notes:\n' + notes + '\n' : ''}\nResearch data:\n${researchCtx || 'No data available — infer from company name and location only'}\n\nReturn ONLY a JSON object:\n- "keyword": exact service type for local search — derive from GBP category or schema type above (e.g. "plumber", "roofing contractor", "HVAC repair")\n- "finding1": completes "One thing I noticed was ___" — Focus on something that looks like it's NOT being actively managed: stale review activity, profile not updated recently, no recent photos or posts, category gaps, incomplete services list. Phrase it as "it looks like [X] hasn't been actively kept up" or "it doesn't look like [X] is being managed." Use real numbers from the data. Always use "you/your/you guys" — never "the business" or "the company." Sound like a real person who just Googled them. Example: "your Google profile hasn't had any new photos added in a while — competitors showing up above you are way more active on there, which Google tends to favor."\n- "finding2": completes "I also came across ___" — Focus on a visibility gap a good marketing partner should have caught but didn't: missing service or city pages on the website, not ranking in nearby neighborhoods, social presence gone quiet, reviews coming in sporadically instead of consistently. Phrase it as something being left on the table. Same rules: "you/your/you guys", casual, specific, not AI-sounding. Example: "that your site doesn't really have pages built out for the surrounding areas you guys work in — that's usually why a business isn't showing up when someone a few towns over searches."` }],
        max_tokens: 450,
      })}),
      contactIds.length
        ? fetch('/api/hubspot', { headers: { 'X-HubSpot-Path': `/crm/v3/objects/contacts/${contactIds[0]}?properties=firstname,lastname,email`, Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({}))
        : Promise.resolve({}),
    ]);

    const firstName = contactDetail?.properties?.firstname || '';
    const contactEmail = contactDetail?.properties?.email || '';

    const data = await aiRes.json();
    const text = data.content?.[0]?.text || '';
    let finding1 = '[INSERT FINDING #1]', finding2 = '[INSERT FINDING #2]', keyword = '';
    try {
      const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
      finding1 = parsed.finding1 || finding1;
      finding2 = parsed.finding2 || finding2;
      keyword = parsed.keyword || '';
    } catch {}
    const bestKeyword = scrape.gbpCategory || scrape.schemaType || keyword;
    const serpQuery = [bestKeyword, c.city, c.state].filter(Boolean).join(' ');

    const senderName = state.user?.name || '[Your Name]';
    const subject = template.subject.replace('[Company Name]', c.name);
    const body = template.body
      .replace(/\[SENDER_NAME\]/g, senderName)
      .replace('[First Name]', firstName || '[First Name]')
      .replace('[Company Name]', c.name)
      .replace('[FINDING_1]', finding1)
      .replace('[FINDING_2]', finding2);

    const websiteThumb = effectiveWebsite ? `https://image.thum.io/get/width/600/${effectiveWebsite}` : '';
    const serpThumb = serpQuery ? `https://image.thum.io/get/width/600/https://www.bing.com/search?q=${encodeURIComponent(serpQuery)}` : '';
    state._emailImages = [
      ...(websiteThumb ? [{ url: websiteThumb, label: `Website: ${effectiveWebsite}` }] : []),
      ...(serpThumb ? [{ url: serpThumb, label: `Search results: "${serpQuery}"` }] : []),
    ];

    const screenshotsHtml = (websiteThumb || serpThumb) ? `
      <div>
        <div class="field-label" style="margin-bottom:8px">Screenshots</div>
        <div style="display:flex;flex-direction:column;gap:10px">
          ${websiteThumb ? `<div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Website — ${effectiveWebsite}</div>
            <img src="${websiteThumb}" style="width:100%;border-radius:6px;border:1px solid var(--border2);display:block" loading="lazy">
          </div>` : ''}
          ${serpThumb ? `<div>
            <div style="font-size:11px;color:var(--text3);margin-bottom:4px">SERP — "${serpQuery}"</div>
            <img src="${serpThumb}" style="width:100%;border-radius:6px;border:1px solid var(--border2);display:block" loading="lazy">
          </div>` : ''}
        </div>
      </div>` : '';

    document.getElementById('modal-body').innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="field-label" style="margin-bottom:4px">To</div><input id="email-to" value="${contactEmail}" placeholder="recipient@example.com" style="${ta}" /></div>
      <div><div class="field-label" style="margin-bottom:4px">Subject</div><input id="email-subject" value="${subject.replace(/"/g,'&quot;')}" style="${ta}" /></div>
      <div><div class="field-label" style="margin-bottom:4px">Body</div><textarea id="email-body" style="${ta};min-height:300px;font-family:inherit;resize:vertical;line-height:1.6">${body.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea></div>
      ${screenshotsHtml}
    </div>`;
    document.getElementById('modal-footer').innerHTML = `
      <button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>
      <button class="btn btn-sm" onclick="copyEmailDraft()">📋 Copy</button>
      <button class="btn btn-sm" onclick="openMailto()">↗ Open in Gmail</button>
      <button class="btn btn-primary btn-sm" onclick="sendEmail('${companyId}')">Send</button>`;
  } catch (e) {
    document.getElementById('modal-body').innerHTML = `<div style="color:var(--red);padding:20px;font-size:13px">Failed: ${e.message}</div>`;
    document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="openEmailCompose('${companyId}')">← Back</button>`;
  }
}

function copyEmailDraft() {
  const s = document.getElementById('email-subject')?.value || '';
  const b = document.getElementById('email-body')?.value || '';
  navigator.clipboard.writeText(`Subject: ${s}\n\n${b}`).then(() => toast('Copied ✓', 'success')).catch(() => toast('Copy failed', 'error'));
}

function openMailto() {
  const to = document.getElementById('email-to')?.value || '';
  const subject = document.getElementById('email-subject')?.value || '';
  const body = document.getElementById('email-body')?.value || '';
  window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
}

// ─── COMPANY TABLE VIEW (sortable + column picker) ────────────────────────────
state.contactsSort = state.contactsSort || { field: 'score', dir: 'desc' };
state.userColumns = null;
state.allHubSpotProps = null;

const EMAIL_TEMPLATES = [
  {
    id: 'cadiah',
    name: 'GK Email',
    description: 'First touch — research-based findings about their online presence',
    subject: 'Quick thought on [Company Name]',
    body: `Hi [First Name],\n\nHope you're doing well.\n\nMy name is [SENDER_NAME] and I work with Olly Olly. I recently connected with [Employee Name] on your team and wanted to reach out personally.\n\nWhile doing some research on your online presence, I noticed a few things that caught my attention and thought it made sense to introduce myself rather than make assumptions about what may or may not already be in the works.\n\nOne thing I noticed was [FINDING_1]\n\nI also came across [FINDING_2]\n\nI could be completely off base, which is why I'd love to get your perspective. In 15-20 minutes I can show you exactly what homeowners in your area are seeing when they search — and whether the calls are landing where they should be.\n\nDo you have some time this week or next?\n\nLooking forward to connecting.\n\nBest,\n[SENDER_NAME]\nNational Account Executive\nOlly Olly\n\nP.S. If there is someone else on the team who oversees your marketing efforts, feel free to point me in the right direction.`,
  },
  {
    id: 'full_demo',
    name: 'Full Demo Follow-up',
    description: 'Ran the complete demo — reinforce value, drive the next step',
  },
  {
    id: 'partial_demo',
    name: 'Partial Demo Follow-up',
    description: 'Demo got cut short — warm follow-up to finish the conversation',
  },
];

const DEFAULT_COLUMNS = [
  { name: 'name', label: 'Company' },
  { name: 'contact_phone_number__', label: 'Phone' },
  { name: 'subscription_status', label: 'Stage' },
  { name: 'timezone_', label: 'Timezone' },
  { name: 'lead_source', label: 'Lead Source' },
  { name: 'score', label: 'AI Score' },
  { name: 'daysSince', label: 'Days Since' },
];

function getUserColumns() {
  if (state.userColumns) return state.userColumns;
  try { const s = localStorage.getItem('oo_columns'); if (s) { state.userColumns = JSON.parse(s); return state.userColumns; } } catch {}
  state.userColumns = DEFAULT_COLUMNS;
  return state.userColumns;
}

function getContactValue(c, colName) {
  if (colName === 'score') return c.score ?? '';
  if (colName === 'daysSince') return c.daysSince === 999 ? 'Never' : (c.daysSince + 'd ago');
  if (colName === 'masterStage' || colName === 'subscription_status') return c.masterStage || c.rawProps?.subscription_status || '';
  if (colName === 'name') return c.name;
  if (colName === 'phone' || colName === 'contact_phone_number__') return c.phone || '';
  if (colName === 'city') return c.city || '';
  if (colName === 'state') return c.state || '';
  if (colName === 'timezone_') return c.timezone || '';
  if (colName === 'lead_source') return c.leadSource || '';
  if (colName === 'industry') return c.industry || '';
  return c.rawProps?.[colName] || '';
}

function setContactsSortCol(col) {
  const cur = state.contactsSort || { field: 'score', dir: 'desc' };
  state.contactsSort = { field: col, dir: cur.field === col && cur.dir === 'desc' ? 'asc' : 'desc' };
  state.contactsPage = 0;
  renderContacts();
}

function setContactsSort(val) {
  const [field, dir] = val.split(':');
  state.contactsSort = { field, dir };
  state.contactsPage = 0;
  renderContacts();
}

async function openColumnPicker() {
  document.getElementById('modal-title').innerHTML = '⚙️ Configure Columns';
  document.getElementById('modal-body').innerHTML = `<div style="display:flex;align-items:center;gap:10px;padding:20px;color:var(--text2);font-size:13px;justify-content:center"><div style="width:16px;height:16px;border:2px solid var(--blue);border-top-color:transparent;border-radius:50%;animation:spin 0.8s linear infinite;flex-shrink:0"></div>Loading properties...</div>`;
  document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancel</button>`;
  document.getElementById('modal').style.display = 'flex';
  if (!state.allHubSpotProps) {
    try {
      const res = await fetch('/api/hubspot?action=properties', { headers: { Authorization: `Bearer ${state.token}` } }).then(r => r.json()).catch(() => ({ properties: [] }));
      state.allHubSpotProps = res.properties || [];
    } catch {}
  }
  const current = getUserColumns().slice();
  const currentNames = new Set(current.map(c => c.name));
  window._colCurrent = current;
  window._colCurrentNames = currentNames;
  window.renderColPicker = () => {
    document.getElementById('modal-body').innerHTML = `<div style="display:flex;flex-direction:column;gap:12px">
      <div><div class="field-label" style="margin-bottom:6px">Active columns</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${current.map(c => `<div style="display:flex;align-items:center;gap:4px;padding:4px 8px;background:var(--blue-dim);border:1px solid var(--blue);border-radius:6px;font-size:12px">${c.label}${c.name!=='name'?`<button onclick="window._removeCol('${c.name}')" style="background:none;border:none;cursor:pointer;color:var(--text3);font-size:14px;padding:0;line-height:1">×</button>`:''}</div>`).join('')}
        </div></div>
      <div><div class="field-label" style="margin-bottom:4px">Add property</div>
        <input id="prop-search" placeholder="Search..." oninput="document.getElementById('prop-list').innerHTML=window._renderProps(this.value)" style="width:100%;background:var(--bg3);border:1px solid var(--border2);border-radius:6px;padding:7px 12px;color:var(--text);font-size:13px;outline:none;margin-bottom:8px" />
        <div id="prop-list" style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px">${window._renderProps('')}</div>
      </div></div>`;
    document.getElementById('modal-footer').innerHTML = `<button class="btn btn-ghost btn-sm" onclick="closeModal()">Cancel</button><button class="btn btn-sm" onclick="state.userColumns=[...DEFAULT_COLUMNS];localStorage.removeItem('oo_columns');closeModal();renderContacts()">Reset</button><button class="btn btn-primary btn-sm" onclick="window._saveCols()">Save</button>`;
  };
    window._renderProps = (search) => {
    const filtered = (state.allHubSpotProps||[]).filter(p => !search || p.label.toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase())).slice(0,50);
    return filtered.map(p => {
      const added = currentNames.has(p.name);
      const safeLabel = p.label.replace(/'/g, "\'");
      const btn = added ? '<span style="font-size:11px;color:var(--green)">✓</span>' : '<button class="btn btn-sm" style="font-size:11px;padding:2px 8px" onclick="window._addCol(\'' + p.name + '\',\'' + safeLabel + '\')">Add</button>';
      return '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 8px;background:var(--bg3);border-radius:4px"><div><span style="font-size:12px;color:var(--text)">' + p.label + '</span><span style="font-size:10px;color:var(--text3);margin-left:6px">' + p.name + '</span></div>' + btn + '</div>';
    }).join('') || '<div style="font-size:12px;color:var(--text3);padding:8px">No matches</div>';
  };;
  window._addCol = (name, label) => { if (!currentNames.has(name)) { current.push({ name, label }); currentNames.add(name); } window.renderColPicker(); };
  window._removeCol = (name) => { const i = current.findIndex(c => c.name === name); if (i !== -1) { current.splice(i,1); currentNames.delete(name); } window.renderColPicker(); };
  window._saveCols = () => { state.userColumns = [...current]; localStorage.setItem('oo_columns', JSON.stringify(state.userColumns)); closeModal(); renderContacts(); toast('Columns saved ✓', 'success'); };
  window.renderColPicker();
}

