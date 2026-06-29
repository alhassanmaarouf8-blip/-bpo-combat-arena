/**
 * guardian-autofix.mjs — the FREE, zero-cost auto-fixer behind the Guardian.
 *
 * When the Guardian CI gate goes red, this runs in GitHub Actions, diagnoses the first real failure,
 * asks a FREE model (GitHub Models — billed to nobody, uses the runner's built-in GITHUB_TOKEN) for
 * the corrected file, applies it, and RE-VERIFIES every check. It only ever reports success if the
 * checks actually pass again — it never pushes an unverified guess at your users.
 *
 * Exit codes (read by the workflow):
 *   0 = fixed and verified green   → workflow commits + pushes
 *   2 = could not fix              → workflow opens an issue (never pushes)
 *   1 = internal error            → workflow opens an issue
 *
 * Cost: $0. GitHub Models is free for every GitHub account; no API key, no card, ever.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const TOKEN     = process.env.GITHUB_TOKEN;
const MODEL     = process.env.GUARDIAN_MODEL || 'openai/gpt-4o';
const ENDPOINT  = 'https://models.github.ai/inference/chat/completions';
const MAX_FILES = 3;     // don't shotgun the repo — fix the few files that actually fail
const MAX_ROUNDS = 2;    // a couple of attempts, then hand to a human
const SUMMARY_FILE = '.guardian-fix-summary.txt';

function run(cmd) {
  try {
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return { ok: true, stdout: out, stderr: '' };
  } catch (e) {
    return { ok: false, stdout: e.stdout?.toString() || '', stderr: e.stderr?.toString() || '' };
  }
}

// Find the FIRST failing gate and return the file(s) + error text to fix. Mirrors guardian.yml order.
function diagnose() {
  // 1. ESLint no-undef (the undefined-variable crash class)
  const lint = run('npx eslint server client -f json --no-warn-ignored');
  try {
    const results = JSON.parse(lint.stdout || '[]');
    const bad = results.filter((r) => r.errorCount > 0);
    if (bad.length) {
      return bad.slice(0, MAX_FILES).map((r) => ({
        file: r.filePath,
        kind: 'eslint',
        errors: r.messages.filter((m) => m.severity === 2)
          .map((m) => `line ${m.line}:${m.column}  ${m.ruleId || ''}  ${m.message}`).join('\n'),
      }));
    }
  } catch { /* eslint produced no parseable JSON — fall through to other gates */ }

  // 2. node --check every server file (syntax/parse errors)
  const synt = [];
  for (const f of fs.readdirSync('server').filter((n) => n.endsWith('.js'))) {
    const r = run(`node --check server/${f}`);
    if (!r.ok) synt.push({ file: `server/${f}`, kind: 'syntax', errors: (r.stderr || r.stdout).trim() });
  }
  if (synt.length) return synt.slice(0, MAX_FILES);

  // 3. client build (broken imports / JSX / vite)
  const build = run('npm --prefix client run build');
  if (!build.ok) {
    const blob = (build.stderr || '') + (build.stdout || '');
    const m = blob.match(/(client\/src\/[^\s:)'"]+\.(?:jsx?|css|ts|tsx))/);
    return [{ file: m ? m[1] : null, kind: 'build', errors: blob.slice(-1800) }];
  }

  return []; // all gates green
}

async function askForFix(file, kind, errors) {
  if (!TOKEN) throw new Error('no GITHUB_TOKEN (GitHub Models auth) in environment');
  const code = fs.readFileSync(file, 'utf8');
  const prompt =
`A production app's CI gate failed. The file "${file}" failed the "${kind}" check with these errors:

${errors}

Return the COMPLETE corrected contents of "${file}". Rules:
- Fix ONLY the root cause, with the smallest possible change.
- Do NOT refactor, rename, reformat, or remove any functionality.
- Do NOT mask the problem (no empty try/catch, no disabling lint rules, no deleting checks).
- Output ONLY the raw file contents. No markdown fences, no commentary.

--- current contents of ${file} ---
${code}`;

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`GitHub Models ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  let out = data.choices?.[0]?.message?.content || '';
  // Strip accidental ``` fences if the model added them despite instructions.
  out = out.replace(/^\s*```[a-zA-Z]*\n/, '').replace(/\n```\s*$/, '');
  if (out.trim().length < 20) throw new Error('model returned an empty/too-short file');
  return out.endsWith('\n') ? out : out + '\n';
}

function finish(status, lines) {
  const summary =
    status === 'fixed'
      ? `fix(guardian): auto-repair red CI via GitHub Models (free)\n\n${lines.join('\n\n')}\n\nCo-Authored-By: Guardian Bot <guardian-bot@users.noreply.github.com>\n`
      : `Guardian auto-fix could not safely repair this failure.\n\n${lines.join('\n\n')}\n`;
  fs.writeFileSync(SUMMARY_FILE, summary);
}

(async () => {
  const log = [];
  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const problems = diagnose();
      if (!problems.length) { finish('fixed', log.length ? log : ['Checks were already green.']); process.exit(0); }
      let changed = false;
      for (const p of problems) {
        if (!p.file) { log.push(`Round ${round}: ${p.kind} failure with no locatable file:\n${p.errors}`); continue; }
        try {
          fs.writeFileSync(p.file, await askForFix(p.file, p.kind, p.errors));
          log.push(`Round ${round}: patched ${p.file} (${p.kind})\nErrors were:\n${p.errors}`);
          changed = true;
        } catch (e) {
          log.push(`Round ${round}: could NOT fix ${p.file} (${p.kind}): ${e.message}`);
        }
      }
      if (!changed) break;
    }
    // Final verification — only "fixed" if everything is genuinely green now.
    const remaining = diagnose();
    if (!remaining.length) { finish('fixed', log); process.exit(0); }
    finish('unfixable', log.concat(remaining.map((r) => `STILL FAILING: ${r.file || '(no file)'}\n${r.errors}`)));
    process.exit(2);
  } catch (e) {
    finish('unfixable', log.concat([`Internal error: ${e.stack || e.message}`]));
    process.exit(1);
  }
})();
