/**
 * admin.js — owner-only payment activation panel, protected by the ADMIN_KEY env var.
 *
 * Open it at:   https://<your-backend>/admin?key=YOUR_ADMIN_KEY
 * Without the exact ADMIN_KEY every route returns 403 — there is no other way in (it is NOT
 * tied to a logged-in user; it's a separate secret only you know). If ADMIN_KEY is unset, the
 * panel is fully closed (denies everyone).
 *
 *   GET  /admin            → the HTML panel (key required)
 *   GET  /admin/payments   → { pending:[...], activated:[...last 20] }
 *   POST /admin/activate   → activate a pending payment (sets plan + billing end, marks done)
 *   POST /admin/reject     → reject a pending payment (clears it; user falls back to paywall)
 */
import express from 'express';
import { timingSafeEqual } from 'crypto';
import { getAccountById, getAccountByEmail, activatePlan, deactivatePlan, deleteAccount, planOf, listAllAccounts, entitlement, trialActive, trialDaysLeft, grantComp } from './auth.js';
import { loadPayments, savePayments, deletePaymentsFor } from './paymentsStore.js';
import { deleteUser, loadUser }          from './store.js';
import { listComp, addComp, removeComp } from './compAccess.js';
import { dayKey }                        from './time.js';
import { PLANS }                         from './plans.config.js';

export const adminRouter = express.Router();

// Constant-time key check. No key set → deny everyone.
function adminKeyOk(req) {
  const key = process.env.ADMIN_KEY || '';
  if (!key) return false;
  const got = String(req.query.key || req.headers['x-admin-key'] || (req.body && req.body.key) || '');
  if (got.length !== key.length) return false;
  try { return timingSafeEqual(Buffer.from(got), Buffer.from(key)); } catch { return false; }
}
const deny = (res) => res.status(403);

// ── The HTML panel ───────────────────────────────────────────────────────────────
adminRouter.get('/admin', (req, res) => {
  if (!adminKeyOk(req)) {
    return res.status(403).type('html').send(
      '<body style="font-family:system-ui;background:#0a0f1a;color:#fca5a5;padding:40px"><h2>403 — Forbidden</h2><p>Invalid or missing admin key. Open this page as <code>/admin?key=YOUR_ADMIN_KEY</code>.</p></body>');
  }
  res.type('html').send(PANEL_HTML);
});

adminRouter.get('/admin/payments', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  const all = await loadPayments();
  const pending   = all.filter((p) => p.status === 'pending').sort((a, b) => a.createdAt - b.createdAt);
  const activated = all.filter((p) => p.status === 'activated').sort((a, b) => (b.activatedAt || 0) - (a.activatedAt || 0)).slice(0, 20);
  const deactivated = all.filter((p) => p.status === 'deactivated').sort((a, b) => (b.deactivatedAt || 0) - (a.deactivatedAt || 0)).slice(0, 10);
  res.json({ pending, activated, deactivated });
});

// ALL signed-up users (not just payments) — the owner wants to see everyone who registered, with plan +
// trial + registration date. Test/QA accounts (@example.com) are hidden so real signups aren't buried.
adminRouter.get('/admin/accounts', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const all = await listAllAccounts();
    const users = (all || [])
      .filter((a) => a && a.email && !/@example\.com$/i.test(a.email))
      .map((a) => {
        let plan = 'free', trialLeft = null;
        try { plan = planOf(a); } catch {}
        try { const e = entitlement(a); trialLeft = e?.trial?.daysLeft ?? null; } catch {}
        return { email: a.email, plan, tier: a.subscription?.tier || '—', trialLeft, createdAt: a.createdAt || 0 };
      })
      .sort((x, y) => (y.createdAt || 0) - (x.createdAt || 0));
    res.json({ users, total: users.length });
  } catch (e) { console.error('[admin] accounts error:', e.message); res.status(500).json({ error: 'accounts_failed' }); }
});

adminRouter.post('/admin/activate', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const all = await loadPayments();
    const pay = all.find((p) => p.id === req.body?.id && p.status === 'pending');
    if (!pay) return res.status(404).json({ error: 'not_found_or_already_done' });
    const acc = await getAccountById(pay.userId);
    if (!acc) return res.status(404).json({ error: 'account_not_found' });
    await activatePlan(acc, pay.plan, pay.billingPeriod);   // plan + billingPeriodEnd; gating takes effect now
    pay.status = 'activated'; pay.activatedAt = Date.now();
    await savePayments(all);
    console.log(`[admin] ACTIVATED  payment=${pay.id}  user=${pay.userId}  email=${pay.email ?? '—'}  plan=${pay.plan}  period=${pay.billingPeriod}`);
    res.json({ ok: true });
  } catch (e) { console.error('[admin] activate error:', e.message); res.status(500).json({ error: 'activate_failed' }); }
});

adminRouter.post('/admin/reject', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const all = await loadPayments();
    const pay = all.find((p) => p.id === req.body?.id && p.status === 'pending');
    if (!pay) return res.status(404).json({ error: 'not_found_or_already_done' });
    pay.status = 'rejected'; pay.rejectedAt = Date.now();
    await savePayments(all);
    console.log(`[admin] REJECTED  payment=${pay.id}  user=${pay.userId}  email=${pay.email ?? '—'}`);
    res.json({ ok: true });
  } catch (e) { console.error('[admin] reject error:', e.message); res.status(500).json({ error: 'reject_failed' }); }
});

// Manually DEACTIVATE a paid user's plan (revoke access). Target by { userId } (from a row)
// or { email } (free-text box). Reverts the account to free immediately and marks that user's
// activated payment(s) as 'deactivated' so they move to the "deaktiviert" list.
adminRouter.post('/admin/deactivate', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const body = req.body || {};
    let acc = null;
    if (body.userId)     acc = await getAccountById(body.userId);
    else if (body.email) acc = await getAccountByEmail(String(body.email).trim());
    if (!acc) return res.status(404).json({ error: 'account_not_found' });

    await deactivatePlan(acc);   // subscription → free; planOf() returns 'free' on next request

    // Move this user's activated payment(s) into the deactivated list (history + clears the row).
    const all = await loadPayments();
    let changed = false;
    for (const p of all) {
      if (p.userId === acc.id && p.status === 'activated') { p.status = 'deactivated'; p.deactivatedAt = Date.now(); changed = true; }
    }
    if (changed) await savePayments(all);

    console.log(`[admin] DEACTIVATED  user=${acc.id}  email=${acc.email ?? '—'}  plan_now=${planOf(acc)}`);
    res.json({ ok: true, email: acc.email, plan: planOf(acc) });
  } catch (e) { console.error('[admin] deactivate error:', e.message); res.status(500).json({ error: 'deactivate_failed' }); }
});

// Read-only: look up an account's CURRENT plan by email — so you can verify a deactivation
// actually took (returns 'free' once revoked). Does NOT change anything. Note: deactivation
// revokes the PLAN; the login account intentionally remains (the person can re-subscribe).
adminRouter.get('/admin/account', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const acc = await getAccountByEmail(String(req.query.email || '').trim());
    if (!acc) return res.json({ found: false });
    const s = acc.subscription || {};
    res.json({
      found: true, email: acc.email, id: acc.id, plan: planOf(acc),
      billingPeriodEnd: s.billingPeriodEnd || null, deactivatedAt: s.deactivatedAt || null,
    });
  } catch (e) { console.error('[admin] account lookup error:', e.message); res.status(500).json({ error: 'lookup_failed' }); }
});

// PERMANENTLY delete an account (admin action) — separate from deactivate. Removes the login
// record + frees the email (auth store), the progress profile (store), and all payment records
// (paymentsStore) for this user id only. Idempotent/graceful: a missing email → 404, never a
// crash. After this the email can sign up again from scratch and the old login cannot sign in.
adminRouter.post('/admin/delete-account', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const body = req.body || {};
    let acc = null;
    if (body.userId)     acc = await getAccountById(body.userId);
    else if (body.email) acc = await getAccountByEmail(String(body.email).trim());
    if (!acc) return res.status(404).json({ error: 'account_not_found' });

    const id = acc.id, email = acc.email;
    await deleteAccount(acc);            // 1) login + emailIndex (so signup sees it as brand-new)
    await deleteUser(id);               // 2) progress/assessment profile keyed by user id
    const paymentsRemoved = await deletePaymentsFor(id);  // 3) all payment records for this user

    console.log(`[admin] DELETED ACCOUNT  user=${id}  email=${email ?? '—'}  paymentsRemoved=${paymentsRemoved}`);
    res.json({ ok: true, email, deleted: true, paymentsRemoved });
  } catch (e) { console.error('[admin] delete-account error:', e.message); res.status(500).json({ error: 'delete_failed' }); }
});

// ── Comp access — the standing whitelist (server/compAccess.js) ─────────────────────
// Emails here get their plan the instant they sign up (auth.js createAccount), or immediately
// if they already have an account (applied here via grantComp). Never a payment, never a request.

adminRouter.get('/admin/comp', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const list = await listComp();
    // Cross-reference each whitelist entry with the real account so the panel shows whether the
    // grant has actually landed (registered yet? current plan matches?), not just the intent.
    const rows = await Promise.all(list.map(async (c) => {
      const acc = await getAccountByEmail(c.email);
      return { ...c, registered: !!acc, currentPlan: acc ? planOf(acc) : null };
    }));
    rows.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    res.json({ rows });
  } catch (e) { console.error('[admin] comp list error:', e.message); res.status(500).json({ error: 'comp_list_failed' }); }
});

adminRouter.post('/admin/comp/add', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const body = req.body || {};
    const email = String(body.email || '').trim();
    const plan  = PLANS[body.plan] ? body.plan : 'elite';
    const note  = String(body.note || '').slice(0, 200);
    const entry = await addComp({ email, plan, note });
    // If the account already exists, apply the grant RIGHT NOW — no need to wait for a re-signup.
    const acc = await getAccountByEmail(email);
    if (acc) await grantComp(acc, plan);
    console.log(`[admin] COMP ADD  email=${email}  plan=${plan}  appliedNow=${!!acc}`);
    res.json({ ok: true, entry, appliedNow: !!acc });
  } catch (e) { console.error('[admin] comp add error:', e.message); res.status(e.code || 500).json({ error: e.message || 'comp_add_failed' }); }
});

adminRouter.post('/admin/comp/remove', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const email = String(req.body?.email || '').trim();
    const removed = await removeComp(email);
    // Only revoke access if it actually came FROM comp — never touch a real paid plan that
    // happens to share the email (e.g. they later paid for real on top of an old comp grant).
    const acc = await getAccountByEmail(email);
    if (acc?.subscription?.comp) await deactivatePlan(acc);
    console.log(`[admin] COMP REMOVE  email=${email}  wasListed=${removed}  revokedAccess=${!!acc?.subscription?.comp}`);
    res.json({ ok: true, removed });
  } catch (e) { console.error('[admin] comp remove error:', e.message); res.status(500).json({ error: 'comp_remove_failed' }); }
});

// ── App health dashboard — signups, trials, live training volume, revenue at a glance ──
adminRouter.get('/admin/health-stats', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const DAY = 86400000;
    const now = Date.now();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayMs = todayStart.getTime();
    const weekAgo  = now - 7 * DAY;
    const monthAgo = now - 30 * DAY;

    const accounts = (await listAllAccounts()).filter((a) => a?.email && !/@example\.com$/i.test(a.email));
    const signupsToday = accounts.filter((a) => (a.createdAt || 0) >= todayMs).length;
    const signupsWeek  = accounts.filter((a) => (a.createdAt || 0) >= weekAgo).length;
    const activeTrials = accounts.filter((a) => trialActive(a)).length;
    const paidUsers    = accounts.filter((a) => planOf(a) !== 'free').length;
    const compUsers     = accounts.filter((a) => a.subscription?.comp).length;

    // Live-interview volume today: bounded by the same 500-account cap listAllAccounts enforces,
    // so this stays cheap even as the user base grows into that range.
    const today = dayKey();
    let interviewsToday = 0, minutesToday = 0;
    await Promise.all(accounts.map(async (a) => {
      try {
        const p = await loadUser(a.id);
        interviewsToday += (p.sessions || []).filter((s) => (s.date || 0) >= todayMs).length;
        if (p.liveUsage?.day === today) minutesToday += (p.liveUsage.sec || 0) / 60;
      } catch { /* skip an unreadable profile — never fail the whole dashboard for one user */ }
    }));

    const payments = await loadPayments();
    const revenueMonthEGP = payments
      .filter((p) => p.status === 'activated' && (p.activatedAt || 0) >= monthAgo)
      .reduce((sum, p) => sum + (p.amountEGP || 0), 0);
    const pendingCount = payments.filter((p) => p.status === 'pending').length;

    res.json({
      totalUsers: accounts.length, signupsToday, signupsWeek,
      activeTrials, paidUsers, compUsers, pendingPayments: pendingCount,
      interviewsToday, minutesToday: Math.round(minutesToday),
      revenueMonthEGP,
    });
  } catch (e) { console.error('[admin] health-stats error:', e.message); res.status(500).json({ error: 'health_stats_failed' }); }
});

// ── User detail drill-down — one screen instead of guessing from the accounts table ──
adminRouter.get('/admin/user-detail', async (req, res) => {
  if (!adminKeyOk(req)) return deny(res).json({ error: 'forbidden' });
  try {
    const acc = await getAccountByEmail(String(req.query.email || '').trim());
    if (!acc) return res.json({ found: false });
    const p = await loadUser(acc.id);
    const allPayments = await loadPayments();
    const payments = allPayments.filter((x) => x.userId === acc.id).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const sessions = (p.sessions || []).slice(-15).reverse().map((s) => ({
      date: s.date, level: s.level, bossId: s.bossId, wpm: s.wpm, fillers: s.fillers,
      rank: s.rank, verdict: s.verdict, jobLabel: s.jobLabel,
    }));
    const weakTop = Object.entries(p.weakLog || {})
      .map(([ruleId, v]) => ({ ruleId, ltName: v.ltName || ruleId, count: (v.errCounts || []).reduce((sum, e) => sum + (e.count || 0), 0) }))
      .filter((w) => w.count > 0).sort((a, b) => b.count - a.count).slice(0, 5);

    res.json({
      found: true,
      email: acc.email, id: acc.id, createdAt: acc.createdAt,
      plan: planOf(acc), comp: !!acc.subscription?.comp,
      trialActive: trialActive(acc), trialDaysLeft: trialActive(acc) ? trialDaysLeft(acc) : 0,
      referredBy: acc.referredBy || null,
      placement: p.placement || null,
      dailyStreakDays: (p.dailyDays || []).length,
      sessionCount: (p.sessions || []).length,
      sessions, weakTop, payments,
    });
  } catch (e) { console.error('[admin] user-detail error:', e.message); res.status(500).json({ error: 'user_detail_failed' }); }
});

// Self-contained panel. Reads the key from its own URL; values rendered via textContent (no XSS).
const PANEL_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OMNI-PERFORM · Admin</title><style>
body{font-family:system-ui,sans-serif;background:#0a0f1a;color:#e2e8f0;margin:0;padding:16px}
h1{font-size:18px;color:#fbbf24;margin:0 0 4px} h2{font-size:13px;color:#94a3b8;letter-spacing:.1em;margin:24px 0 8px}
table{width:100%;border-collapse:collapse;font-size:12.5px} th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #1e293b;vertical-align:middle}
th{color:#64748b;font-weight:600;font-size:10.5px;letter-spacing:.05em} code{color:#fbbf24;font-weight:700;font-size:13px}
button{cursor:pointer;border:none;border-radius:6px;padding:7px 12px;font-weight:700;font-size:11px;margin-right:6px}
input,select{padding:7px 9px;border-radius:6px;border:1px solid #334155;background:#0a0f1a;color:#e2e8f0;font-size:12px}
.act{background:#10b981;color:#04130c} .rej{background:#1e293b;color:#fca5a5;border:1px solid #ef4444}
.del{background:#dc2626;color:#fff;border:1px solid #fecaca;font-weight:800}
.muted{color:#64748b} .empty{color:#64748b;font-style:italic;padding:12px 6px}
.tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0;border-bottom:1px solid #1e293b;padding-bottom:12px}
.tabbtn{background:#111827;color:#94a3b8;border:1px solid #1e293b;padding:8px 14px;border-radius:8px;font-size:11.5px;font-weight:700;margin:0}
.tabbtn.active{background:#1e3a5f;color:#60a5fa;border-color:#3b82f6}
.tabpane{display:none} .tabpane.active{display:block}
.stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-top:6px}
.stat{background:#0f1626;border:1px solid #1e293b;border-radius:10px;padding:12px}
.stat .n{font-size:22px;font-weight:900;color:#60a5fa} .stat .l{font-size:9.5px;color:#64748b;letter-spacing:.05em;margin-top:3px}
.card{background:#0f1626;border:1px solid #1e293b;border-radius:10px;padding:12px;margin-top:10px}
</style></head><body>
<h1>⚙️ OMNI-PERFORM — Admin</h1>
<div class="muted" style="font-size:11px">Verify-first bei Zahlungen: aktiviere erst, nachdem du das Geld per Vodafone Cash bestätigt hast (Referenz-Code abgleichen).</div>
<div id="err" style="color:#fca5a5;font-size:12px;margin-top:8px"></div>
<div id="ok" style="color:#34d399;font-size:12.5px;margin-top:8px;font-weight:700"></div>

<div class="tabs">
  <button class="tabbtn active" data-tab="pay" onclick="showTab('pay')">💳 Zahlungen</button>
  <button class="tabbtn" data-tab="comp" onclick="showTab('comp')">🎁 Comp-Zugang</button>
  <button class="tabbtn" data-tab="health" onclick="showTab('health')">📊 App-Gesundheit</button>
  <button class="tabbtn" data-tab="users" onclick="showTab('users')">👤 Nutzer</button>
  <button class="tabbtn" data-tab="mission" onclick="showTab('mission')">🎯 Mission & Feedback</button>
</div>

<div id="tab-pay" class="tabpane active">
  <div style="padding:10px 12px;border:1px solid #ef4444;border-radius:8px;background:rgba(239,68,68,0.06)">
    <div style="font-size:11px;color:#fca5a5;margin-bottom:2px">Plan manuell deaktivieren (per E-Mail) — entzieht den bezahlten Zugang sofort.</div>
    <div style="font-size:10px;color:#64748b;margin-bottom:6px">Hinweis: Das entzieht nur den bezahlten Plan (→ FREE). Das Login-Konto bleibt bestehen — die Person kann erneut abonnieren. Mit „Status prüfen" siehst du den aktuellen Plan.</div>
    <input id="deacEmail" type="email" placeholder="email@beispiel.com" style="width:48%;max-width:230px">
    <button id="statBtn" class="act" style="background:#334155;color:#e2e8f0" onclick="checkStatus()">Status prüfen</button>
    <button id="deacBtn" class="rej" onclick="deactivateByEmail()">Deaktivieren</button>
    <button id="delBtn" class="del" onclick="delByEmail()">Konto löschen</button>
    <div style="font-size:10px;color:#fca5a5;margin-top:6px"><b>Deaktivieren</b> = Plan → FREE, Login bleibt. &nbsp;|&nbsp; <b style="color:#fff;background:#dc2626;padding:0 4px;border-radius:3px">Konto löschen</b> = alles weg, E-Mail wird frei (unwiderruflich).</div>
  </div>
  <h2>OFFEN / PENDING</h2><div id="pending"></div>
  <h2>ZULETZT AKTIVIERT (20)</h2><div id="activated"></div>
  <h2>ZULETZT DEAKTIVIERT (10)</h2><div id="deactivated"></div>
</div>

<div id="tab-comp" class="tabpane">
  <div class="card" style="border-color:#3b82f6;background:rgba(59,130,246,0.06)">
    <div style="font-size:11px;color:#93c5fd;margin-bottom:8px">E-Mail zur Whitelist hinzufügen — bekommt den gewählten Plan SOFORT, ohne zu bezahlen und ohne zu fragen. Ist die Person schon registriert, gilt es sofort; sonst beim nächsten Signup.</div>
    <input id="compEmail" type="email" placeholder="email@beispiel.com" style="width:34%;max-width:200px">
    <select id="compPlan"><option value="elite">Elite</option><option value="basic">Basic</option></select>
    <input id="compNote" type="text" placeholder="Notiz (optional)" style="width:26%;max-width:170px">
    <button class="act" onclick="addCompEmail()">Hinzufügen</button>
  </div>
  <h2>WHITELIST</h2><div id="compList"></div>
</div>

<div id="tab-health" class="tabpane">
  <div class="stats" id="healthStats"><div class="empty">Lädt…</div></div>
</div>

<div id="tab-users" class="tabpane">
  <div class="card">
    <input id="userSearchEmail" type="email" placeholder="email@beispiel.com" style="width:48%;max-width:230px">
    <button class="act" onclick="loadUserDetail()">Details anzeigen</button>
  </div>
  <div id="userDetail"></div>
  <h2>ALLE NUTZER / ANMELDUNGEN (<span id="userCount">0</span>)</h2><div id="accounts"></div>
</div>

<div id="tab-mission" class="tabpane">
  <h2>EINSTELLUNGS-TRICHTER</h2><div id="placementFunnel"></div>
  <h2>ERFOLGE (HIRED)</h2><div id="hiresList"></div>
  <h2>FEEDBACK (letzte 100)</h2><div id="feedbackSummary"></div><div id="feedbackList"></div>
</div>

<script>
var KEY=new URLSearchParams(location.search).get('key')||'';
var loadedTabs={};
function fmtMoney(n){return Number(n||0).toLocaleString('de-DE')+' EGP';}
function fmtTime(t){if(!t)return '—';try{return new Date(t).toLocaleString('de-DE');}catch(e){return '';}}
function cell(txt){var td=document.createElement('td');td.textContent=txt;return td;}
function showOk(t){document.getElementById('ok').textContent=t;document.getElementById('err').textContent='';}
function showErr(t){document.getElementById('err').textContent=t;document.getElementById('ok').textContent='';}
function showTab(name){
  document.querySelectorAll('.tabpane').forEach(function(p){p.classList.remove('active');});
  document.querySelectorAll('.tabbtn').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===name);});
  document.getElementById('tab-'+name).classList.add('active');
  if(!loadedTabs[name]){
    loadedTabs[name]=true;
    if(name==='comp') loadComp();
    else if(name==='health') loadHealth();
    else if(name==='mission') loadMission();
  }
}
function load(){
  fetch('/admin/payments?key='+encodeURIComponent(KEY)).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();}).then(function(d){
    document.getElementById('err').textContent='';
    renderPending(d.pending||[]); renderActivated(d.activated||[]); renderDeactivated(d.deactivated||[]);
  }).catch(function(e){document.getElementById('err').textContent='Fehler beim Laden ('+e.message+') — Key korrekt?';});
  fetch('/admin/accounts?key='+encodeURIComponent(KEY)).then(function(r){return r.json();}).then(function(d){
    renderAccounts(d.users||[]); document.getElementById('userCount').textContent=(d.users||[]).length;
  }).catch(function(){});
}
// ── Comp access ──────────────────────────────────────────────────────────────
function loadComp(){
  fetch('/admin/comp?key='+encodeURIComponent(KEY)).then(function(r){return r.json();}).then(function(d){renderComp(d.rows||[]);})
    .catch(function(){document.getElementById('compList').innerHTML='<div class="empty">Fehler beim Laden.</div>';});
}
function renderComp(rows){
  var box=document.getElementById('compList');box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Noch niemand auf der Whitelist.</div>';return;}
  var t=document.createElement('table');
  t.innerHTML='<tr><th>E-Mail</th><th>Plan</th><th>Notiz</th><th>Registriert?</th><th>Aktueller Plan</th><th>Hinzugefügt</th><th></th></tr>';
  rows.forEach(function(c){
    var tr=document.createElement('tr');
    tr.appendChild(cell(c.email));
    tr.appendChild(cell(String(c.plan||'').toUpperCase()));
    tr.appendChild(cell(c.note||'—'));
    tr.appendChild(cell(c.registered?'Ja':'Noch nicht'));
    tr.appendChild(cell(c.currentPlan?String(c.currentPlan).toUpperCase():'—'));
    tr.appendChild(cell(fmtTime(c.addedAt)));
    var act=document.createElement('td');
    var rm=document.createElement('button');rm.className='rej';rm.textContent='Entfernen';
    rm.onclick=function(){if(confirm('Comp-Zugang für '+c.email+' entfernen? Falls aktiv, wird der Zugang sofort entzogen.'))removeCompEmail(c.email,rm);};
    act.appendChild(rm);tr.appendChild(act);
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function addCompEmail(){
  var email=(document.getElementById('compEmail').value||'').trim();
  var plan=document.getElementById('compPlan').value;
  var note=(document.getElementById('compNote').value||'').trim();
  if(!email){showErr('Bitte eine E-Mail eingeben.');return;}
  fetch('/admin/comp/add?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:KEY,email:email,plan:plan,note:note})})
    .then(function(r){return r.json();}).then(function(d){
      if(d&&d.ok){showOk('✅ '+email+' zur Whitelist hinzugefügt'+(d.appliedNow?' — Zugang ist bereits aktiv.':' — Zugang aktiviert sich beim nächsten Signup.'));document.getElementById('compEmail').value='';document.getElementById('compNote').value='';loadComp();}
      else{showErr('Fehlgeschlagen: '+((d&&d.error)||'?'));}
    }).catch(function(){showErr('Netzwerkfehler.');});
}
function removeCompEmail(email,btn){
  var label=btn.textContent;btn.disabled=true;btn.textContent='…';
  fetch('/admin/comp/remove?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:KEY,email:email})})
    .then(function(r){return r.json();}).then(function(d){
      btn.disabled=false;btn.textContent=label;
      if(d&&d.ok){showOk('🗑️ '+email+' von der Whitelist entfernt.');loadComp();}
      else{showErr('Fehlgeschlagen: '+((d&&d.error)||'?'));}
    }).catch(function(){btn.disabled=false;btn.textContent=label;showErr('Netzwerkfehler.');});
}
// ── App health ───────────────────────────────────────────────────────────────
function loadHealth(){
  fetch('/admin/health-stats?key='+encodeURIComponent(KEY)).then(function(r){return r.json();}).then(function(d){
    var tiles=[
      ['Nutzer gesamt',d.totalUsers],['Anmeldungen heute',d.signupsToday],['Anmeldungen (7 Tage)',d.signupsWeek],
      ['Aktive Trials',d.activeTrials],['Zahlende Nutzer',d.paidUsers],['Comp-Zugänge',d.compUsers],
      ['Offene Zahlungen',d.pendingPayments],['Interviews heute',d.interviewsToday],['Minuten trainiert heute',d.minutesToday],
      ['Umsatz (30 Tage)',fmtMoney(d.revenueMonthEGP)],
    ];
    var box=document.getElementById('healthStats');box.innerHTML='';
    tiles.forEach(function(t){
      var div=document.createElement('div');div.className='stat';
      var n=document.createElement('div');n.className='n';n.textContent=(t[1]==null?'—':t[1]);
      var l=document.createElement('div');l.className='l';l.textContent=t[0];
      div.appendChild(n);div.appendChild(l);box.appendChild(div);
    });
  }).catch(function(){document.getElementById('healthStats').innerHTML='<div class="empty">Fehler beim Laden.</div>';});
}
// ── User detail ──────────────────────────────────────────────────────────────
function loadUserDetail(){
  var email=(document.getElementById('userSearchEmail').value||'').trim();
  if(!email){showErr('Bitte eine E-Mail eingeben.');return;}
  var box=document.getElementById('userDetail');box.innerHTML='<div class="empty">Lädt…</div>';
  fetch('/admin/user-detail?key='+encodeURIComponent(KEY)+'&email='+encodeURIComponent(email)).then(function(r){return r.json();}).then(function(d){
    if(!d.found){box.innerHTML='<div class="empty">Kein Konto mit dieser E-Mail.</div>';return;}
    box.innerHTML='';
    var card=document.createElement('div');card.className='card';
    var head=document.createElement('div');head.style.cssText='font-size:13px;font-weight:700;color:#e2e8f0;margin-bottom:6px';
    head.textContent=d.email+'  ·  '+String(d.plan).toUpperCase()+(d.comp?' (COMP)':'')+(d.trialActive?'  ·  Trial: '+d.trialDaysLeft+' Tage übrig':'');
    card.appendChild(head);
    var meta=document.createElement('div');meta.style.cssText='font-size:11px;color:#94a3b8;line-height:1.8';
    meta.innerHTML='Registriert: '+fmtTime(d.createdAt)+'<br>Sitzungen gesamt: '+d.sessionCount+' · Trainings-Streak: '+d.dailyStreakDays+' Tage<br>Geworben von: '+(d.referredBy||'—');
    card.appendChild(meta);
    if(d.placement&&d.placement.status&&d.placement.status!=='none'){
      var pl=document.createElement('div');pl.style.cssText='margin-top:8px;font-size:11.5px;color:#93c5fd';
      pl.textContent='📌 Mission: '+d.placement.status.toUpperCase()+(d.placement.role?' · '+d.placement.role:'')+(d.placement.employer?' bei '+d.placement.employer:'');
      card.appendChild(pl);
    }
    box.appendChild(card);
    if(d.weakTop&&d.weakTop.length){
      var h=document.createElement('h2');h.textContent='SCHWÄCHEN (häufigste)';box.appendChild(h);
      var wt=document.createElement('table');wt.innerHTML='<tr><th>Regel</th><th>Anzahl Fehler</th></tr>';
      d.weakTop.forEach(function(w){var tr=document.createElement('tr');tr.appendChild(cell(w.ltName));tr.appendChild(cell(String(w.count)));wt.appendChild(tr);});
      box.appendChild(wt);
    }
    if(d.sessions&&d.sessions.length){
      var h2=document.createElement('h2');h2.textContent='LETZTE SITZUNGEN ('+d.sessions.length+')';box.appendChild(h2);
      var st=document.createElement('table');st.innerHTML='<tr><th>Datum</th><th>Niveau</th><th>WpM</th><th>Füllwörter</th><th>Ergebnis</th></tr>';
      d.sessions.forEach(function(s){var tr=document.createElement('tr');tr.appendChild(cell(fmtTime(s.date)));tr.appendChild(cell(s.level||'—'));tr.appendChild(cell(s.wpm==null?'—':String(s.wpm)));tr.appendChild(cell(s.fillers==null?'—':String(s.fillers)));tr.appendChild(cell(s.verdict||s.jobLabel||'—'));st.appendChild(tr);});
      box.appendChild(st);
    }
    if(d.payments&&d.payments.length){
      var h3=document.createElement('h2');h3.textContent='ZAHLUNGSHISTORIE';box.appendChild(h3);
      var pt=document.createElement('table');pt.innerHTML='<tr><th>Plan</th><th>Betrag</th><th>Status</th><th>Datum</th></tr>';
      d.payments.forEach(function(p){var tr=document.createElement('tr');tr.appendChild(cell(String(p.plan||'').toUpperCase()));tr.appendChild(cell(fmtMoney(p.amountEGP)));tr.appendChild(cell(p.status||'—'));tr.appendChild(cell(fmtTime(p.createdAt)));pt.appendChild(tr);});
      box.appendChild(pt);
    }
  }).catch(function(){box.innerHTML='<div class="empty">Netzwerkfehler.</div>';});
}
// ── Mission & feedback ───────────────────────────────────────────────────────
function loadMission(){
  fetch('/admin/placements?key='+encodeURIComponent(KEY)).then(function(r){return r.json();}).then(function(d){
    var box=document.getElementById('placementFunnel');box.innerHTML='';
    var stats=document.createElement('div');stats.className='stats';
    ['none','applying','interviewing','offer','hired','not_hired'].forEach(function(k){
      var div=document.createElement('div');div.className='stat';
      var n=document.createElement('div');n.className='n';n.textContent=String((d.funnel&&d.funnel[k])||0);
      var l=document.createElement('div');l.className='l';l.textContent=k.toUpperCase();
      div.appendChild(n);div.appendChild(l);stats.appendChild(div);
    });
    box.appendChild(stats);
    var hbox=document.getElementById('hiresList');hbox.innerHTML='';
    if(!d.hires||!d.hires.length){hbox.innerHTML='<div class="empty">Noch keine gemeldeten Erfolge.</div>';}
    else{
      var t=document.createElement('table');t.innerHTML='<tr><th>Nutzer</th><th>Rolle</th><th>Datum</th></tr>';
      d.hires.forEach(function(h){var tr=document.createElement('tr');tr.appendChild(cell(h.masked));tr.appendChild(cell(h.role||'—'));tr.appendChild(cell(fmtTime(h.at)));t.appendChild(tr);});
      hbox.appendChild(t);
    }
  }).catch(function(){document.getElementById('placementFunnel').innerHTML='<div class="empty">Fehler beim Laden.</div>';});
  fetch('/api/admin/feedback?key='+encodeURIComponent(KEY)).then(function(r){return r.json();}).then(function(d){
    var sum=document.getElementById('feedbackSummary');
    sum.innerHTML='';sum.style.cssText='font-size:11.5px;color:#94a3b8;margin-bottom:8px';
    sum.textContent='Insgesamt: '+(d.total||0)+' Einträge (letzte '+((d.entries||[]).length)+' unten)';
    var box=document.getElementById('feedbackList');box.innerHTML='';
    if(!d.entries||!d.entries.length){box.innerHTML='<div class="empty">Noch kein Feedback.</div>';return;}
    var t=document.createElement('table');t.innerHTML='<tr><th>Datum</th><th>Nutzer</th><th>Screen</th><th>Bewertung</th><th>Text</th></tr>';
    d.entries.forEach(function(e){var tr=document.createElement('tr');tr.appendChild(cell(fmtTime(e.timestamp)));tr.appendChild(cell(e.email||'—'));tr.appendChild(cell(e.screen||'—'));tr.appendChild(cell(e.rating==null?'—':String(e.rating)));tr.appendChild(cell(e.text||''));t.appendChild(tr);});
    box.appendChild(t);
  }).catch(function(){document.getElementById('feedbackList').innerHTML='<div class="empty">Fehler beim Laden.</div>';});
}
function renderAccounts(rows){
  var box=document.getElementById('accounts');box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Noch keine Nutzer.</div>';return;}
  var t=document.createElement('table');
  t.innerHTML='<tr><th>E-Mail</th><th>Plan</th><th>Tarif</th><th>Trial (Tage)</th><th>Registriert</th></tr>';
  rows.forEach(function(u){
    var tr=document.createElement('tr');
    tr.appendChild(cell(u.email));
    tr.appendChild(cell(String(u.plan||'free').toUpperCase()));
    tr.appendChild(cell(u.tier||'—'));
    tr.appendChild(cell(u.trialLeft==null?'—':String(u.trialLeft)));
    tr.appendChild(cell(fmtTime(u.createdAt)));
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function renderPending(rows){
  var box=document.getElementById('pending');box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Keine offenen Zahlungen.</div>';return;}
  var t=document.createElement('table');
  t.innerHTML='<tr><th>Code</th><th>User</th><th>Plan</th><th>Zeitraum</th><th>Betrag</th><th>Getippt am</th><th></th></tr>';
  rows.forEach(function(p){
    var tr=document.createElement('tr');
    var c=document.createElement('td');c.innerHTML='<code></code>';c.firstChild.textContent=p.referenceCode;tr.appendChild(c);
    tr.appendChild(cell(p.email||p.userId));
    tr.appendChild(cell((p.plan||'').toUpperCase()));
    tr.appendChild(cell(p.billingPeriod==='yearly'?'Jahr':'Monat'));
    tr.appendChild(cell(fmtMoney(p.amountEGP)));
    tr.appendChild(cell(fmtTime(p.createdAt)));
    var act=document.createElement('td');
    var b1=document.createElement('button');b1.className='act';b1.textContent='Aktivieren';b1.onclick=function(){doAction('/admin/activate',{id:p.id},b1);};
    var b2=document.createElement('button');b2.className='rej';b2.textContent='Ablehnen';b2.onclick=function(){doAction('/admin/reject',{id:p.id},b2);};
    act.appendChild(b1);act.appendChild(b2);tr.appendChild(act);
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function renderActivated(rows){
  var box=document.getElementById('activated');box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Noch keine.</div>';return;}
  var t=document.createElement('table');
  t.innerHTML='<tr><th>Code</th><th>User</th><th>Plan</th><th>Betrag</th><th>Aktiviert am</th><th></th></tr>';
  rows.forEach(function(p){
    var tr=document.createElement('tr');
    tr.appendChild(cell(p.referenceCode));
    tr.appendChild(cell(p.email||p.userId));
    tr.appendChild(cell((p.plan||'').toUpperCase()+' / '+(p.billingPeriod==='yearly'?'Jahr':'Monat')));
    tr.appendChild(cell(fmtMoney(p.amountEGP)));
    tr.appendChild(cell(fmtTime(p.activatedAt)));
    var act=document.createElement('td');
    var bd=document.createElement('button');bd.className='rej';bd.textContent='Deaktivieren';
    bd.onclick=function(){if(confirm('Plan für '+(p.email||p.userId)+' wirklich deaktivieren? Der Zugang wird sofort entzogen.'))deactivate({userId:p.userId},bd);};
    var dl=document.createElement('button');dl.className='del';dl.textContent='Konto löschen';
    dl.onclick=function(){delAccount({userId:p.userId},(p.email||p.userId),dl);};
    act.appendChild(bd);act.appendChild(dl);tr.appendChild(act);
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function renderDeactivated(rows){
  var box=document.getElementById('deactivated');box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Keine.</div>';return;}
  var t=document.createElement('table');
  t.innerHTML='<tr><th>User</th><th>Plan</th><th>Deaktiviert am</th></tr>';
  rows.forEach(function(p){
    var tr=document.createElement('tr');
    tr.appendChild(cell(p.email||p.userId));
    tr.appendChild(cell((p.plan||'').toUpperCase()));
    tr.appendChild(cell(fmtTime(p.deactivatedAt)));
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function doAction(path,payload,btn){
  var label=btn.textContent;btn.disabled=true;btn.textContent='…';
  fetch(path+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({key:KEY},payload))})
    .then(function(r){return r.json();}).then(function(d){if(d&&d.ok){load();}else{document.getElementById('err').textContent='Aktion fehlgeschlagen: '+((d&&d.error)||'?');btn.disabled=false;btn.textContent=label;}})
    .catch(function(e){document.getElementById('err').textContent='Netzwerkfehler.';btn.disabled=false;btn.textContent=label;});
}
function deactivate(payload,btn){
  var label=btn.textContent;btn.disabled=true;btn.textContent='…';
  fetch('/admin/deactivate?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({key:KEY},payload))})
    .then(function(r){return r.json();}).then(function(d){
      btn.disabled=false;btn.textContent=label;
      if(d&&d.ok){showOk('✅ '+(d.email||'')+' deaktiviert → Plan jetzt: '+String(d.plan||'free').toUpperCase());load();}
      else{showErr('Deaktivierung fehlgeschlagen: '+((d&&d.error)||'?'));}
    }).catch(function(){btn.disabled=false;btn.textContent=label;showErr('Netzwerkfehler.');});
}
function deactivateByEmail(){
  var email=(document.getElementById('deacEmail').value||'').trim();
  if(!email){showErr('Bitte eine E-Mail eingeben.');return;}
  if(!confirm('Plan für '+email+' wirklich deaktivieren? Der Zugang wird sofort entzogen.'))return;
  deactivate({email:email},document.getElementById('deacBtn'));
}
function delAccount(payload,email,btn){
  if(!confirm('KONTO PERMANENT LÖSCHEN: '+email+'  —  löscht das Login UND alle Daten und gibt die E-Mail wieder frei. Unwiderruflich. Fortfahren?'))return;
  var typed=prompt('Letzte Bestätigung — zum endgültigen Löschen die E-Mail eintippen ('+email+'):');
  if(typed===null)return;
  if(typed.trim().toLowerCase()!==String(email).trim().toLowerCase()){showErr('E-Mail stimmt nicht überein — Löschen abgebrochen.');return;}
  var label=btn.textContent;btn.disabled=true;btn.textContent='…';
  fetch('/admin/delete-account?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({key:KEY},payload))})
    .then(function(r){return r.json();}).then(function(d){
      btn.disabled=false;btn.textContent=label;
      if(d&&d.ok){showOk('🗑️ '+(d.email||email)+' PERMANENT gelöscht — E-Mail ist jetzt frei. Diese Person muss sich neu registrieren.');load();}
      else if(d&&d.error==='account_not_found'){showErr('Kein Konto mit dieser E-Mail (evtl. schon gelöscht).');}
      else{showErr('Löschen fehlgeschlagen: '+((d&&d.error)||'?'));}
    }).catch(function(){btn.disabled=false;btn.textContent=label;showErr('Netzwerkfehler.');});
}
function delByEmail(){
  var email=(document.getElementById('deacEmail').value||'').trim();
  if(!email){showErr('Bitte eine E-Mail eingeben.');return;}
  delAccount({email:email},email,document.getElementById('delBtn'));
}
function checkStatus(){
  var email=(document.getElementById('deacEmail').value||'').trim();
  if(!email){showErr('Bitte eine E-Mail eingeben.');return;}
  var btn=document.getElementById('statBtn');var label=btn.textContent;btn.disabled=true;btn.textContent='…';
  fetch('/admin/account?key='+encodeURIComponent(KEY)+'&email='+encodeURIComponent(email))
    .then(function(r){return r.json();}).then(function(d){
      btn.disabled=false;btn.textContent=label;
      if(d&&d.found){showOk('Status '+d.email+' → REGISTRIERT · Plan: '+String(d.plan).toUpperCase()+(d.plan==='free'?' (kein bezahlter Zugang)':' (aktiv)'));}
      else{showOk('Status '+email+' → NICHT REGISTRIERT (kein Konto — E-Mail ist frei).');}
    }).catch(function(){btn.disabled=false;btn.textContent=label;showErr('Netzwerkfehler.');});
}
load();
</script></body></html>`;
