import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const TOK = readFileSync(process.env.TOKFILE, 'utf8').trim();
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await p.goto('https://bpo-combat-arena.vercel.app', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(2000);
const acc = await p.evaluate(async (t) => (await (await fetch('https://bpo-combat-arena.onrender.com/api/auth/me', { headers: { Authorization: `Bearer ${t}` } })).json()).account, TOK);
await p.evaluate(({ t, a }) => { localStorage.setItem('bpo_token', t); localStorage.setItem('bpo_account', JSON.stringify(a)); localStorage.setItem('omni_salma_seen', '1'); }, { t: TOK, a: acc });
await p.goto('https://bpo-combat-arena.vercel.app', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(8000);
await p.screenshot({ path: process.env.OUT });     // first viewport ONLY — no fullPage
const vp = await p.evaluate(() => { const els = [...document.querySelectorAll('button')].filter(b => /interview/i.test(b.innerText)); return els.map(b => ({ text: b.innerText.slice(0, 40), top: Math.round(b.getBoundingClientRect().top) })); });
console.log('interview-labeled buttons at viewport-top offsets:', JSON.stringify(vp));
await b.close();
