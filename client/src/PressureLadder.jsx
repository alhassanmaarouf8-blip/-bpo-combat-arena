/**
 * PressureLadder.jsx — "DRUCK-LEITER": train HARDER than any real interview (PAID-feel, zero cost).
 *
 * Principle borrowed from elite sport / special-forces selection: rehearse under MORE pressure
 * than the real event, so the real one feels slow. The #1 reason a fluent-sounding candidate is
 * rejected is FREEZING when a German native goes fast, hostile, and interrupts. So we deliberately
 * overload: escalating speech speed (1.0→1.5×), rising hostility, shrinking answer windows, and the
 * boss talking OVER you. By the top rung, a real interview feels like slow motion.
 *
 * 100% client-side, zero cost: the boss voice is the browser's free speechSynthesis (the robotic
 * edge is FINE here — the point is pressure, not beauty). The learner speaks each round; we only
 * check they KEPT TALKING (audio captured) vs froze — the desensitization is the mechanism, not a
 * grade. No server endpoint, no API, nothing that can affect the live interview.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ClipRecorder } from './clipRecorder.js';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);

// The ladder. Each rung: faster, more hostile, less time, more interruptions.
const LEVELS = [
  { n: 1, de: 'Aufwärmen', ar: 'تسخين', rate: 1.0, sec: 55, interrupts: 0,
    line: 'Also — erzählen Sie mir kurz: warum sollten wir ausgerechnet Sie nehmen?', barbs: [] },
  { n: 2, de: 'Tempo', ar: 'سرعة', rate: 1.15, sec: 42, interrupts: 1,
    line: 'Gut. Und was ist Ihre größte Schwäche — und kommen Sie mir nicht mit Floskeln.',
    barbs: ['Ja, und weiter?'] },
  { n: 3, de: 'Ungeduldig', ar: 'نفاد صبر', rate: 1.3, sec: 32, interrupts: 2,
    line: 'Ein Kunde schreit Sie an, sein Paket ist weg. Was sagen Sie? Schnell.',
    barbs: ['Das reicht nicht — konkreter!', 'Ja, ja, weiter!'] },
  { n: 4, de: 'Feindselig', ar: 'عدائي', rate: 1.4, sec: 24, interrupts: 3,
    line: 'Ehrlich? Ihr Deutsch klingt nicht überzeugend. Überzeugen Sie mich in EINEM Satz.',
    barbs: ['Nein. Nochmal.', 'Sie weichen aus!', 'Zu langsam.'] },
  { n: 5, de: 'Endgegner', ar: 'الزعيم', rate: 1.5, sec: 18, interrupts: 4,
    line: 'Warum soll ich nicht einfach auflegen? Sie haben fünf Sekunden — los.',
    barbs: ['Schwach.', 'Weiter!', 'Das überzeugt niemanden.', 'Schneller!'] },
];

function speak(text, rate) {
  try {
    const s = window.speechSynthesis; if (!s) return false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'de-DE'; u.rate = Math.min(2, rate); u.pitch = 1;
    const de = (s.getVoices() || []).find((v) => /^de(-|_|$)/i.test(v.lang));
    if (de) u.voice = de;
    s.speak(u); return true;
  } catch { return false; }
}
const cancelSpeech = () => { try { window.speechSynthesis?.cancel(); } catch { /* ignore */ } };

export function PressureLadder({ lang = 'de', onClose }) {
  const [idx, setIdx]     = useState(0);          // current rung
  const [phase, setPhase] = useState('intro');    // intro | ready | answering | round | done
  const [left, setLeft]   = useState(0);          // seconds left this round
  const [survived, setSurvived] = useState(0);    // rungs survived
  const [froze, setFroze] = useState(false);

  const recRef = useRef(null); const tickRef = useRef(null); const barbRefs = useRef([]);
  const L = LEVELS[idx];

  const cleanup = useCallback(() => {
    clearInterval(tickRef.current); tickRef.current = null;
    barbRefs.current.forEach(clearTimeout); barbRefs.current = [];
    cancelSpeech();
    recRef.current?.stop?.().catch(() => {}); recRef.current = null;
  }, []);
  useEffect(() => () => cleanup(), [cleanup]);
  useEffect(() => { try { window.speechSynthesis?.getVoices(); } catch { /* ignore */ } }, []);

  const beginRound = async () => {
    setFroze(false); setPhase('answering'); setLeft(L.sec);
    // Boss fires the opening barb at native+ speed.
    speak(L.line, L.rate);
    // Start recording the learner immediately (mic may catch the boss — fine, it's overload).
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); recRef.current = rec; } catch { /* no mic → still run the timer */ }
    // Schedule interruptions: the boss talks OVER the learner at intervals.
    barbRefs.current = (L.barbs || []).slice(0, L.interrupts).map((b, i) => {
      const at = Math.round((L.sec * 1000) * ((i + 1) / (L.interrupts + 1)));
      return setTimeout(() => speak(b, Math.min(2, L.rate + 0.1)), at);
    });
    // Countdown.
    tickRef.current = setInterval(() => {
      setLeft((s) => {
        if (s <= 1) { clearInterval(tickRef.current); endRound(); return 0; }
        return s - 1;
      });
    }, 1000);
  };

  const endRound = async () => {
    clearInterval(tickRef.current); tickRef.current = null;
    barbRefs.current.forEach(clearTimeout); barbRefs.current = [];
    cancelSpeech();
    let kept = false;
    try {
      const rec = recRef.current; recRef.current = null;
      if (rec) { const clip = await rec.stop(); kept = !!(clip?.blob && clip.blob.size > 4000); }
    } catch { /* ignore */ }
    setFroze(!kept);
    if (kept) setSurvived((n) => Math.max(n, idx + 1));
    setPhase('round');
  };

  const nextRung = () => {
    if (idx < LEVELS.length - 1) { setIdx(idx + 1); setPhase('ready'); }
    else setPhase('done');
  };
  const retryRung = () => setPhase('ready');

  // ── shells ──
  const shell = (children) => (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, #1a0a0a 0%, #0a0506 55%, #020101 100%)',
      color: '#e2e8f0', padding: '20px 16px 32px', boxSizing: 'border-box', animation: 'flash-in 0.3s ease' }}>
      <div style={{ maxWidth: 460, margin: '0 auto' }}>{children}</div>
    </div>
  );
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
      <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 12, fontWeight: 900, letterSpacing: 2, color: '#ef4444' }}>
        🔥 DRUCK-LEITER · سُلّم الضغط
      </span>
      <button onClick={() => { cleanup(); onClose?.(); }} style={ghostBtn}>{T(lang, 'Schließen', 'إغلاق')} ✕</button>
    </div>
  );
  const ladder = (
    <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
      {LEVELS.map((lv, i) => (
        <div key={i} style={{ flex: 1, height: 5, borderRadius: 99,
          background: i < survived ? '#22c55e' : i === idx ? '#ef4444' : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>
  );

  if (phase === 'intro') return shell(<>
    {header}
    <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
      <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginBottom: 8 }}>{T(lang, 'Härter als jedes echte Interview.', 'أصعب من أي مقابلة حقيقية.')}</div>
      <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
        {T(lang,
          '5 Stufen. Jede Stufe spricht schneller, ist unhöflicher, gibt dir weniger Zeit — und redet dir rein. Dein Job: WEITERREDEN, nicht einfrieren. Wer hier besteht, für den fühlt sich das echte Gespräch wie Zeitlupe an.',
          '5 مستويات. كل مستوى بيتكلم أسرع، أقل أدبًا، ووقتك أقل — وهيقاطعك. مهمتك: تفضل بتتكلم، متجمدش. اللي بينجح هنا، المقابلة الحقيقية بتبقى بطيئة قدامه.')}
      </div>
    </div>
    <button onClick={() => setPhase('ready')} style={{ ...primaryBtn, marginTop: 16 }}>{T(lang, 'Leiter besteigen ▸', 'اطلع السلّم ▸')}</button>
  </>);

  if (phase === 'ready') return shell(<>
    {header}{ladder}
    <div style={{ textAlign: 'center', padding: '14px 0' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Orbitron,monospace', letterSpacing: '0.12em' }}>{T(lang, 'STUFE', 'مستوى')} {L.n} / 5</div>
      <div style={{ fontSize: 22, color: '#ef4444', fontWeight: 800, marginTop: 4 }}>{T(lang, L.de, L.ar)}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
        {T(lang, `Tempo ${Math.round(L.rate * 100)}% · ${L.sec}s · ${L.interrupts} Unterbrechungen`, `سرعة ${Math.round(L.rate * 100)}% · ${L.sec}ث · ${L.interrupts} مقاطعات`)}
      </div>
      <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 14, lineHeight: 1.6 }}>
        {T(lang, 'Sobald du startest, fragt der Boss SOFORT. Rede los und HÖR NICHT AUF.', 'أول ما تبدأ، الـ boss هيسأل على طول. اتكلم وماتسكتش.')}
      </div>
    </div>
    <button onClick={beginRound} style={{ ...primaryBtn }}>● {T(lang, 'START — Boss kommt', 'ابدأ — الـ boss جاي')}</button>
  </>);

  if (phase === 'answering') return shell(<>
    {header}{ladder}
    <div style={{ padding: '14px', borderRadius: 12, background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(239,68,68,0.4)' }}>
      <div style={{ fontSize: 9, color: '#ef4444', letterSpacing: '0.12em', marginBottom: 6 }}>{T(lang, 'DER BOSS', 'الـ boss')} · {T(lang, L.de, L.ar)}</div>
      <div style={{ fontSize: 16, color: '#f8fafc', lineHeight: 1.5 }}>{L.line}</div>
    </div>
    <div style={{ textAlign: 'center', marginTop: 18 }}>
      <div style={{ fontFamily: 'Orbitron,monospace', fontSize: 40, color: left <= 5 ? '#ef4444' : '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
        00:{String(left).padStart(2, '0')}
      </div>
      <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginTop: 4, letterSpacing: '0.05em' }}>{T(lang, '🔴 REDE WEITER — NICHT EINFRIEREN', '🔴 اتكلم — متجمدش')}</div>
      <button onClick={endRound} style={{ ...ghostBtnWide, width: '100%', marginTop: 16 }}>{T(lang, 'Fertig', 'خلصت')}</button>
    </div>
  </>);

  if (phase === 'round') return shell(<>
    {header}{ladder}
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontSize: 44 }}>{froze ? '🥶' : '💪'}</div>
      <div style={{ fontSize: 18, color: froze ? '#fca5a5' : '#6ee7b7', fontWeight: 800, marginTop: 8 }}>
        {froze ? T(lang, 'Eingefroren.', 'اتجمدت.') : T(lang, 'Standgehalten!', 'صمدت!')}
      </div>
      <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 8, lineHeight: 1.6, padding: '0 10px' }}>
        {froze
          ? T(lang, 'Genau das trainieren wir weg. Unter Druck schweigen kostet den Job. Nochmal — diesmal redest du einfach weiter, auch mit Fehlern.', 'ده بالظبط اللي بنتمرن نشيله. السكوت تحت الضغط بيضيّع الوظيفة. تاني — المرة دي اتكلم على طول حتى بأخطاء.')
          : T(lang, `Stufe ${L.n} überstanden — schneller und unhöflicher als ein echtes Interview. Weiter nach oben.`, `عديت مستوى ${L.n} — أسرع وأقسى من مقابلة حقيقية. كمّل لفوق.`)}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      {froze && <button onClick={retryRung} style={ghostBtnWide}>{T(lang, 'Nochmal', 'تاني')}</button>}
      <button onClick={froze ? retryRung : nextRung} style={{ ...primaryBtn, flex: 1 }}>
        {froze ? T(lang, 'Diese Stufe nochmal', 'المستوى ده تاني') : (idx < LEVELS.length - 1 ? T(lang, 'Nächste Stufe ▸', 'المستوى اللي بعده ▸') : T(lang, 'Finale ▸', 'النهاية ▸'))}
      </button>
    </div>
  </>);

  // done
  return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '24px 0' }}>
      <div style={{ fontSize: 48 }}>🏆</div>
      <div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 800, marginTop: 8 }}>{T(lang, 'Leiter bestiegen.', 'طلعت السلّم.')}</div>
      <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 10, lineHeight: 1.7, padding: '0 6px' }}>
        {T(lang,
          `Du hast gerade Schnelleres, Unhöflicheres und Härteres überstanden als jedes echte Bewerbungsgespräch. Das echte Interview wird sich jetzt wie Zeitlupe anfühlen — ruhig, höflich, viel Zeit. Genau dafür war das.`,
          'لسه عدّيت حاجة أسرع وأقسى وأصعب من أي مقابلة حقيقية. المقابلة الحقيقية هتبقى بطيئة دلوقتي — هادية، مؤدبة، وقت كتير. علشان كده عملناها.')}
      </div>
      <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 12, fontWeight: 700 }}>{T(lang, `Stufen standgehalten: ${survived}/5`, `مستويات صمدت فيها: ${survived}/5`)}</div>
    </div>
    <button onClick={() => { setIdx(0); setSurvived(0); setPhase('intro'); }} style={{ ...primaryBtn }}>{T(lang, 'Nochmal — von unten', 'تاني — من الأول')}</button>
    <button onClick={() => { cleanup(); onClose?.(); }} style={{ ...ghostBtnWide, width: '100%', marginTop: 10 }}>{T(lang, 'Fertig', 'تمام')}</button>
  </>);
}

const primaryBtn = { width: '100%', padding: '14px', minHeight: 50, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 13, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 800, border: '1px solid #ef4444', color: '#fff', background: 'linear-gradient(135deg,#ef4444,#dc2626)' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10, padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10.5, padding: '12px', minHeight: 44, borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
