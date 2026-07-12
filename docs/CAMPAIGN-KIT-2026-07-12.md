# CAMPAIGN KIT — the 60-day paid-customer push (2026-07-12)

Baseline: 30 real signups · 5 WhatsApp-reachable (admin panel → accounts) · 3 trials ACTIVE today.
Positioning law: **you are the EXAM, not the school.** Never compete with DKW/Goethe for the
learning budget — own the failed-interview moment. Never promise jobs (legal redline).

---

## 1. FIRST REVENUE TEST: five consented, active users

Use only accounts that have BOTH a server-recorded WhatsApp reminder consent and verified product
activity. A phone number or a previously reachable account is not consent. Prioritize the three active
trials, then the most active remaining consented users. Send personally, one by one, ideally as a
20–30 second voice note (founder voice = the whole trick). Never send a second initial message.
Script skeleton (say it your way — these are beats, not lines):

1. Greeting by name + "أنا اللي عامل OMNI-PERFORM" (I'm the one who built it).
2. ONE personal observation from their account (admin engagement panel: their minutes/interviews —
   e.g. "شفت إنك جربت إنترفيو واحد ووقفت").
3. The hook: "الإنترفيو الألماني مهارة لوحدها — الكورس مش هيدربك عليها."
4. The ask: "ادخل اعمل إنترفيو واحد النهارده — لو حابب أقولك رأيي في أدائك بنفسي، ابعتلي."
5. NO price in message #1. Price only after they re-engage.

Text fallback (if voice feels heavy):
> «أهلاً {name} 👋 أنا مطوّر OMNI-PERFORM. شفت حسابك — جرّبت {X}. سؤال واحد: إيه اللي وقّفك؟
> بجد عايز أعرف، بحسّن الأبلكيشن كل يوم. ولو عندك إنترفيو جاي قريب قولي — أجهزلك تدريب عليه.»

(EN gloss: "I'm the developer. I saw your account — you tried X. One question: what stopped you?
I genuinely want to know. And if you have a real interview coming, tell me — I'll prep you for it.")

## 2. The 3 ACTIVE trials — same-day priority

They are inside the product RIGHT NOW. Same voice-note, plus: "عندك {N} يوم مجاني فاضل —
استغلهم، إنترفيو كل يوم." When a trial expires with real usage → the founding offer (§4).

## 3. Email-only signups — hold until the repaired release is live

Subject: «سؤال واحد عن الإنترفيو الألماني»
Body beats: I'm the founder · you signed up but the app was rough then — it's a different app now
(voice interviews, a recruiter that guides you, honest feedback on YOUR sentences) · your login
still works, the level check is free · reply with one word about what stopped you and I'll answer
personally. NO price. Link: https://bpo-combat-arena.vercel.app

Do not send this cohort before production SMTP, email verification, and the Vodafone payment rail are
verified end-to-end. Send individually or through a compliant consented list—never expose recipients
with To/CC and never treat an old signup as permission for repeated marketing.

## 4. Price truth (decide once, never improvise)

- The current server-side truth is **Basic 999 EGP/month** and **Elite 1,999 EGP/month**. The old 50%
  launch offer expired on 11 July 2026. Do not advertise 499 EGP unless a new Basic-only server-side
  experiment is explicitly implemented and verified in checkout.
- Do not quote price in the first reactivation message. Show the normal server price only after the
  user resumes practice or asks about access.
- Test a Basic-only 499 EGP offer only after a real terms-stage objection or after 20 activated users
  reach the paywall with zero payment intents. Never improvise a discount in chat.
- Every payer is asked (after their first week, not at payment): 30-sec video testimonial in
  exchange for a free month. 3 testimonials = the next campaign's ammunition.

## 5. The daily commenting system (60 days, ≤4 comments/day per group rules, never re-message)

**Where:** the 15 live-verified communities in `prospects-2026-07-05.md` — German-learning EG +
BPO-jobs groups.
**What (rotate 3 archetypes — answer PEOPLE, never broadcast):**
- **The failed-interview answer** (under "اترفضت في الإنترفيو" posts): empathy + ONE concrete
  reason people fail (filler words / freezing / weak Sie-register) + "دي مهارة منفصلة عن الكورس،
  بتتدرب لوحدها" + link only if they ask or in a reply.
- **The level-check gift** (under "أنا مستواي إيه؟" posts): "في تقييم مجاني بالصوت — 5 أسئلة
  وبيقولك مستواك وعيبك الأساسي" + link.
- **The speaking-minutes math** (under "أحسن كورس؟" posts): "أي كورس كويس — بس احسبها: 20 طالب
  في ساعتين = 3 دقايق كلام ليك. الإنترفيو محتاج ساعات كلام تحت ضغط." No link; credibility play.
**Cadence:** 30–40 min/day, same account, every day. Track in one sheet: group / post / reply? /
signup? (ask new signups "منين عرفتنا؟" via the WhatsApp follow-up).

## 6. The 20-second ad (record once, reuse everywhere)

Screen-record on your phone: fresh signup → Salma greets → screening → verdict → first seconds of
a live fight with the HP bar + a damage number landing. Cut to 20s, no music needed. This clip IS
the differentiator no group has seen. Post it with the failed-interview hook, not "check my app".

## 7. Scoreboard and decision gates — numbers or it didn't happen

`curl -s https://bpo-combat-arena.onrender.com/api/diag/funnel` + admin engagement:
signups this week · source answers ("منين عرفتنا؟") · consented reactivations delivered · human replies ·
resumed sessions · second completed interview with `debrief_shown` · paywall_shown · payment intents ·
confirmed payers · refunds.

For the first five-person cohort, activation means a SECOND completed live interview that reaches the
debrief—not signup, assessment, or first-session start. Proceed if at least 2/5 activate and at least one
creates a payment intent or pays within seven days. At 0/5 human replies, revise the message/channel. At
fewer than two activations, fix onboarding/follow-up before adding features. If 20 activated users reach
the paywall with zero intents, revise the price/package before more acquisition.
**Kill/pivot rule:** 300+ signups with real follow-up and still 0 payers → the consumer wallet
isn't there; the app becomes the proof asset and the buyer becomes B2B (centers/recruiters).

## Standing warnings (the ways you kill this)
1. Building instead of posting — the app is DONE ENOUGH. Every build-hour before 300 signups is avoidance.
2. Letting trials expire silently — the follow-up IS the funnel.
3. Posting "try my AI app" — sell the failed interview, never the technology.
4. Stopping after 2 weeks — groups reward regulars; compounding needs 60 days.
5. Improvised discounts in DMs — one server-side founding price, nothing else.
