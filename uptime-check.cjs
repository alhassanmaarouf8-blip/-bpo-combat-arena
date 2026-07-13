const https = require('https');

const TARGETS = [
  { label: 'Frontend (Vercel)', url: 'https://bpo-combat-arena.vercel.app' },
  { label: 'Backend (Render)', url: 'https://bpo-combat-arena.onrender.com/health' },
];

async function fetchOnce(url) {
  const start = Date.now();
  return new Promise((resolve) => {
    const req = https.get(url, { timeout: 30000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const ms = Date.now() - start;
        resolve({ status: res.statusCode, ms, body: data.slice(0, 500), error: null });
      });
    });
    req.on('error', (err) => {
      const ms = Date.now() - start;
      resolve({ status: null, ms, body: null, error: `${err.code || 'UNKNOWN'}: ${err.message}` });
    });
    req.on('timeout', () => {
      req.destroy();
      const ms = Date.now() - start;
      resolve({ status: null, ms, body: null, error: 'TIMEOUT (30s)' });
    });
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const now = new Date();
  const cairoTime = now.toLocaleString('en-US', { timeZone: 'Africa/Cairo', hour12: false });
  const [dateStr, timeStr] = cairoTime.split(', ');

  const results = [];

  for (const target of TARGETS) {
    console.log(`\n=== ${target.label} ===`);
    const reqs = [];
    for (let i = 0; i < 3; i++) {
      console.log(`  Request #${i + 1}...`);
      const r = await fetchOnce(target.url);
      reqs.push(r);
      if (r.error) {
        console.log(`    ❌ Error: ${r.error} (${r.ms}ms)`);
      } else {
        console.log(`    ✅ ${r.status} — ${r.ms}ms`);
      }
      if (i < 2) await sleep(3000);
    }
    results.push({ ...target, reqs });
  }

  // Build report
  const lines = [];
  lines.push(`# BPO Combat Arena — Status Report ${dateStr} ${timeStr} Cairo`);
  lines.push('');

  for (const r of results) {
    const allOk = r.reqs.every((x) => x.status && x.status >= 200 && x.status < 400);
    const worstMs = Math.max(...r.reqs.map((x) => x.ms));
    lines.push(`## ${r.label}`);
    lines.push(`- URL: ${r.url}`);
    lines.push(`- Status: ${allOk ? 'UP' : 'DOWN'}`);
    lines.push(`- Requests:`);
    r.reqs.forEach((x, i) => {
      if (x.error) {
        lines.push(`  - #${i + 1}: ❌ ${x.error} — ${x.ms}ms`);
      } else {
        const note = x.ms > 1000 ? ' (cold start?)' : '';
        lines.push(`  - #${i + 1}: ${x.status} OK — ${x.ms.toLocaleString()}ms${note}`);
      }
    });
    lines.push(`- Worst-case response time: ${worstMs.toLocaleString()}ms`);
    lines.push('');
  }

  // Summary
  const allUp = results.every((r) => r.reqs.every((x) => x.status && x.status >= 200 && x.status < 400));
  const anyPartial = results.some((r) => {
    const oks = r.reqs.filter((x) => x.status && x.status >= 200 && x.status < 400).length;
    return oks > 0 && oks < 3;
  });
  const worstOverall = Math.max(...results.flatMap((r) => r.reqs.map((x) => x.ms)));

  let overall;
  if (allUp) overall = 'ALL SYSTEMS OPERATIONAL';
  else if (anyPartial) overall = 'DEGRADED';
  else overall = 'DOWN';

  lines.push('## Summary');
  for (const r of results) {
    const worstMs = Math.max(...r.reqs.map((x) => x.ms));
    const label = r.label.split(' ')[0];
    lines.push(`- ${r.label}: ${r.reqs.every((x) => x.status && x.status >= 200 && x.status < 400) ? 'UP' : 'DOWN'} | Worst: ${worstMs.toLocaleString()}ms`);
  }
  lines.push(`- Overall: **${overall}**`);
  lines.push('');

  // Notes
  const notes = [];
  for (const r of results) {
    if (r.reqs.some((x) => x.ms > 1000)) {
      notes.push(`- ${r.label} showed elevated response times (${r.reqs.filter((x) => x.ms > 1000).map((x) => x.ms + 'ms').join(', ')}), likely cold starts on Render's free tier.`);
    }
    if (r.reqs.some((x) => x.error)) {
      notes.push(`- ${r.label} had connection failures: ${r.reqs.filter((x) => x.error).map((x) => x.error).join('; ')}`);
    }
  }
  if (notes.length > 0) {
    lines.push('## Notes');
    lines.push(...notes);
  } else {
    lines.push('## Notes');
    lines.push('- All responses normal. No issues detected.');
  }

  const reportPath = `status-${dateStr.split('/').join('-')}.md`;
  const fs = require('fs');
  fs.writeFileSync(reportPath, lines.join('\n'));
  console.log(`\n📄 Report saved to ${reportPath}`);
  console.log(lines.join('\n'));
}

main().catch(console.error);
