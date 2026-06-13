# OMNI-PERFORM — Go-Live Checklist

Plain-language steps to take the app live. Work top to bottom. ✅ = done.

---

## 1. Render env vars (backend) — verify all are set
Render → `bpo-combat-arena` service → **Environment**. These must exist:

| Variable | What it is | Set? |
|---|---|---|
| `OPENAI_API_KEY` | Your OpenAI key (the paid part) | ☐ |
| `AUTH_SECRET` | Long random string (login security) | ☐ |
| `DATABASE_URL` | Postgres internal URL (keeps accounts after redeploy) | ☐ |
| `CLIENT_ORIGIN` | `https://bpo-combat-arena.vercel.app,http://localhost:5173` | ☐ |
| `ADMIN_EMAIL` | `alhassanmaarouf8@gmail.com` (your owner powers) | ☐ |
| `PAYMENT_URL` | *(optional, later)* your checkout link | ☐ |

**Check it worked:** open the **Logs** tab → you should see the server start and `[db] Connected`.

---

## 2. The one test only YOU can do — real phone fight
1. On an Android phone (Chrome), open **https://bpo-combat-arena.vercel.app**.
2. Log in with your **admin** email (`alhassanmaarouf8@gmail.com`) → you have full access.
3. Start an interview, allow the mic, speak German, end it.
4. Confirm: (a) you **hear** the boss talk, (b) the **orb pulses** when you speak, (c) the **results screen** shows coaching.

➡️ If all three work, the core product works on real hardware. **This is the launch gate.**

---

## 3. Decide your price (optional — defaults are fine)
Open `server/plans.config.js`. Change only the numbers if you want:
- Basic: `priceEGP: 1299`, `yearlyEGP: 12990`, `dailyLiveMinutes: 7`
- Elite: `priceEGP: 2999`, `yearlyEGP: 29990`, `dailyLiveMinutes: 15`

The pricing page updates automatically. (Tell Claude to change them if you're unsure how.)

---

## 4. Add your teaching videos (optional — works without them)
Open `server/lessons.config.js`. For each lesson, paste an 11-character YouTube ID into
`youtubeId_de` / `youtubeId_ar` (instructions are at the top of that file). Until you do, a
friendly "video coming soon" box shows and the quiz still works.

---

## 5. Turn on payments (when ready)
Today: free = assessment only; Basic/Elite = paid plans (server-enforced). To actually collect money:
1. Create a checkout link with a provider that pays out to Egypt (Lemon Squeezy / Paddle / Gumroad).
2. Set `PAYMENT_URL` on Render to that link.
3. When someone pays, open your app (as admin) → **🛠 FEEDBACK-DATEN (ADMIN)** → **PLAN SETZEN**
   → type their email → tap **BASIC** or **ELITE**. They tap "ICH HABE BEZAHLT — refresh" and they're in.

---

## 6. How each plan behaves (so you can spot-check with a test account)
Use a **separate, non-admin** test account; set its plan via the admin panel.
- **Free:** assessment only. Tapping a live interview → honest upsell (no fight, no cost).
- **Basic:** up to **7 min** live interview **per day** (resets midnight Cairo). Trainingslager map visible, lessons locked.
- **Elite:** up to **15 min/day** + full Trainingslager lessons.
- Out of minutes today → "Dein heutiges Training ist erledigt…" (come back tomorrow).

---

## ✅ You are ready to launch when:
- [ ] Section 1 env vars all set (esp. `DATABASE_URL`, `AUTH_SECRET`, `ADMIN_EMAIL`)
- [ ] Section 2 phone fight works (hear boss + orb + results)
- [ ] You're OK with the prices in `plans.config.js`
- [ ] (Optional) videos pasted / (Optional) `PAYMENT_URL` set

Everything else (cost caps, security, persistence, daily-minute limits, bilingual walls,
cold-start screen, grammar fix) is built and verified — see the Phase F sweep.

---

## Known limitations (not blockers — improve after launch)
- LanguageTool free API sometimes misses errors / suggests an awkward fix → self-host later via `LANGUAGETOOL_URL`.
- Payment fulfillment is manual (admin grants the plan) until you wire a provider webhook.
- At the daily-minute cap the boss finishes its sentence (no synthetic closing question).
