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
import { getAccountById, activatePlan } from './auth.js';
import { loadPayments, savePayments }   from './paymentsStore.js';

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
  res.json({ pending, activated });
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

// Self-contained panel. Reads the key from its own URL; values rendered via textContent (no XSS).
const PANEL_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>OMNI-PERFORM · Zahlungen</title><style>
body{font-family:system-ui,sans-serif;background:#0a0f1a;color:#e2e8f0;margin:0;padding:16px}
h1{font-size:18px;color:#fbbf24;margin:0 0 4px} h2{font-size:13px;color:#94a3b8;letter-spacing:.1em;margin:24px 0 8px}
table{width:100%;border-collapse:collapse;font-size:12.5px} th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #1e293b;vertical-align:middle}
th{color:#64748b;font-weight:600;font-size:10.5px;letter-spacing:.05em} code{color:#fbbf24;font-weight:700;font-size:13px}
button{cursor:pointer;border:none;border-radius:6px;padding:7px 12px;font-weight:700;font-size:11px;margin-right:6px}
.act{background:#10b981;color:#04130c} .rej{background:#1e293b;color:#fca5a5;border:1px solid #ef4444}
.muted{color:#64748b} .empty{color:#64748b;font-style:italic;padding:12px 6px}
</style></head><body>
<h1>💳 Zahlungen — Aktivierung</h1>
<div class="muted" style="font-size:11px">Verify-first: aktiviere erst, nachdem du das Geld per Vodafone Cash bestätigt hast (Referenz-Code abgleichen).</div>
<div id="err" style="color:#fca5a5;font-size:12px;margin-top:8px"></div>
<h2>OFFEN / PENDING</h2><div id="pending"></div>
<h2>ZULETZT AKTIVIERT (20)</h2><div id="activated"></div>
<script>
var KEY=new URLSearchParams(location.search).get('key')||'';
function fmtMoney(n){return Number(n||0).toLocaleString('de-DE')+' EGP';}
function fmtTime(t){try{return new Date(t).toLocaleString('de-DE');}catch(e){return '';}}
function cell(txt){var td=document.createElement('td');td.textContent=txt;return td;}
function load(){
  fetch('/admin/payments?key='+encodeURIComponent(KEY)).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();}).then(function(d){
    document.getElementById('err').textContent='';
    renderPending(d.pending||[]); renderActivated(d.activated||[]);
  }).catch(function(e){document.getElementById('err').textContent='Fehler beim Laden ('+e.message+') — Key korrekt?';});
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
    var b1=document.createElement('button');b1.className='act';b1.textContent='Aktivieren';b1.onclick=function(){doAction('/admin/activate',p.id,b1);};
    var b2=document.createElement('button');b2.className='rej';b2.textContent='Ablehnen';b2.onclick=function(){doAction('/admin/reject',p.id,b2);};
    act.appendChild(b1);act.appendChild(b2);tr.appendChild(act);
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function renderActivated(rows){
  var box=document.getElementById('activated');box.innerHTML='';
  if(!rows.length){box.innerHTML='<div class="empty">Noch keine.</div>';return;}
  var t=document.createElement('table');
  t.innerHTML='<tr><th>Code</th><th>User</th><th>Plan</th><th>Betrag</th><th>Aktiviert am</th></tr>';
  rows.forEach(function(p){
    var tr=document.createElement('tr');
    tr.appendChild(cell(p.referenceCode));
    tr.appendChild(cell(p.email||p.userId));
    tr.appendChild(cell((p.plan||'').toUpperCase()+' / '+(p.billingPeriod==='yearly'?'Jahr':'Monat')));
    tr.appendChild(cell(fmtMoney(p.amountEGP)));
    tr.appendChild(cell(fmtTime(p.activatedAt)));
    t.appendChild(tr);
  });
  box.appendChild(t);
}
function doAction(path,id,btn){
  btn.disabled=true;btn.textContent='…';
  fetch(path+'?key='+encodeURIComponent(KEY),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:id,key:KEY})})
    .then(function(r){return r.json();}).then(function(d){if(d&&d.ok){load();}else{document.getElementById('err').textContent='Aktion fehlgeschlagen: '+((d&&d.error)||'?');btn.disabled=false;}})
    .catch(function(e){document.getElementById('err').textContent='Netzwerkfehler.';btn.disabled=false;});
}
load();
</script></body></html>`;
