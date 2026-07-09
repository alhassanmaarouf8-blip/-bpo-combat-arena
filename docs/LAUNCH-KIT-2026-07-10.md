# LAUNCH KIT — distribution sprint (2026-07-10)

The teardown's #1 finding: **~74 opens/day, single-channel, untagged.** Nothing else matters until
more people arrive and you can see WHICH post brought them. Everything below is $0 and already
supported by the app — no deploy needed.

## 1. The links (copy-paste, one per group — NEVER post the bare URL again)

The app persists `?src=` per visit and reports every funnel event per source. Rename the slugs to
your real groups (lowercase, digits, `-` only, max 16 chars):

| Where you post | Link |
|---|---|
| FB group 1 (rename!) | `https://bpo-combat-arena.vercel.app/?src=fb-jobs1` |
| FB group 2 | `https://bpo-combat-arena.vercel.app/?src=fb-jobs2` |
| FB group 3 | `https://bpo-combat-arena.vercel.app/?src=fb-deutsch1` |
| Your FB profile/page | `https://bpo-combat-arena.vercel.app/?src=fb-page` |
| WhatsApp shares/status | `https://bpo-combat-arena.vercel.app/?src=wa` |
| LinkedIn | `https://bpo-combat-arena.vercel.app/?src=li` |

## 2. The one line every post MUST contain (the in-app-browser killer)

57% of arrivals on 07-08 landed in Facebook's in-app browser, **where the mic is dead**. Put the
escape instruction IN the post, before the link:

> **OWNER-AR slot** — one masri line meaning: "important: open the link in Chrome, not inside
> Facebook (tap ⋯ next to the link → open in browser), so the microphone works."

## 3. Post skeleton (structure proven by your own landing copy — fill the AR)

1. **Hook (masri, OWNER-AR):** the outcome — a German call-center job — and the pain (the
   interview in German is the wall).
2. **The offer:** free level assessment in 5 minutes, spoken, honest verdict + your biggest
   blockers. (This is the app's real free hook — lead with it, not with "an app".)
3. **The Chrome line** (section 2).
4. **The tagged link** for THAT group.
5. Optional urgency while true: 50% Start-Angebot endet 11. Juli.

Post cadence: one group per day, not all at once — so `?src=` tells you which group actually
converts before you spend more effort there.

## 4. How to read results (10 seconds, any time)

```
curl -s https://bpo-combat-arena.onrender.com/api/diag/funnel
```

- `open@fb-jobs1` etc. = arrivals per group → double down on the winner, drop the losers.
- `open_inapp` high → your Chrome line isn't working; move it higher in the post.
- `gemini_fight` vs `start_clicked` → how many fights actually got the good voice.
- `paywall_shown` → whether the peak-offer card is pulling people to prices.

## 5. What changed in the product this week (so your posts can be true)

- Voice: all 6 interviewers verified on native audio, crackle-heal shipped.
- Abandon an interview → your feedback now survives and greets you on return.
- New "Bis zum Job" plan: 2.000 EGP **einmalig** (1.000 with the offer), 12 months, no
  subscription — built for how this audience buys.
- Password forgotten → WhatsApp reset from the registered number.

## Owner-only next decisions (parked)
- Real domain (~$10/yr) — approved-pending, revisit when posting starts.
- Testimonials: replace "3 echte Bewertungen" with 2–3 named success quotes as soon as they exist.
