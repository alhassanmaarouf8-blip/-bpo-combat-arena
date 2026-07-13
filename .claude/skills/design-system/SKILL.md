---
name: design-system
description: The "Private Bank Arena" design system LAW + tokens + component anatomies for all OMNI-PERFORM UI work. Read BEFORE touching any client/src JSX — it replaces re-exploring screenshots, judging directions, or guessing conventions. Any UI agent prompt should just say "follow .claude/skills/design-system/SKILL.md".
---

# OMNI-PERFORM design system — "Private Bank Arena" (locked 2026-07-02)

Synthesized from a judged 3-direction design workflow + owner mandate ("way higher level, very
attractive, same meaning"). Everything below is implemented and live; match it, don't reinvent it.

## The law (design-lint enforces; violations fail CI)
- **Two brand colors ONLY**: blue `#3b82f6` (trust/primary/structure, lighter `#60a5fa`, rgba tints)
  and orange `#f97316` (`#fb923c`) as the SINGLE action accent. Neutrals (slate/navy) carry the rest.
  NO green, cyan, violet, gold, red as chrome. Semantic red is tolerated ONLY for true error text.
- **One orange OBJECT per screen** — the primary action. Everything else blue/neutral.
- Font: Inter only (`--font-display` / `--font-body`). No Orbitron/gaming faces. Mono only in the build stamp.
- Inline styles only (no CSS files/frameworks). Global keyframes + tokens live in App.jsx's style block (~line 545).
- Touch targets ≥44px. Type floor 11px — never reintroduce 8.5–10.5px micro-caps.
- Fight-screen combat visuals (HP bars, boss stage) are owner-tuned — don't restyle uninvited.

## Tokens (App.jsx :root — USE these, never hard-code)
- Type: `--fs-hero` (clamp 30-44), `--fs-h1:24`, `--fs-h2:17`, `--fs-body:15`, `--fs-label:13`, `--fs-meta:11`
- Glass card: `background:var(--glass); border:var(--glass-border); boxShadow:var(--e2), var(--glass-highlight); backdropFilter:'blur(14px) saturate(1.1)'`
- Elevation: `--e1` (subtle) / `--e2` (card) / `--e3` (hero/modal)
- Action button: `background:var(--grad-action); boxShadow:var(--shadow-action); color:#081019; borderRadius:14-16; minHeight:52-56; fontSize:16; fontWeight:700`
- Radii: `--r-sm:6 --r-md:10 --r-lg:16 --r-xl:24 --r-pill:999`; focus: `--ring-focus`; ring: `--grad-ring`
- Surfaces: `--bg-0/1/2`, `--surface`, `--surface-2`, `--line`, `--line-strong`; text: `--text`, `--text-dim`, `--text-faint`

## Icons — NEVER emoji as UI chrome
`<Icon name="…" size={18} />` (App.jsx module scope; stroke SVG, currentColor). Names: mic target
waveform bolt headphones messageCheck gauge map compass chartUp fileBadge trophy flame gift clock
check chevronRight play. Icons render in `var(--accent)` or `var(--text-dim)` only. Emoji is allowed
inside conversational CONTENT (chat/debrief text), never as chrome. Components outside App.jsx can't
import Icon (it's not exported) — either export it first or inline a matching stroke SVG.

## Component anatomies (copy these, don't invent)
- **Card**: glass + `--r-lg/--r-xl`, padding 14-24, title `--fs-h2`/600, meta `--fs-meta`/`--text-faint`.
- **Tile (grid item)**: minHeight 88, radius 14, `--surface` + `--line` border, stacked: 22px Icon
  (accent) → name `--fs-label`/600 → sub `--fs-meta`/faint. Badges: neutral pill (`--text-dim` border), 9px.
- **List row**: minHeight 48, 17px Icon (dim) + label `--fs-label` + chevronRight; dividers
  `1px solid rgba(255,255,255,0.06)`; no per-row colored borders.
- **Segmented control**: wrapper `rgba(255,255,255,0.05)` pill pad 3; segments flex1 minHeight 44,
  active `rgba(59,130,246,0.18)` + `--accent-2` text.
- **Quiet link**: text button, `--accent-2`, underline offset 3 — for demoted actions.

## Motion (all under the existing prefers-reduced-motion guard)
- Enter: `rise-in 0.36s var(--ease-out)`; stagger sections 60ms. Keyframes that exist: rise-in,
  sheen-once, wave-bar, flash-in, pulse, result-rise (+ combat set).
- Max ONE looping animation per screen. NO idle pulse on CTAs — premium never begs.
- Hover: bg 0.03→0.07 + translateY(-1px) 150ms; tap scale ~0.985.

## Bilingual rule
Existing Arabic strings: keep VERBATIM. New UI spots: German only + `{/* OWNER-AR slot */}` comment.
NEVER author Arabic/masri copy. German learner-facing content must pass
`node scripts/german-check.mjs <file>` (2 known false positives live in scenarios.js C1 questions).

## Gates before "done" (run all, from repo root)
`npm run lint` · `npm run design-lint` · `(cd client && npm run build)` · german-check if German changed.

## ★ THE CRAFT LAW (owner, 2026-07-10 — outranks taste): TRUST · AUTHORITY · COMPETENCE
Owner verdict on the old landing: "looks cheap AI-made, zero care and intentionality behind the
details." Every surface must radiate the three words above. The anti-AI-slop checklist distilled
from the elite-architect 10-point pass (shipped `1242802`):
1. **No fakery, ever** — a CSS/fake phone mockup or invented-looking UI reads as template slop;
   show a REAL product screenshot or let typography carry the page.
2. **One loud object per screen** (the orange CTA). Anything else orange gets demoted to quiet
   text. An orphaned element floating in empty space (the old ★-rating) reads as accidental —
   anchor every element to a neighbor.
3. **Hero = ONE short line, huge; everything else steps down two sizes.** A 6-line same-weight
   headline is a wall, not authority. Arabic display text uses a REAL Arabic face:
   'IBM Plex Sans Arabic' (loaded in index.html, weights 500/700) — never a Latin font's fallback.
4. **Visible labels on every input** (placeholder-only = trust-killer); never demand a phone
   number at first touch (WhatsApp = optional at signup; ask again after value is felt).
5. **Machined, not inflated**: CTAs solid fill, tight radius (~11px), no glow bloom, exact padding.
6. **Decided atmosphere**: exactly ONE light source (top-left radial) + 2.8% SVG grain overlay —
   depth felt, never noticed. Default flat dark = anonymous.
7. **Bilingual rhythm rule**: primary language large, secondary always smaller and consistently
   placed. The eye must never ping-pong between scripts.
8. **Copy niche law**: never nationality framing — always the JOB MARKET ("للشغل في الكول سنتر
   الألماني في مصر" / "BPO- und Call-Center-Branche in Ägypten" + Remote-Jobs). Numerals that can
   be misread ("Wortschatz von 90+ Konten") lose to concrete nouns ("vom Mobilfunk bis zur Airline").
9. **The mark**: monogram = two voice bars in a machined square (blue+orange SVG inline in the
   App.jsx hero) — owner yes/no pending; if kept, it appears consistently, never redesigned ad hoc.


## THE ELITE PROMPT (owner-demanded 2026-07-10: "make this app feel very elite, in every detail")
Paste-able, standing, forceful. Apply to EVERY surface, EVERY state, EVERY word — no exceptions:

> You are the most exacting product craftsman alive. This app must feel like it was built by a
> small team of obsessive experts who charge 10x and are worth it — a precision instrument, made
> in Berlin, priced with a straight face. Enforce, in this order:
>
> 1. **The 3-second law.** Screenshot any screen at random: it must radiate TRUST, AUTHORITY,
>    COMPETENCE before a single word is read. If it could be a template, it has failed.
> 2. **One voice: instrument, never arcade.** Kill on sight: glowing text, idle pulses, drifting
>    backgrounds, sheens, segment-tick gauges, flying numbers, dingbats (marks like diamond/star
>    bullets), emoji in UI chrome, shouting size-jumps, giant placeholder glyphs, fake urgency,
>    crossed-out anchor prices, robotic voices, invented Arabic.
> 3. **Motion is meaning.** An animation exists ONLY to communicate a state change. Everything
>    else is deleted, not toned down.
> 4. **Nothing unearned on screen.** Every number measured, every claim true by construction,
>    every label matching server truth (a form that says "optional" while the server requires it
>    is a lie, not a style choice).
> 5. **Every reachable state is designed.** Loading, empty, error, expired, offline, slow,
>    mic-broken, mid-session death — each styled with hero-level care, each with a way forward.
>    A dead end is a defect. Dead air gets presence, never a void.
> 6. **Words are the interface.** German: professional HR register. Arabic: the owner's masri
>    ONLY (slots, never authored). Microcopy answers "what happens next" in one line and never
>    blames the user.
> 7. **The details ladder, per surface:** 8px-grid alignment -> ONE accent per screen -> max 3
>    type sizes visible -> negative space over decoration -> real content over filler -> latency
>    masked with presence -> touch targets >=44px -> AA contrast.
> 8. **The self-test before shipping:** screenshot the surface and ask: "Would a Cairo BPO hiring
>    manager, seeing this over a candidate's shoulder, believe it costs 2000 EGP and was made by
>    a German team?" If no — name the three cheapest pixels and kill them, then re-test.
> 9. **Proof or it didn't happen:** fresh prod screenshots (mobile + desktop), zero console
>    errors, gates green, and the owner's eye. "Elite" is a verdict he gives, not one you claim.

Enforcement history: landing (1242802), fight screen de-arcade (042a3fb), email reset flow (9c434ac),
home readiness ladder de-arcade (26eb853 — killed: glowing rank text, idle pulse dot, glow bars,
"SO NAH! 🔥" near-miss flasher, 🏆/🎯 chrome emoji, 9px micro-caps, orange-as-second-accent,
label/rank collision at 390px). Still standing (known, parked): `--shadow-action` token carries a
glow bloom on every action CTA (app-wide token — its tightening is a deliberate separate ship);
rank VOCABULARY (Rekrut/Anwärter) is arcade-flavored — renaming is an owner product call.
