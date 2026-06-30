import { chromium } from 'playwright';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box;font-family:'Segoe UI',system-ui,sans-serif}
body{width:1200px;height:630px;overflow:hidden;
  background:radial-gradient(1200px 600px at 80% -10%,rgba(59,130,246,0.18),transparent 60%),
             radial-gradient(900px 500px at 10% 120%,rgba(249,115,22,0.12),transparent 55%),#04070d;
  color:#e2e8f0;display:flex;flex-direction:column;justify-content:center;padding:0 86px}
.kick{font-size:24px;letter-spacing:.32em;color:#f97316;font-weight:700;margin-bottom:22px}
.title{font-size:104px;font-weight:900;letter-spacing:.04em;line-height:1;
  background:linear-gradient(135deg,#60a5fa,#3b82f6);-webkit-background-clip:text;background-clip:text;color:transparent}
.de{font-size:38px;color:#cbd5e1;margin-top:30px;font-weight:600}
.ar{font-size:34px;color:#94a3b8;margin-top:14px;direction:rtl}
.row{display:flex;gap:14px;margin-top:40px}
.chip{font-size:21px;font-weight:700;letter-spacing:.06em;padding:11px 20px;border-radius:999px;
  border:1px solid rgba(59,130,246,.45);color:#93c5fd;background:rgba(59,130,246,.08)}
.chip.o{border-color:rgba(249,115,22,.5);color:#fdba74;background:rgba(249,115,22,.08)}
.url{position:absolute;bottom:54px;right:86px;font-size:22px;color:#64748b;letter-spacing:.04em}
</style></head><body>
<div class="kick">OMNI-PERFORM</div>
<div class="title">Werde eingestellt.</div>
<div class="de">Dein deutsches Job-Interview — als Live-Training.</div>
<div class="ar">درّب على مقابلة الشغل الألماني بصوتك — وخُد تقييم فوري</div>
<div class="row"><div class="chip">SPRICH</div><div class="chip">WERDE BEWERTET</div><div class="chip o">JOB</div></div>
<div class="url">bpo-combat-arena.vercel.app</div>
</body></html>`;
const b = await chromium.launch();
const p = await (await b.newContext({ viewport:{width:1200,height:630}, deviceScaleFactor:1 })).newPage();
await p.setContent(html, { waitUntil:'networkidle' });
await p.screenshot({ path:'C:/Users/lenovo/OneDrive/Desktop/bpo-combat-arena/.claude/worktrees/apply-batch/client/public/og.png' });
await b.close();
console.log('og.png written');
