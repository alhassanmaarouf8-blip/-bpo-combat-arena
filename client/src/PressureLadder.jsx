/**
 * PressureLadder.jsx — "DRUCK-LEITER" 2.0: train HARDER than any real interview (zero cost).
 *
 * Elite-sport / special-forces principle: rehearse under MORE pressure than the real event, so
 * the real one feels slow. The #1 reason a fluent candidate is rejected is FREEZING when a German
 * native goes fast, hostile, and interrupts. We overload deliberately: escalating speech speed
 * (1.0→1.6×), rising hostility, shrinking windows, the boss talking OVER you — now with VARIED
 * scenarios each run (never repetitive), an ENDLESS survival mode past the top rung, and a
 * resilience debrief. 100% client-side: free browser voice + ClipRecorder. No server, no API.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { ClipRecorder } from './clipRecorder.js';

const T = (lang, de, ar) => (lang === 'ar' ? ar : de);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

// WHY they froze — an honest inference from the ACTUAL rung they froze on: which pressure dimension
// (speed / shrinking time / interruptions) was most extreme there. Then the exact fix for that cause,
// so the student knows what to do instead of just "you froze".
function freezeMsg(L, lang) {
  // Map to the rung's DEFINING stressor (raw params) — matches what the rung actually is.
  if ((L.interrupts || 0) >= 3)                 // Feindselig / Endgegner: being talked over is the killer
    return T(lang,
      'Die Unterbrechungen haben dich rausgebracht. Technik: WEITERREDEN, nicht stoppen — „Lassen Sie mich kurz ausreden, dann…".',
      'المقاطعات هي اللي شتتتك. التكنيك: كمّل، ماتسكتش — «خليني أكمّل بسرعة وبعدها...».');
  if (L.sec <= 32)                              // Ungeduldig: the shrinking clock
    return T(lang,
      'Die kurze Zeit hat dich blockiert. Leg dir EINEN festen Startsatz bereit, mit dem du sofort loslegst („Gute Frage — also,…") — dann denkst du nicht bei null an.',
      'الوقت القصير لخبطك. حضّر جملة بداية واحدة جاهزة تبدأ بيها فورًا («سؤال كويس — يعني...») عشان متفكرش من الصفر.');
  if (L.rate >= 1.15)                           // Tempo: he went fast
    return T(lang,
      'Das Tempo hat dich erwischt. Trainier dein Ohr auf dieses Tempo im HÖR-CHECK — dann klingt das echte Gespräch langsam.',
      'السرعة هي اللي عرقلتك. درّب أذنك على السرعة دي في الـ HÖR-CHECK، وساعتها المقابلة الحقيقية تبقى بطيئة قدامك.');
  return T(lang,                                // Aufwärmen: slow, no interrupts, lots of time → it was words
    'Das war nicht der Druck — dir fehlten die Worte. Leg dir feste Antworten auf Standardfragen zu (FLOW-DRILL), dann hast du immer einen Satz parat.',
    'مش الضغط اللي جمّدك — اتلخبطت تقول إيه. حضّر إجابات جاهزة للأسئلة المتكررة (FLOW-DRILL)، وساعتها يبقى عندك جملة دايمًا.');
}

// Each rung: faster, ruder, less time, more interruptions. `lines` = a POOL (one picked per run,
// so repeats feel fresh). `barbs` = the talked-over interruptions for that rung.
const LEVELS = [
  { n: 1, de: 'Aufwärmen', ar: 'تسخين', rate: 1.0, sec: 55, interrupts: 0,
    lines: [
      'Also — erzählen Sie mir kurz: warum sollten wir ausgerechnet Sie nehmen?',
      'Gut, stellen Sie sich vor: Wer sind Sie, und warum Kundenservice?',
      'Fangen wir an. Was macht Sie für diesen Job geeignet?',
    ], barbs: [] },
  { n: 2, de: 'Tempo', ar: 'سرعة', rate: 1.18, sec: 42, interrupts: 1,
    lines: [
      'Und was ist Ihre größte Schwäche — und kommen Sie mir nicht mit Floskeln.',
      'Warum haben Sie Ihren letzten Job verlassen? Ehrlich.',
      'Beschreiben Sie eine Situation, in der Sie versagt haben. Schnell.',
    ], barbs: ['Ja, und weiter?', 'Konkreter, bitte.'] },
  { n: 3, de: 'Ungeduldig', ar: 'نفاد صبر', rate: 1.32, sec: 32, interrupts: 2,
    lines: [
      'Ein Kunde schreit Sie an, sein Paket ist weg. Was sagen Sie? Schnell.',
      'Der Kunde will sofort den Vorgesetzten. Sie haben einen Satz. Los.',
      'Die Rechnung ist falsch, der Kunde tobt. Reagieren Sie — jetzt.',
    ], barbs: ['Das reicht nicht — konkreter!', 'Ja, ja, weiter!', 'Zu vage.'] },
  { n: 4, de: 'Feindselig', ar: 'عدائي', rate: 1.45, sec: 24, interrupts: 3,
    lines: [
      'Ehrlich? Ihr Deutsch klingt nicht überzeugend. Überzeugen Sie mich in EINEM Satz.',
      'Ich habe schon zehn bessere Bewerber gesehen. Warum Sie?',
      'Sie wirken nervös. Warum sollte ich Ihnen einen Kunden anvertrauen?',
    ], barbs: ['Nein. Nochmal.', 'Sie weichen aus!', 'Zu langsam.', 'Das überzeugt nicht.'] },
  { n: 5, de: 'Endgegner', ar: 'الزعيم', rate: 1.6, sec: 18, interrupts: 4,
    lines: [
      'Warum soll ich nicht einfach auflegen? Sie haben fünf Sekunden — los.',
      'Geben Sie mir EINEN Grund, weiterzureden. Sofort.',
      'Sie haben es fast vermasselt. Retten Sie sich — jetzt, ein Satz.',
    ], barbs: ['Schwach.', 'Weiter!', 'Das überzeugt niemanden.', 'Schneller!', 'Nein.'] },
];
// Endless mode = rung-5 intensity, forever, with a tightening clock.
const ENDLESS = { rate: 1.6, baseSec: 16, interrupts: 4,
  lines: [
    'Noch ein Kunde, noch wütender. Beruhigen Sie ihn. Los.',
    'Der Chef hört mit. Beeindrucken Sie mich in einem Satz.',
    'Sie haben einen Fehler gemacht. Erklären Sie sich — schnell.',
    'Warum sind Sie besser als der letzte Bewerber? Sofort.',
    'Der Kunde droht zu kündigen. Ihr bester Satz — jetzt.',
  ], barbs: ['Weiter!', 'Schneller!', 'Schwach.', 'Nein, nochmal.', 'Das reicht nicht.'] };

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

// Real VOICED time (ms) from the recorded WAV (PCM16, 24 kHz, 44-byte header) — the honest "did they
// keep talking under pressure" signal (blob size is meaningless: uncompressed silence is still huge).
async function voicedMsFromBlob(blob) {
  try {
    if (!blob) return 0;
    const buf = await blob.arrayBuffer();
    if (buf.byteLength <= 44 + 960) return 0;
    const view = new DataView(buf);
    const RATE = 24000, WIN = 480, FLOOR = 0.012 * 32768;
    const nSamples = (buf.byteLength - 44) >> 1;
    let voiced = 0;
    for (let i = 0; i + WIN <= nSamples; i += WIN) {
      let sum = 0;
      for (let j = 0; j < WIN; j++) { const s = view.getInt16(44 + ((i + j) << 1), true); sum += s * s; }
      if (Math.sqrt(sum / WIN) >= FLOOR) voiced++;
    }
    return Math.round(voiced * (WIN / RATE) * 1000);
  } catch { return 0; }
}

export function PressureLadder({ lang = 'de', onClose }) {
  const [idx, setIdx]       = useState(0);          // rung index (LEVELS.length = endless)
  const [phase, setPhase]   = useState('intro');    // intro | ready | answering | round | done
  const [left, setLeft]     = useState(0);
  const [survived, setSurvived] = useState(0);      // rungs 1..5 survived
  const [froze, setFroze]   = useState(false);
  const [endlessStreak, setEndlessStreak] = useState(0);
  const [curLine, setCurLine] = useState('');

  const recRef = useRef(null); const tickRef = useRef(null); const barbRefs = useRef([]);
  const endless = idx >= LEVELS.length;
  const L = endless
    ? { n: '∞', de: 'Überleben', ar: 'بقاء', rate: ENDLESS.rate, sec: Math.max(10, ENDLESS.baseSec - endlessStreak), interrupts: ENDLESS.interrupts, lines: ENDLESS.lines, barbs: ENDLESS.barbs }
    : LEVELS[idx];

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
    const line = pick(L.lines); setCurLine(line);
    speak(line, L.rate);
    const rec = new ClipRecorder({ onVolume: () => {} });
    try { await rec.start(); recRef.current = rec; } catch { /* no mic → timer still runs */ }
    const nBarbs = Math.min(L.interrupts, L.barbs.length);
    barbRefs.current = Array.from({ length: nBarbs }, (_, i) => {
      const at = Math.round((L.sec * 1000) * ((i + 1) / (nBarbs + 1)));
      return setTimeout(() => speak(pick(L.barbs), Math.min(2, L.rate + 0.1)), at);
    });
    tickRef.current = setInterval(() => {
      setLeft((s) => { if (s <= 1) { clearInterval(tickRef.current); endRound(); return 0; } return s - 1; });
    }, 1000);
  };

  const endRound = async () => {
    clearInterval(tickRef.current); tickRef.current = null;
    barbRefs.current.forEach(clearTimeout); barbRefs.current = [];
    cancelSpeech();
    let kept = false;
    // "Survived" = they ACTUALLY kept talking. Blob SIZE is wrong (uncompressed WAV is huge even for
    // silence → always "survived"). Measure real VOICED time from the recorded PCM instead.
    try { const rec = recRef.current; recRef.current = null; if (rec) { const c = await rec.stop(); kept = (await voicedMsFromBlob(c?.blob)) >= 1500; } } catch { /* ignore */ }
    setFroze(!kept);
    if (kept) {
      if (endless) setEndlessStreak((n) => n + 1);
      else setSurvived((n) => Math.max(n, idx + 1));
    }
    setPhase('round');
  };

  const advance = () => {
    if (froze) { setPhase('ready'); return; }                  // retry same rung
    if (endless) { setPhase('ready'); return; }                // endless: keep going
    if (idx < LEVELS.length - 1) { setIdx(idx + 1); setPhase('ready'); }
    else setPhase('done');                                     // cleared rung 5
  };
  const goEndless = () => { setIdx(LEVELS.length); setEndlessStreak(0); setPhase('ready'); };

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
          background: i < survived ? '#22c55e' : (i === idx && !endless) ? '#ef4444' : 'rgba(255,255,255,0.08)' }} />
      ))}
      <div style={{ flex: 0.5, height: 5, borderRadius: 99, background: endless ? '#f59e0b' : 'rgba(255,255,255,0.08)' }} />
    </div>
  );

  if (phase === 'intro') return shell(<>
    {header}
    <div style={{ padding: '16px', borderRadius: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
      <div style={{ fontSize: 16, color: '#f8fafc', fontWeight: 700, marginBottom: 8 }}>{T(lang, 'Härter als jedes echte Interview.', 'أصعب من أي مقابلة حقيقية.')}</div>
      <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.7 }}>
        {T(lang,
          '5 Stufen + Überlebensmodus. Jede Stufe: schneller, unhöflicher, weniger Zeit — und der Boss redet dir rein. Dein Job: WEITERREDEN, nicht einfrieren. Wer hier besteht, für den fühlt sich das echte Gespräch wie Zeitlupe an.',
          '5 مستويات + وضع البقاء. كل مستوى: أسرع، أقل أدبًا، وقت أقل — والـ boss بيقاطعك. مهمتك: تفضل تتكلم، متجمدش. اللي بينجح هنا، المقابلة الحقيقية بتبقى بطيئة قدامه.')}
      </div>
    </div>
    <button onClick={() => setPhase('ready')} style={{ ...primaryBtn, marginTop: 16 }}>{T(lang, 'Leiter besteigen ▸', 'اطلع السلّم ▸')}</button>
  </>);

  if (phase === 'ready') return shell(<>
    {header}{ladder}
    <div style={{ textAlign: 'center', padding: '14px 0' }}>
      <div style={{ fontSize: 11, color: '#94a3b8', fontFamily: 'Orbitron,monospace', letterSpacing: '0.12em' }}>{endless ? T(lang, 'ÜBERLEBEN', 'بقاء') : `${T(lang, 'STUFE', 'مستوى')} ${L.n} / 5`}</div>
      <div style={{ fontSize: 22, color: endless ? '#f59e0b' : '#ef4444', fontWeight: 800, marginTop: 4 }}>{T(lang, L.de, L.ar)}{endless && endlessStreak > 0 ? ` · ${endlessStreak}` : ''}</div>
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
      <div style={{ fontSize: 16, color: '#f8fafc', lineHeight: 1.5 }}>{curLine}</div>
    </div>
    <div style={{ textAlign: 'center', marginTop: 18 }}>
      <div style={{ fontFamily: 'Orbitron,monospace', fontSize: 40, color: left <= 5 ? '#ef4444' : '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>00:{String(left).padStart(2, '0')}</div>
      <div style={{ fontSize: 11, color: '#ef4444', fontWeight: 700, marginTop: 4, letterSpacing: '0.05em' }}>{T(lang, '🔴 REDE WEITER — NICHT EINFRIEREN', '🔴 اتكلم — متجمدش')}</div>
      <button onClick={endRound} style={{ ...ghostBtnWide, width: '100%', marginTop: 16 }}>{T(lang, 'Fertig', 'خلصت')}</button>
    </div>
  </>);

  if (phase === 'round') return shell(<>
    {header}{ladder}
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <div style={{ fontSize: 44 }}>{froze ? '🥶' : '💪'}</div>
      <div style={{ fontSize: 18, color: froze ? '#fca5a5' : '#6ee7b7', fontWeight: 800, marginTop: 8 }}>
        {froze ? T(lang, 'Eingefroren.', 'اتجمدت.') : (endless ? T(lang, `Überlebt · Serie ${endlessStreak}`, `نجوت · سلسلة ${endlessStreak}`) : T(lang, 'Standgehalten!', 'صمدت!'))}
      </div>
      <div style={{ fontSize: 12.5, color: '#cbd5e1', marginTop: 8, lineHeight: 1.6, padding: '0 10px' }}>
        {froze
          ? freezeMsg(L, lang)
          : endless
            ? T(lang, 'Schneller und härter als jedes echte Gespräch — und du redest weiter. Noch eine?', 'أسرع وأقسى من أي مقابلة — وانت لسه بتتكلم. كمان وحدة؟')
            : T(lang, `Stufe ${L.n} überstanden — schneller und unhöflicher als ein echtes Interview. Weiter nach oben.`, `عديت مستوى ${L.n} — أسرع وأقسى من مقابلة حقيقية. كمّل لفوق.`)}
      </div>
    </div>
    <div style={{ display: 'flex', gap: 8 }}>
      {froze && <button onClick={() => setPhase('ready')} style={ghostBtnWide}>{T(lang, 'Nochmal', 'تاني')}</button>}
      <button onClick={advance} style={{ ...primaryBtn, flex: 1 }}>
        {froze ? T(lang, 'Diese Stufe nochmal', 'المستوى ده تاني')
          : endless ? T(lang, 'Weiter überleben ▸', 'كمّل بقاء ▸')
          : (idx < LEVELS.length - 1 ? T(lang, 'Nächste Stufe ▸', 'المستوى اللي بعده ▸') : T(lang, 'Finale ▸', 'النهاية ▸'))}
      </button>
    </div>
  </>);

  // done (cleared rung 5)
  return shell(<>
    {header}
    <div style={{ textAlign: 'center', padding: '22px 0' }}>
      <div style={{ fontSize: 48 }}>🏆</div>
      <div style={{ fontSize: 18, color: '#f8fafc', fontWeight: 800, marginTop: 8 }}>{T(lang, 'Leiter bestiegen.', 'طلعت السلّم.')}</div>
      <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 10, lineHeight: 1.7, padding: '0 6px' }}>
        {T(lang,
          'Du hast Schnelleres, Unhöflicheres und Härteres überstanden als jedes echte Bewerbungsgespräch. Das echte Interview wird sich jetzt wie Zeitlupe anfühlen — ruhig, höflich, viel Zeit.',
          'عدّيت حاجة أسرع وأقسى وأصعب من أي مقابلة حقيقية. المقابلة الحقيقية هتبقى بطيئة دلوقتي — هادية، مؤدبة، وقت كتير.')}
      </div>
      <div style={{ fontSize: 12, color: '#6ee7b7', marginTop: 12, fontWeight: 700 }}>{T(lang, `Stufen standgehalten: ${survived}/5`, `مستويات صمدت فيها: ${survived}/5`)}</div>
    </div>
    <button onClick={goEndless} style={{ ...primaryBtn, background: 'linear-gradient(135deg,#f59e0b,#dc2626)', borderColor: '#f59e0b' }}>♾️ {T(lang, 'ÜBERLEBENSMODUS — endlos', 'وضع البقاء — بلا حدود')}</button>
    <button onClick={() => { setIdx(0); setSurvived(0); setPhase('intro'); }} style={{ ...ghostBtnWide, width: '100%', marginTop: 10 }}>{T(lang, 'Von vorne', 'من الأول')}</button>
    <button onClick={() => { cleanup(); onClose?.(); }} style={{ ...ghostBtnWide, width: '100%', marginTop: 8 }}>{T(lang, 'Fertig', 'تمام')}</button>
  </>);
}

const primaryBtn = { width: '100%', padding: '14px', minHeight: 50, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 13, letterSpacing: '0.08em', borderRadius: 10, fontWeight: 800, border: '1px solid #ef4444', color: '#fff', background: 'linear-gradient(135deg,#ef4444,#dc2626)' };
const ghostBtn = { cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10, padding: '6px 10px', borderRadius: 7, border: '1px solid rgba(148,163,184,0.3)', background: 'transparent', color: '#94a3b8' };
const ghostBtnWide = { flex: 1, cursor: 'pointer', fontFamily: 'Orbitron, monospace', fontSize: 10.5, padding: '12px', minHeight: 44, borderRadius: 9, border: '1px solid rgba(148,163,184,0.35)', background: 'rgba(255,255,255,0.03)', color: '#cbd5e1' };
