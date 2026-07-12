# OMNI-PERFORM — Go-Live Checklist

Plain-language steps to take the app live. Work top to bottom. ✅ = done.

---

## 1. Render env vars (backend) — verify all are set
Render → `bpo-combat-arena` service → **Environment**. These must exist:

| Variable | What it is | Set? |
|---|---|---|
| `GROQ_API_KEY` | Server-side interview/STT provider key | ☐ |
| `AUTH_SECRET` | Long random string (login security) | ☐ |
| `DATABASE_URL` | Postgres internal URL (keeps accounts after redeploy) | ☐ |
| `CLIENT_ORIGIN` | Exact production HTTPS frontend origin only | ☐ |
| `APP_URL` | Same production frontend origin (verification/reset links) | ☐ |
| `SMTP_USER` | Gmail/SMTP sender used for verification and password reset | ☐ |
| `SMTP_PASS` | SMTP app password; never commit it | ☐ |
| `ADMIN_KEY` | High-entropy admin secret, at least 32 characters | ☐ |
| `PAYMENT_MONITOR_KEY` | Separate high-entropy payment-monitor secret | ☐ |
| `VODAFONE_CASH_NUMBER` | Public wallet number used by the implemented checkout | ☐ |
| `WHATSAPP_NUMBER` | *(optional)* separate number for payment proof/support | ☐ |

**Check it worked:** open the **Logs** tab → you should see the server start and `[db] Connected`.

Before deploying the frontend, verify from a non-production test account that the backend can send
both a verification email and a password-reset email, and that `/api/billing/status` reports a usable
Vodafone Cash destination. If either check fails, stop: the repaired client intentionally blocks new
training before email confirmation and blocks checkout without the implemented payment rail.

## 1B. Deploy in this order — never frontend-only

1. Deploy the repaired backend to Render and wait for its minimal health check to pass.
2. Test signup → verification → login and billing status against that backend.
3. Only then deploy the matching frontend build to Vercel.
4. Repeat the flow from a fresh browser before sharing the link.

A frontend-only push can auto-deploy on Vercel while Render remains on the old backend, producing a
mixed release. Treat the two deployments as one coordinated change.

---

## 2. The one test only YOU can do — real phone fight
1. On an Android phone (Chrome), open **https://bpo-combat-arena.vercel.app**.
2. Create a non-admin test account and confirm its e-mail link.
3. Grant that account a temporary plan from the separately authenticated admin panel.
4. Start an interview, allow the mic, speak German, end it.
5. Confirm: (a) you **hear** the interviewer, (b) the mic state reacts when you speak, (c) the results screen shows coaching.

➡️ If all three work, the core product works on real hardware. **This is the launch gate.**

---

## 3. Decide your price (optional — defaults are fine)
Open `server/plans.config.js`. Change only the numbers if you want:
- Basic: `priceEGP: 999`, `yearlyEGP: 9990`, `dailyLiveMinutes: 15`
- Elite: `priceEGP: 1999`, `yearlyEGP: 19990`, `dailyLiveMinutes: 30`

The pricing page updates automatically. (Tell Claude to change them if you're unsure how.)

---

## 4. Add your teaching videos (optional — works without them)
Open `server/lessons.config.js`. For each lesson, paste an 11-character YouTube ID into
`youtubeId_de` / `youtubeId_ar` (instructions are at the top of that file). Until you do, a
friendly "video coming soon" box shows and the quiz still works.

---

## 5. Turn on payments (when ready)
The current flow is manual verification: the customer creates a payment intent, pays through the
configured Vodafone Cash wallet, and reports the sender fingerprint. Access remains locked until the owner
confirms the matching payment from the separately authenticated admin/payment monitor. Never place
payment secrets in client code, and test expiry + duplicate-confirmation behavior before launch.

---

## 6. How each plan behaves (so you can spot-check with a test account)
Use a **separate, non-admin** test account; set its plan via the admin panel.
- **Free:** one assessment and one 7-minute interview after e-mail verification. Starting that first
  interview begins the 3-day Basic-level trial; no provider-backed route works before verification.
- **Basic:** up to **15 min/day** (two complete interview sessions; resets midnight Cairo).
- **Elite:** up to **30 min/day** (four sessions) + full target-role matching.
- Out of minutes today → "Dein heutiges Training ist erledigt…" (come back tomorrow).

---

## ✅ You are ready to launch when:
- [ ] Section 1 env vars all set (especially DB, auth, SMTP, admin, payment monitor)
- [ ] Section 2 phone fight works (hear boss + orb + results)
- [ ] You're OK with the prices in `plans.config.js`
- [ ] Credential rotation/history containment completed before any repaired build is deployed
- [ ] A neutral custom domain replaces the Vercel project URL before paid traffic

Everything else (cost caps, security, persistence, daily-minute limits, bilingual walls,
cold-start screen, grammar fix) is built and verified — see the Phase F sweep.

---

## Known limitations (not blockers — improve after launch)
- LanguageTool free API sometimes misses errors / suggests an awkward fix → self-host later via `LANGUAGETOOL_URL`.
- Payment fulfillment is manual (admin grants the plan) until you wire a provider webhook.
- At the daily-minute cap the boss finishes its sentence (no synthetic closing question).
