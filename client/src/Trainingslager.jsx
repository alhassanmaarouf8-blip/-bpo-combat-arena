/**
 * Trainingslager.jsx — the gamified study-map UI.
 *
 *   <Trainingslager>   full-screen route: a MEANDERING vertical journey (SVG curved path)
 *                      through the recommended lessons, ending at the Boss-Tor.
 *   <GameMapCompact>   a compact horizontal teaser for the home + results screens.
 *
 * Three node states: LOCKED (dim/grayscale/padlock), AVAILABLE (full colour + gentle glowing
 * ring + hover-scale — the current step), DONE (amber checkmark, solid border, muted fill).
 * Data comes from GET /api/trainingslager (Phase 2). No AI, no Realtime — pure rendering.
 *
 * Performance: SVG path + a handful of absolutely-positioned nodes; the only animation is one
 * cheap CSS ring pulse on the single AVAILABLE node. Respects prefers-reduced-motion.
 */
import { useState, useEffect, useCallback, Fragment } from 'react';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

const ICONS = {
  'konjunktiv-2': '🎩', 'dativ-akkusativ': '🎯', 'trennbare-verben': '✂️', 'passiv': '🔄',
  'futur-1': '⏩', 'komparativ-superlativ': '📈', 'relativsaetze': '🔗', 'praeteritum': '📜',
  'w-fragen': '❓', 'negation': '🚫', 'adjektivendungen': '🏷️', 'modalverben': '🔑',
  'telefonalphabet': '🔤', 'telefonieren': '📞', 'reklamation': '📣', 'vorstellungsgespraech': '💼',
  'online-einkauf': '🛒', 'kunden-beruhigen': '🧘', 'zahlen-datum-geld': '💶', 'hoeflichkeit': '🤝',
};
const iconFor = (ruleId) => ICONS[ruleId] || '📚';

// Inject the small style block (ring pulse + hover + reduced-motion) exactly once.
function injectStyleOnce() {
  if (typeof document === 'undefined' || document.getElementById('tl-styles')) return;
  const el = document.createElement('style');
  el.id = 'tl-styles';
  el.textContent = `
    @keyframes tl-ring { 0%{transform:translate(-50%,-50%) scale(0.85);opacity:0.55} 100%{transform:translate(-50%,-50%) scale(1.9);opacity:0} }
    .tl-ring-el { animation: tl-ring 1.9s ease-out infinite; }
    .tl-avail { transition: transform 0.18s ease; }
    @media (hover:hover){ .tl-avail:hover { transform: scale(1.06); } }
    .tl-path-lit { transition: opacity 0.4s ease; }
    @media (prefers-reduced-motion: reduce){ .tl-ring-el{ animation:none; opacity:0.4 } .tl-avail{ transition:none } }
  `;
  document.head.appendChild(el);
}

// LOCKED before the first not-done lesson stays locked; the first not-done is AVAILABLE.
function deriveStates(lessons) {
  let foundAvailable = false;
  const nodes = (lessons || []).map((l) => {
    let state;
    if (l.done) state = 'done';
    else if (!foundAvailable) { state = 'available'; foundAvailable = true; }
    else state = 'locked';
    return { ...l, state };
  });
  const allDone = nodes.length > 0 && nodes.every((n) => n.state === 'done');
  return { nodes, bossState: allDone ? 'available' : 'locked' };
}

// ── data hook (shared by both views); reload() re-fetches after a lesson completes ──
function useRecommendations(token, apiUrl) {
  const [lessons, setLessons] = useState(null);
  const reload = useCallback(() => {
    fetch(`${apiUrl}/api/trainingslager`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => setLessons(Array.isArray(d.lessons) ? d.lessons : []))
      .catch(() => setLessons([]));
  }, [token, apiUrl]);
  useEffect(() => { injectStyleOnce(); reload(); }, [reload]);
  return { lessons, reload };
}

// Valid YouTube IDs are exactly 11 chars of [A-Za-z0-9_-]; anything else (incl. PLACEHOLDER) → no embed.
function isValidYtId(id) { return typeof id === 'string' && /^[A-Za-z0-9_-]{11}$/.test(id); }

// Deterministic option shuffle so the correct answer isn't always in the same position,
// but stays stable across re-renders (seeded by ruleId+question index).
function seededOrder(seed, n) {
  let s = 0;
  for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const arr = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ═══════════════════════════ FULL MEANDERING MAP (route) ═══════════════════════════
const SPACING = 104;   // vertical px between node centers
const TOP     = 46;
const XL = 28, XR = 72; // left / right meander columns (percent)

function buildPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], my = (a.y + b.y) / 2;
    d += ` C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`;   // smooth vertical S-curve
  }
  return d;
}

export function Trainingslager({ token, apiUrl, lang = 'de', onClose }) {
  const { lessons, reload } = useRecommendations(token, apiUrl);
  const [openId, setOpenId] = useState(null);   // ruleId of the lesson modal, or null

  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 250, overflowY: 'auto',
      background: 'radial-gradient(120% 80% at 50% 0%, #0c1a14 0%, #08110d 45%, #050708 100%)',
      color: '#e2e8f0', padding: '18px 14px 40px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 420, margin: '0 auto' }}>{children}</div>
    </div>
  );

  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 13, fontWeight: 900, letterSpacing: 1.5, color: '#fbbf24' }}>
        🏕️ TRAININGSLAGER
      </span>
      <button onClick={onClose} style={ghost}>{T(lang, 'Schließen', 'إغلاق')} ✕</button>
    </div>
  );

  if (!lessons) return shell(<><div style={{ textAlign: 'center', color: '#94a3b8', padding: 50 }}>…</div></>);

  const { nodes, bossState } = deriveStates(lessons);
  const doneCount = nodes.filter((n) => n.state === 'done').length;

  // node + boss coordinates (viewBox space: x 0–100, y in px)
  const pts = nodes.map((_, i) => ({ x: i % 2 === 0 ? XL : XR, y: TOP + i * SPACING }));
  const bossPt = { x: 50, y: TOP + nodes.length * SPACING };
  const allPts = [...pts, bossPt];
  const H = bossPt.y + 70;
  const litPts = allPts.slice(0, doneCount + 1); // traveled = done nodes + current

  return shell(<>
    {header}

    <div dir={lang === 'ar' ? 'rtl' : 'ltr'} style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.6, marginBottom: 10 }}>
      {T(lang, 'Dein persönlicher Lernpfad — basierend auf deinen häufigsten Fehlern. Schließe die Stationen ab, um das Boss-Tor zu öffnen.',
              'مسارك التعليمي الشخصي — حسب أكتر أخطاء بتكررها. خلّص المحطات عشان تفتح بوابة التحدي.')}
    </div>

    {/* legend: shows the three states explicitly */}
    <div style={{ display: 'flex', gap: 12, justifyContent: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
      <Legend dot={<MiniDot state="done" />} label={T(lang, 'Erledigt', 'تمّ')} />
      <Legend dot={<MiniDot state="available" />} label={T(lang, 'Jetzt dran', 'دورك دلوقتي')} />
      <Legend dot={<MiniDot state="locked" />} label={T(lang, 'Gesperrt', 'مقفول')} />
    </div>

    {/* the meandering map */}
    <div style={{ position: 'relative', width: '100%', height: H, marginTop: 4 }}>
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <path d={buildPath(allPts)} fill="none" stroke="rgba(148,163,184,0.22)" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {litPts.length >= 2 && (
          <path className="tl-path-lit" d={buildPath(litPts)} fill="none" stroke="#fbbf24" strokeWidth="3" strokeLinecap="round" vectorEffect="non-scaling-stroke" style={{ filter: 'drop-shadow(0 0 4px rgba(251,191,36,0.5))' }} />
        )}
      </svg>

      {nodes.map((n, i) => (
        <MapNode key={n.ruleId} node={n} x={pts[i].x} y={pts[i].y} lang={lang}
          onOpen={() => n.state === 'available' && setOpenId(n.ruleId)} />
      ))}
      <BossNode x={bossPt.x} y={bossPt.y} state={bossState} lang={lang} />
    </div>

    {/* Lesson modal — blurs the map behind it (backdrop-filter); never ejects to YouTube */}
    {openId && (
      <LessonScreen token={token} apiUrl={apiUrl} lang={lang} ruleId={openId}
        onClose={() => setOpenId(null)}
        onPassed={() => { reload(); }} />
    )}
  </>);
}

// ═══════════════════════════ THE LESSON SCREEN (video + quiz) ═══════════════════════════
function LessonScreen({ token, apiUrl, lang, ruleId, onClose, onPassed }) {
  const [lesson, setLesson] = useState(null);
  const [answers, setAnswers] = useState({});   // qIndex -> chosen ORIGINAL option index
  const [phase, setPhase] = useState('quiz');    // quiz | passed | failed
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    fetch(`${apiUrl}/api/trainingslager/lesson/${encodeURIComponent(ruleId)}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((d) => { if (!cancel) setLesson(d.lesson || null); })
      .catch(() => { if (!cancel) setLesson(null); });
    return () => { cancel = true; };
  }, [ruleId, token, apiUrl]);

  const overlay = (children) => (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 60, display: 'flex', justifyContent: 'center',
      alignItems: 'flex-start', overflowY: 'auto', padding: '16px 12px 36px',
      background: 'rgba(3,7,10,0.72)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 440, borderRadius: 16,
        background: 'linear-gradient(180deg, rgba(12,22,18,0.98), rgba(6,12,10,0.99))',
        border: '1px solid rgba(251,191,36,0.3)', boxShadow: '0 0 40px rgba(0,0,0,0.6)', padding: 16, animation: 'flash-in 0.25s ease' }}>
        {children}
      </div>
    </div>
  );

  if (!lesson) return overlay(<div style={{ textAlign: 'center', color: '#94a3b8', padding: 40 }}>…</div>);

  const ytId = lang === 'ar' ? (lesson.youtubeId_ar) : (lesson.youtubeId_de);
  const ytIdFallback = isValidYtId(ytId) ? ytId : (isValidYtId(lesson.youtubeId_de) ? lesson.youtubeId_de : lesson.youtubeId_ar);
  const playable = isValidYtId(ytIdFallback);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    const ordered = lesson.quiz.map((_, i) => (i in answers ? answers[i] : -1));
    try {
      const r = await fetch(`${apiUrl}/api/trainingslager/lesson/${encodeURIComponent(ruleId)}/complete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ answers: ordered }),
      });
      const d = await r.json();
      if (r.ok && d.passed) { setPhase('passed'); onPassed?.(); }
      else setPhase('failed');
    } catch { setPhase('failed'); }
    setBusy(false);
  };

  const retry = () => { setAnswers({}); setPhase('quiz'); };
  const answeredAll = lesson.quiz.every((_, i) => i in answers);

  return overlay(<>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 10 }}>
      <div>
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 13, fontWeight: 800, color: '#fbbf24', lineHeight: 1.3 }}>{lesson.title_de}</div>
        <div dir="rtl" style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{lesson.title_ar}</div>
      </div>
      <button onClick={onClose} style={ghost}>✕</button>
    </div>

    {/* video (responsive 16:9) or a friendly placeholder until a real ID is pasted */}
    {playable ? (
      <div style={{ position: 'relative', width: '100%', paddingBottom: '56.25%', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
        <iframe style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          src={`https://www.youtube-nocookie.com/embed/${ytIdFallback}`} title={lesson.title_de}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen />
      </div>
    ) : (
      <div style={{ width: '100%', paddingBottom: '56.25%', position: 'relative', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px dashed rgba(148,163,184,0.3)' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center', color: '#64748b', fontSize: 12, padding: 12 }}>
          {T(lang, '🎬 Video kommt bald — der Kurs-Quiz funktioniert schon.', '🎬 الفيديو هييجي قريب — الكويز شغّال خلاص.')}
        </div>
      </div>
    )}

    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, fontSize: 10 }}>
      {playable
        ? <a href={`https://www.youtube.com/watch?v=${ytIdFallback}`} target="_blank" rel="noopener noreferrer" style={{ color: '#60a5fa' }}>{T(lang, 'auf YouTube öffnen ↗', 'افتح على يوتيوب ↗')}</a>
        : <span />}
      {lesson.teacherName ? (
        <a href={lesson.teacherChannelUrl || '#'} target="_blank" rel="noopener noreferrer" style={{ color: '#94a3b8' }}>
          {T(lang, 'mit ', 'مع ')}<b style={{ color: '#cbd5e1' }}>{lesson.teacherName}</b>
        </a>
      ) : <span />}
    </div>

    {/* Schlüssel-Quiz */}
    <div style={{ marginTop: 16 }}>
      <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 10, letterSpacing: '0.12em', color: '#fbbf24', marginBottom: 10 }}>
        🔑 {T(lang, 'SCHLÜSSEL-QUIZ', 'كويز المفتاح')} · {T(lang, '2 von 3 zum Bestehen', '٢ من ٣ عشان تعدّي')}
      </div>

      {lesson.quiz.map((q, qi) => {
        const order = seededOrder(`${ruleId}:${qi}`, q.options.length);
        const chosen = answers[qi]; // original index chosen (or undefined)
        const locked = qi in answers;
        return (
          <div key={qi} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.5, marginBottom: 2 }}>{qi + 1}. {q.question_de}</div>
            <div dir="rtl" style={{ fontSize: 11, color: '#94a3b8', marginBottom: 7 }}>{q.question_ar_hint}</div>
            <div style={{ display: 'grid', gap: 6 }}>
              {order.map((origIdx, pos) => {
                const isChosen = chosen === origIdx;
                const isCorrect = origIdx === q.correctIndex;
                let bg = 'rgba(255,255,255,0.04)', border = 'rgba(148,163,184,0.25)', col = '#e2e8f0';
                if (locked && isCorrect) { bg = 'rgba(16,185,129,0.18)'; border = '#10b981'; col = '#d1fae5'; }
                else if (locked && isChosen && !isCorrect) { bg = 'rgba(239,68,68,0.16)'; border = '#ef4444'; col = '#fecaca'; }
                return (
                  <button key={pos} disabled={locked}
                    onClick={() => !locked && setAnswers((a) => ({ ...a, [qi]: origIdx }))}
                    style={{ textAlign: 'left', padding: '10px 12px', minHeight: 42, borderRadius: 9, cursor: locked ? 'default' : 'pointer',
                      border: `1px solid ${border}`, background: bg, color: col, fontSize: 12.5, lineHeight: 1.35,
                      transition: 'background 0.15s, border-color 0.15s' }}>
                    {locked && isCorrect ? '✓ ' : locked && isChosen && !isCorrect ? '✗ ' : ''}{q.options[origIdx]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {phase === 'quiz' && (
        <button onClick={submit} disabled={!answeredAll || busy}
          style={{ ...primaryBtn, opacity: (!answeredAll || busy) ? 0.5 : 1 }}>
          {busy ? '…' : answeredAll ? T(lang, 'Ergebnis ansehen', 'شوف النتيجة') : T(lang, 'Alle 3 beantworten', 'جاوب الـ٣ كلهم')}
        </button>
      )}

      {phase === 'passed' && (
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <div style={{ fontSize: 30 }}>✅</div>
          <div style={{ fontSize: 14, color: '#34d399', fontWeight: 700, marginTop: 4 }}>{T(lang, 'Bestanden! Station erledigt.', 'نجحت! المحطة اتخلّصت.')}</div>
          <button onClick={onClose} style={{ ...primaryBtn, marginTop: 12 }}>{T(lang, 'Zur Karte', 'للخريطة')} ▸</button>
        </div>
      )}

      {phase === 'failed' && (
        <div style={{ textAlign: 'center', marginTop: 6 }}>
          <div style={{ fontSize: 13, color: '#fca5a5', lineHeight: 1.6 }}>
            {T(lang, 'Noch nicht bestanden — schau dir das Video nochmal an und versuch es erneut.', 'لسه ماعديتش — اتفرّج على الفيديو تاني وجرّب كمان مرة.')}
          </div>
          <button onClick={retry} style={{ ...primaryBtn, marginTop: 12 }}>{T(lang, 'Nochmal versuchen', 'حاول تاني')}</button>
        </div>
      )}
    </div>
  </>);
}

const primaryBtn = { width: '100%', padding: '13px', minHeight: 48, cursor: 'pointer', fontFamily: 'Orbitron, monospace',
  fontSize: 12, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 700, border: '1px solid #fbbf24', color: '#04070d',
  background: 'linear-gradient(135deg,#fcd34d,#fbbf24)' };

function Legend({ dot, label }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 9.5, color: '#94a3b8' }}>{dot}{label}</span>;
}
function MiniDot({ state }) {
  const c = state === 'done' ? '#34d399' : state === 'available' ? '#fbbf24' : '#475569';
  return <span style={{ width: 12, height: 12, borderRadius: '50%', border: `2px solid ${c}`,
    background: state === 'done' ? 'rgba(52,211,153,0.2)' : 'transparent', filter: state === 'locked' ? 'grayscale(1)' : 'none',
    display: 'inline-block' }} />;
}

function nodeColors(state) {
  if (state === 'done')      return { ring: '#34d399', bg: 'rgba(52,211,153,0.12)', text: '#d1fae5' };
  if (state === 'available') return { ring: '#fbbf24', bg: 'rgba(251,191,36,0.14)', text: '#fde68a' };
  return { ring: '#475569', bg: 'rgba(255,255,255,0.03)', text: '#64748b' }; // locked
}

function MapNode({ node, x, y, lang, onOpen }) {
  const { state } = node;
  const c = nodeColors(state);
  const size = 60;
  const locked = state === 'locked';
  const title = T(lang, node.title_de, node.title_ar);

  // The wrapper is exactly the circle's box, centered on (x%, y) so the SVG path hits its center.
  return (
    <div style={{ position: 'absolute', left: `${x}%`, top: y, width: size, height: size, transform: 'translate(-50%,-50%)' }}>
      {state === 'available' && (
        <span className="tl-ring-el" style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, borderRadius: '50%', border: '2px solid #fbbf24', pointerEvents: 'none' }} />
      )}
      <button
        className={state === 'available' ? 'tl-avail' : undefined}
        onClick={onOpen}
        disabled={state !== 'available'}
        aria-label={title}
        style={{
          position: 'relative', width: size, height: size, borderRadius: '50%',
          display: 'grid', placeItems: 'center', fontSize: 24,
          cursor: state === 'available' ? 'pointer' : 'default',
          border: `2px solid ${c.ring}`, background: c.bg, color: '#fff',
          boxShadow: state === 'available' ? '0 0 18px rgba(251,191,36,0.4)' : state === 'done' ? '0 0 10px rgba(52,211,153,0.25)' : 'none',
          opacity: locked ? 0.5 : 1, filter: locked ? 'grayscale(1)' : 'none',
        }}>
        {locked ? '🔒' : iconFor(node.ruleId)}
        {state === 'done' && (
          <span style={{ position: 'absolute', right: -4, top: -4, width: 20, height: 20, borderRadius: '50%', background: '#34d399', color: '#04130c', fontSize: 12, display: 'grid', placeItems: 'center', fontWeight: 900 }}>✓</span>
        )}
      </button>
      <div style={{ position: 'absolute', top: size + 5, left: '50%', transform: 'translateX(-50%)', width: 150, textAlign: 'center',
        fontSize: 10.5, color: c.text, lineHeight: 1.3, overflowWrap: 'anywhere', fontWeight: state === 'available' ? 700 : 400 }}>{title}</div>
    </div>
  );
}

function BossNode({ x, y, state, lang }) {
  const unlocked = state === 'available';
  const size = 76;
  return (
    <div style={{ position: 'absolute', left: `${x}%`, top: y, width: size, height: size, transform: 'translate(-50%,-50%)' }}>
      {unlocked && <span className="tl-ring-el" style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, borderRadius: '50%', border: '2px solid #f59e0b', pointerEvents: 'none' }} />}
      <div style={{ width: size, height: size, borderRadius: '50%', display: 'grid', placeItems: 'center',
        fontSize: 32, border: `3px solid ${unlocked ? '#f59e0b' : '#475569'}`,
        background: unlocked ? 'radial-gradient(circle, rgba(245,158,11,0.25), rgba(245,158,11,0.05))' : 'rgba(255,255,255,0.03)',
        boxShadow: unlocked ? '0 0 26px rgba(245,158,11,0.5)' : 'none', opacity: unlocked ? 1 : 0.55, filter: unlocked ? 'none' : 'grayscale(1)' }}>
        {unlocked ? '🏰' : '🔒'}
      </div>
      <div style={{ position: 'absolute', top: size + 6, left: '50%', transform: 'translateX(-50%)', width: 170, textAlign: 'center' }}>
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 11, fontWeight: 900, letterSpacing: 1, color: unlocked ? '#fbbf24' : '#64748b' }}>BOSS-TOR</div>
        <div dir="rtl" style={{ fontSize: 10, color: unlocked ? '#94a3b8' : '#475569' }}>بوابة التحدي</div>
      </div>
    </div>
  );
}

// ═══════════════════════════ COMPACT HORIZONTAL TEASER ═══════════════════════════
export function GameMapCompact({ token, apiUrl, lang = 'de', onOpen }) {
  const { lessons } = useRecommendations(token, apiUrl);
  if (!lessons || lessons.length === 0) return null;

  const { nodes, bossState } = deriveStates(lessons);
  const doneCount = nodes.filter((n) => n.state === 'done').length;
  const items = [...nodes, { ruleId: '__boss__', boss: true, state: bossState }];

  return (
    <button onClick={onOpen} style={{ width: '100%', marginTop: 8, padding: '10px 12px', minHeight: 44, cursor: 'pointer',
      borderRadius: 10, border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.06)', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
        <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 9.5, letterSpacing: '0.12em', color: '#fbbf24' }}>🏕️ TRAININGSLAGER</span>
        <span style={{ fontSize: 9, color: '#94a3b8' }}>{doneCount}/{nodes.length} ✓</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', overflowX: 'auto' }}>
        {items.map((n, i) => (
          <Fragment key={n.ruleId}>
            {i > 0 && <span style={{ width: 18, height: 3, borderRadius: 9, flexShrink: 0, background: i <= doneCount ? '#fbbf24' : 'rgba(148,163,184,0.25)' }} />}
            <CompactNode node={n} />
          </Fragment>
        ))}
      </div>
    </button>
  );
}

function CompactNode({ node }) {
  const boss = node.boss;
  const c = nodeColors(boss && node.state === 'available' ? 'available' : node.state);
  const locked = node.state === 'locked';
  return (
    <span style={{ position: 'relative', flexShrink: 0, width: 30, height: 30, borderRadius: '50%', display: 'grid', placeItems: 'center',
      fontSize: 14, border: `2px solid ${boss && node.state === 'available' ? '#f59e0b' : c.ring}`, background: c.bg,
      opacity: locked ? 0.5 : 1, filter: locked ? 'grayscale(1)' : 'none' }}>
      {boss ? (node.state === 'available' ? '🏰' : '🔒') : locked ? '🔒' : node.state === 'done' ? '✓' : iconFor(node.ruleId)}
    </span>
  );
}

const ghost = { cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10, padding: '6px 10px', borderRadius: 7,
  border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
