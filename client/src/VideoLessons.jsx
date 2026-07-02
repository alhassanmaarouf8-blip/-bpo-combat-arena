/**
 * VideoLessons.jsx — the $0 "video" engine. Real recorded video is impossible at zero spend, so this
 * is the honest equivalent: lessons play as full-screen animated slide sequences with native German
 * TTS narration (same Aura-2 voice as the drills, via nativeVoice.js → server-cached → $0, browser
 * voice fallback). Feels like a produced explainer: autoplay through slides, kinetic typography,
 * progress bar, pause/replay. Pure React + inline styles, no assets, no new dependencies.
 *
 * Engine contract per slide: { kicker?, title, lines[], example?, falsch?, note?, speak? }
 *   lines[]  — revealed one-by-one on a timer while the narration speaks
 *   example  — big highlighted German sentence (the model phrase), spoken in the narration
 *   falsch   — an INTENTIONALLY WRONG sentence, rendered with a loud ✗ FALSCH badge (lesson 3)
 *   speak    — explicit narration override (used where the derived text would read markers aloud)
 * Advancing: narration onEnd + a small beat, but never before a minimum read time (protects against
 * a TTS path that fails instantly), and a hard fallback timer advances even if audio stalls forever.
 * Pause stops audio + reveals the full slide; resume restarts the current slide's narration (the
 * underlying <audio> lives inside playNative and only exposes stop(), so mid-sentence resume is out).
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { playNative } from './nativeVoice.js';

const LINE_MS = 1300;   // cadence of the one-by-one line reveal
const BEAT_MS = 900;    // breathing room after the narration before the next slide

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// What the narrator says for a slide (explicit `speak` wins; markers/badges are never read aloud).
function speakTextOf(sl) {
  if (sl.speak) return sl.speak;
  const parts = [sl.title, ...(sl.lines || [])];
  if (sl.example) parts.push(`Zum Beispiel: ${sl.example}`);
  if (sl.note) parts.push(sl.note);
  return parts.filter(Boolean).join(' ');
}

// Honest duration estimate from the narration length (~speaking rate), for the picker cards.
function estMinutes(les) {
  const ms = les.slides.reduce((s, sl) => s + speakTextOf(sl).length * 80 + 1800, 0);
  return Math.max(1, Math.round(ms / 60000));
}

// ── The lessons (clean C1-correct German, clear enough for A2–B1 ears) ─────────────────────────
const LESSONS = [
  {
    id: 'selbstvorstellung',
    title: 'Die perfekte Selbstvorstellung',
    hook: 'Die erste Frage entscheidet — vier Bausteine für eine starke erste Minute.',
    slides: [
      {
        kicker: 'LEKTION 1',
        title: 'Die perfekte Selbstvorstellung',
        lines: [
          'Fast jedes Interview beginnt gleich: „Erzählen Sie kurz von sich.“',
          'Wer hier klar antwortet, führt das Gespräch von Anfang an.',
          'Vier Bausteine reichen — immer in derselben Reihenfolge.',
        ],
      },
      {
        kicker: 'BAUSTEIN 1',
        title: 'Name und Rolle',
        lines: [
          'Beginnen Sie mit Ihrem Namen und Ihrer aktuellen Rolle.',
          'Ein Satz genügt — ruhig und deutlich gesprochen.',
        ],
        example: 'Guten Tag, mein Name ist Omar Hassan und ich arbeite als Kundenservice-Agent.',
      },
      {
        kicker: 'BAUSTEIN 2',
        title: 'Erfahrung mit einer Zahl',
        lines: [
          'Eine konkrete Zahl macht Ihre Erfahrung sofort glaubwürdig.',
          'Jahre, Anrufe pro Tag, zufriedene Kunden — eine Zahl genügt.',
        ],
        example: 'Ich habe zwei Jahre Erfahrung im Kundenservice und betreue rund fünfzig Anrufe pro Tag.',
      },
      {
        kicker: 'BAUSTEIN 3',
        title: 'Stärke mit Beweis',
        lines: [
          'Nennen Sie eine Stärke — und beweisen Sie sie mit einem Beispiel.',
          'Ohne Beweis klingt jede Stärke wie eine Floskel.',
        ],
        example: 'Meine Stärke ist Ruhe unter Druck: Auch bei wütenden Kunden bleibe ich freundlich und finde eine Lösung.',
      },
      {
        kicker: 'BAUSTEIN 4',
        title: 'Motivation',
        lines: [
          'Sagen Sie zum Schluss, warum Sie genau diese Stelle wollen.',
          'Verbinden Sie die Stelle mit Ihrem persönlichen Ziel.',
        ],
        example: 'Ich möchte diese Stelle, weil ich mein Deutsch jeden Tag im Kundenkontakt einsetzen will.',
      },
      {
        kicker: 'ZUSAMMENFASSUNG',
        title: 'Vier Bausteine, eine Minute',
        lines: [
          'Name und Rolle. Erfahrung mit einer Zahl. Stärke mit Beweis. Motivation.',
          'Üben Sie die vier Sätze laut, bis sie automatisch kommen.',
        ],
        note: 'Tipp: Sprechen Sie Ihre Selbstvorstellung danach im Interview — dort zählt sie wirklich.',
      },
    ],
  },
  {
    id: 'wuetende-kunden',
    title: 'Wütende Kunden: die 4 Schritte',
    hook: 'Der Vier-Schritte-Reflex, der jede Beschwerde entschärft.',
    slides: [
      {
        kicker: 'LEKTION 2',
        title: 'Wütende Kunden: die 4 Schritte',
        lines: [
          'Ein wütender Kunde testet nicht Ihr Deutsch — er testet Ihre Ruhe.',
          'Profis folgen immer denselben vier Schritten.',
          'Empathie. Verantwortung. Lösung. Verbindlichkeit.',
        ],
      },
      {
        kicker: 'SCHRITT 1',
        title: 'Empathie',
        lines: [
          'Zeigen Sie zuerst, dass Sie den Ärger verstehen.',
          'Noch keine Lösung — zuerst das Gefühl anerkennen.',
        ],
        example: 'Ich kann Ihren Ärger vollkommen nachvollziehen.',
      },
      {
        kicker: 'SCHRITT 2',
        title: 'Verantwortung',
        lines: [
          'Übernehmen Sie Verantwortung, ohne Schuld zuzuweisen.',
          'Keine Ausreden, keine Rechtfertigungen.',
        ],
        example: 'Das tut mir aufrichtig leid — das hätte nicht passieren dürfen.',
      },
      {
        kicker: 'SCHRITT 3',
        title: 'Lösung',
        lines: [
          'Sagen Sie konkret, was Sie jetzt tun.',
          'Ein klarer nächster Schritt beruhigt mehr als zehn Entschuldigungen.',
        ],
        example: 'Was ich konkret für Sie tun kann, ist Folgendes: Ich eskaliere das sofort an unser technisches Team.',
      },
      {
        kicker: 'SCHRITT 4',
        title: 'Verbindlichkeit',
        lines: [
          'Geben Sie zum Schluss ein Versprechen mit einer klaren Zeitangabe.',
          'So weiß der Kunde: Es passiert wirklich etwas.',
        ],
        example: 'Ich kümmere mich umgehend darum und melde mich innerhalb von 24 Stunden bei Ihnen.',
      },
      {
        kicker: 'ZUSAMMENFASSUNG',
        title: 'Der Vier-Schritte-Reflex',
        lines: [
          'Empathie. Verantwortung. Lösung. Verbindlichkeit.',
          'Immer in dieser Reihenfolge — bei jeder Beschwerde.',
        ],
        note: 'Diese Sätze kommen direkt aus den Trainings-Szenarien der App.',
      },
    ],
  },
  {
    id: 'nebensaetze',
    title: 'Nebensätze ohne Angst',
    hook: 'Die häufigste Fehlerquelle im deutschen Satzbau — in fünf Minuten geknackt.',
    slides: [
      {
        kicker: 'LEKTION 3',
        title: 'Nebensätze ohne Angst',
        lines: [
          'Im Hauptsatz steht das Verb an Position zwei.',
          'Nach „weil“, „dass“ und „wenn“ wandert es ans Ende.',
          'Genau hier entscheidet sich, wie professionell Ihr Deutsch klingt.',
        ],
      },
      {
        kicker: 'DIE REGEL',
        title: 'Das Verb geht ans Ende',
        lines: [
          'Ein Nebensatz beginnt mit „weil“, „dass“ oder „wenn“.',
          'Das konjugierte Verb steht dann ganz am Ende.',
          'Im Arabischen und im Englischen bleibt das Verb vorne — im Deutschen nicht.',
        ],
      },
      {
        kicker: 'WEIL',
        title: 'weil — der Grund',
        lines: ['„weil“ nennt den Grund — und schickt das Verb ans Ende.'],
        falsch: 'Ich bleibe ruhig, weil ich bin professionell.',
        example: 'Ich bleibe ruhig, weil ich professionell bin.',
        speak: '„weil“ nennt den Grund — und schickt das Verb ans Ende. Falsch wäre: Ich bleibe ruhig, weil ich bin professionell. Richtig ist: Ich bleibe ruhig, weil ich professionell bin.',
      },
      {
        kicker: 'DASS',
        title: 'dass — die Aussage',
        lines: ['„dass“ steht oft nach Verben wie „verstehen“, „glauben“ und „sagen“.'],
        falsch: 'Ich verstehe, dass Sie sind verärgert.',
        example: 'Ich verstehe, dass Sie verärgert sind.',
        speak: '„dass“ steht oft nach Verben wie „verstehen“, „glauben“ und „sagen“. Falsch wäre: Ich verstehe, dass Sie sind verärgert. Richtig ist: Ich verstehe, dass Sie verärgert sind.',
      },
      {
        kicker: 'WENN',
        title: 'wenn — die Bedingung',
        lines: [
          '„wenn“ beschreibt eine Bedingung oder eine wiederkehrende Situation.',
          'Achtung: Trennbare Verben werden am Ende wieder zu einem Wort.',
        ],
        falsch: 'Wenn der Kunde ruft an, bleibe ich freundlich.',
        example: 'Wenn der Kunde anruft, bleibe ich freundlich.',
        speak: '„wenn“ beschreibt eine Bedingung. Achtung: Trennbare Verben werden am Ende wieder zu einem Wort. Falsch wäre: Wenn der Kunde ruft an, bleibe ich freundlich. Richtig ist: Wenn der Kunde anruft, bleibe ich freundlich.',
      },
      {
        kicker: 'ZUSAMMENFASSUNG',
        title: 'Verb ans Ende — immer',
        lines: [
          'Nach „weil“, „dass“ und „wenn“ steht das Verb am Ende — immer.',
          'Sagen Sie die drei richtigen Sätze laut — dreimal hintereinander.',
        ],
        note: 'Im Interview zählt jeder korrekte Nebensatz doppelt: Er zeigt echtes B1-Niveau.',
      },
    ],
  },
];

// ── Component ───────────────────────────────────────────────────────────────────────────────────
// `lang` is accepted for parity with the sibling drills; all copy is German-only by design law
// (Arabic is owner-authored later — see the OWNER-AR slots).
export function VideoLessons({ token, apiUrl, lang = 'de', onClose }) {   // eslint-disable-line no-unused-vars
  const [lesson, setLesson]     = useState(null);   // null → picker, else the playing lesson
  const [idx, setIdx]           = useState(0);      // current slide
  const [shown, setShown]       = useState(1);      // how many lines are revealed
  const [playing, setPlaying]   = useState(false);
  const [finished, setFinished] = useState(false);

  const stopTtsRef = useRef(null);   // stop() of the current narration
  const timersRef  = useRef([]);     // all pending timeouts of the current slide
  const runRef     = useRef(0);      // generation token — stale timers/onEnd no-op

  const [reducedMotion] = useState(() => {
    try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches; } catch { return false; }
  });

  const clearAll = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
    try { stopTtsRef.current?.(); } catch { /* ignore */ }
    stopTtsRef.current = null;
  }, []);

  useEffect(() => () => { runRef.current += 1; clearAll(); }, [clearAll]);

  // Play one slide: reveal lines on a timer, narrate, then advance (narration end + beat, never
  // before a minimum read time; hard fallback advances even if the audio element stalls forever).
  const startSlide = useCallback(function start(les, i) {
    runRef.current += 1;
    const run = runRef.current;
    clearAll();
    setLesson(les); setIdx(i); setFinished(false); setPlaying(true);

    const slide = les.slides[i];
    const total = (slide.lines || []).length;
    setShown(1);
    for (let n = 2; n <= total; n++) {
      timersRef.current.push(setTimeout(() => { if (runRef.current === run) setShown(n); }, LINE_MS * (n - 1)));
    }

    const text = speakTextOf(slide);
    const startedAt = Date.now();
    let advanced = false;
    const advance = () => {
      if (advanced || runRef.current !== run) return;
      advanced = true;
      if (i + 1 < les.slides.length) start(les, i + 1);
      else { runRef.current += 1; clearAll(); setShown(total || 1); setPlaying(false); setFinished(true); }
    };
    const minRead = clamp(text.length * 55, 3000, 25000);   // floor: an instant TTS failure must not skip the slide
    const onEnd = () => {
      if (runRef.current !== run) return;
      const wait = Math.max(BEAT_MS, minRead - (Date.now() - startedAt));
      timersRef.current.push(setTimeout(advance, wait));
    };
    timersRef.current.push(setTimeout(advance, clamp(text.length * 95 + 4000, 9000, 45000)));   // stalled-audio backstop
    stopTtsRef.current = playNative({ apiUrl, token, text, onEnd });
  }, [apiUrl, token, clearAll]);

  // ── controls ──
  const pause = () => {
    runRef.current += 1; clearAll(); setPlaying(false);
    setShown((lesson?.slides[idx]?.lines || []).length || 1);   // paused = the whole slide is readable
  };
  const resume  = () => startSlide(lesson, idx);                // restarts this slide's narration
  const prev    = () => startSlide(lesson, Math.max(0, idx - 1));
  const next    = () => {
    if (idx + 1 < lesson.slides.length) startSlide(lesson, idx + 1);
    else { runRef.current += 1; clearAll(); setPlaying(false); setFinished(true); }
  };
  const backToList = () => { runRef.current += 1; clearAll(); setLesson(null); setIdx(0); setFinished(false); setPlaying(false); };
  const close      = () => { runRef.current += 1; clearAll(); onClose?.(); };

  // ── shells ──
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #0a1626 0%, #050a12 55%, #020409 100%)',
      color: '#e2e8f0', padding: '20px 16px 32px', boxSizing: 'border-box', fontFamily: FONT,
      animation: reducedMotion ? 'none' : 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 520, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (backBtn) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#60a5fa' }}>
        🎬 VIDEO-LEKTIONEN{/* OWNER-AR slot: header label */}
      </span>
      <div style={{ display: 'flex', gap: 8 }}>
        {backBtn && <button onClick={backToList} style={ghostBtn}>‹ Übersicht{/* OWNER-AR slot */}</button>}
        <button onClick={close} style={ghostBtn}>Schließen ✕{/* OWNER-AR slot */}</button>
      </div>
    </div>
  );

  // ── PICKER ──
  if (!lesson) return shell(<>
    {header(false)}
    <div style={{ fontSize: 13, color: '#94a3b8', lineHeight: 1.6, marginBottom: 18 }}>
      Kurze Lektionen mit Stimme und Text — ansehen, anhören, mitnehmen.{/* OWNER-AR slot: picker intro */}
    </div>
    {LESSONS.map((les) => (
      <button key={les.id} onClick={() => startSlide(les, 0)} style={cardBtn}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc', lineHeight: 1.35 }}>{les.title}</span>
          <span style={{ fontSize: 11, color: '#60a5fa', whiteSpace: 'nowrap', fontWeight: 700 }}>▶ ≈ {estMinutes(les)} Min.</span>
        </div>
        <div style={{ fontSize: 12.5, color: '#94a3b8', lineHeight: 1.55, marginTop: 6 }}>{les.hook}</div>
        <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 8, letterSpacing: '0.06em' }}>
          {les.slides.length} KAPITEL · MIT NATIVER STIMME{/* OWNER-AR slot */}
        </div>
      </button>
    ))}
  </>);

  // ── FINISHED ──
  if (finished) return shell(<>
    {header(true)}
    <div style={{ textAlign: 'center', padding: '30px 0' }}>
      <div style={{ fontSize: 40 }}>✅</div>
      <div style={{ fontSize: 17, color: '#f8fafc', fontWeight: 800, marginTop: 10 }}>Lektion beendet{/* OWNER-AR slot */}</div>
      <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 6, lineHeight: 1.6 }}>{lesson.title}</div>
      <button onClick={() => startSlide(lesson, 0)} style={{ ...primaryBtn, marginTop: 20 }}>↺ Nochmal ansehen{/* OWNER-AR slot */}</button>
      <button onClick={backToList} style={{ ...ghostBtnWide, width: '100%', marginTop: 10 }}>Zur Übersicht{/* OWNER-AR slot */}</button>
    </div>
  </>);

  // ── PLAYER ──
  const slide = lesson.slides[idx];
  const lines = slide.lines || [];
  const riseIn = reducedMotion ? undefined : 'flash-in 0.45s ease';   // the ONE animation: text rise-in

  return shell(<>
    {header(true)}

    {/* slide progress bar */}
    <div style={{ display: 'flex', gap: 5, marginBottom: 6 }}>
      {lesson.slides.map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 99,
          background: i < idx ? '#3b82f6' : i === idx ? 'rgba(96,165,250,0.55)' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#64748b', marginBottom: 22, letterSpacing: '0.08em' }}>
      <span>{lesson.title.toUpperCase()}</span>
      <span>{idx + 1} / {lesson.slides.length}</span>
    </div>

    {/* the slide — kinetic typography */}
    <div key={`${lesson.id}-${idx}`} style={{ minHeight: 300 }}>
      {slide.kicker && (
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.2em', color: '#60a5fa', marginBottom: 10, animation: riseIn }}>
          {slide.kicker}
        </div>
      )}
      <div style={{ fontSize: 28, fontWeight: 900, color: '#f8fafc', lineHeight: 1.2, marginBottom: 18, animation: riseIn }}>
        {slide.title}
      </div>

      {lines.slice(0, shown).map((ln, i) => (
        <div key={i} style={{ fontSize: 15.5, color: '#cbd5e1', lineHeight: 1.65, marginBottom: 10,
          animation: i === shown - 1 ? riseIn : undefined }}>
          {ln}
        </div>
      ))}

      {shown >= lines.length && slide.falsch && (
        <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, animation: riseIn,
          background: 'rgba(148,163,184,0.06)', border: '1px solid rgba(148,163,184,0.3)' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', color: '#94a3b8', marginBottom: 6 }}>
            ✗ FALSCH — so nicht{/* OWNER-AR slot */}
          </div>
          <div style={{ fontSize: 16, color: '#94a3b8', lineHeight: 1.5, textDecoration: 'line-through', textDecorationColor: 'rgba(148,163,184,0.7)' }}>
            {slide.falsch}
          </div>
        </div>
      )}

      {shown >= lines.length && slide.example && (
        <div style={{ marginTop: 14, padding: '14px 16px', borderRadius: 10, animation: riseIn,
          background: 'rgba(59,130,246,0.10)', border: '1px solid rgba(96,165,250,0.4)', borderLeft: '3px solid #3b82f6' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.15em', color: '#60a5fa', marginBottom: 6 }}>
            {slide.falsch ? '✓ RICHTIG' : 'BEISPIEL'}{/* OWNER-AR slot */}
          </div>
          <div style={{ fontSize: 19, fontWeight: 700, color: '#f8fafc', lineHeight: 1.5 }}>{slide.example}</div>
        </div>
      )}

      {shown >= lines.length && slide.note && (
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 16, animation: riseIn }}>{slide.note}</div>
      )}
    </div>

    {/* transport controls */}
    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', alignItems: 'center', marginTop: 26 }}>
      <button onClick={prev} disabled={idx === 0} aria-label="Zurück"
        style={{ ...ctlBtn, opacity: idx === 0 ? 0.35 : 1, cursor: idx === 0 ? 'default' : 'pointer' }}>‹</button>
      <button onClick={playing ? pause : resume} aria-label={playing ? 'Pause' : 'Abspielen'} style={playBtn}>
        {playing ? '❚❚' : '▶'}
      </button>
      <button onClick={next} aria-label="Weiter" style={ctlBtn}>›</button>
      <button onClick={() => startSlide(lesson, idx)} aria-label="Kapitel wiederholen" style={ctlBtn}>↺</button>
    </div>
    <div style={{ textAlign: 'center', fontSize: 10.5, color: '#64748b', marginTop: 10 }}>
      {playing ? 'Läuft automatisch weiter — Pause zum Mitlesen.' : 'Pausiert — ▶ startet dieses Kapitel neu.'}{/* OWNER-AR slot */}
    </div>
  </>);
}

// ── styles (blue #3b82f6 base, orange #f97316 single action accent, slates on deep navy, Inter) ──
const FONT = "'Inter', system-ui, sans-serif";
const ghostBtn = { cursor: 'pointer', fontFamily: FONT, fontSize: 11, padding: '10px 12px', minHeight: 44, borderRadius: 8,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { cursor: 'pointer', fontFamily: FONT, fontSize: 12, padding: '12px', minHeight: 44, borderRadius: 9,
  border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: FONT, fontSize: 13,
  letterSpacing: '0.06em', borderRadius: 10, fontWeight: 800, border: '1px solid #60a5fa', color: '#04070d',
  background: 'linear-gradient(135deg,#60a5fa,#3b82f6)' };
const cardBtn = { display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', fontFamily: FONT, padding: '16px',
  minHeight: 44, borderRadius: 12, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(0,0,0,0.35)',
  color: '#e2e8f0', marginBottom: 12, boxSizing: 'border-box' };
const ctlBtn = { cursor: 'pointer', fontFamily: FONT, fontSize: 20, width: 50, height: 50, borderRadius: 12,
  border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.04)', color: '#cbd5e1', lineHeight: 1 };
const playBtn = { cursor: 'pointer', fontFamily: FONT, fontSize: 20, width: 64, height: 64, borderRadius: 16, fontWeight: 900,
  border: '1px solid #f97316', background: 'linear-gradient(135deg,#fb923c,#f97316)', color: '#04070d', lineHeight: 1 };

export default VideoLessons;
