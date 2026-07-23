/**
 * CustomQuestions.jsx — "Meine eigenen Fragen": the candidate uploads photos/screenshots of the
 * exact questions they expect at their target employer; a vision model extracts them as German
 * interview questions; the candidate CONFIRMS/edits the list; then the normal voice interview asks
 * THOSE questions (persona + scoring unchanged — see server/customQuestions.js + scenarios.js).
 *
 * Honesty (anti-slop): the confirm/edit step is mandatory — no interview ever starts on raw OCR, and
 * when nothing is recognized the UI says so plainly and lets the user type their own. Raw images are
 * used only to extract text and are never stored. Single orange per screen (design-system law).
 * Bilingual DE + empty OWNER-AR slots (masri filled by the owner, never authored here).
 */
import { useState, useEffect, useCallback } from 'react';
import { actionBtn, ghostBtn } from './ui/primitives.js';

const MAX_IMAGES = 5;
const MAX_QUESTIONS = 15;

const T = {
  title:      { de: 'Meine eigenen Fragen', ar: '' },
  intro:      { de: 'Lade Fotos oder Screenshots der Fragen hoch, die du im echten Interview erwartest — wir üben genau die.', ar: '' },
  pick:       { de: 'Bilder wählen', ar: '' },
  pickMore:   { de: 'Weitere Bilder', ar: '' },
  extract:    { de: 'Fragen erkennen', ar: '' },
  extracting: { de: 'Fragen werden erkannt …', ar: '' },
  none:       { de: 'Keine Fragen erkannt — tippe sie unten selbst ein oder lade ein klareres Bild hoch.', ar: '' },
  confirmHint:{ de: 'Prüfe und korrigiere die Fragen. Entferne, was nicht passt, und füge eigene hinzu.', ar: '' },
  add:        { de: '+ Frage hinzufügen', ar: '' },
  start:      { de: 'Interview mit meinen Fragen starten', ar: '' },
  saving:     { de: 'Wird gespeichert …', ar: '' },
  close:      { de: 'Schließen', ar: '' },
  failExtract:{ de: 'Erkennung fehlgeschlagen. Versuche es erneut oder tippe die Fragen ein.', ar: '' },
  failSave:   { de: 'Speichern fehlgeschlagen. Bitte erneut versuchen.', ar: '' },
  tooMany:    { de: `Höchstens ${MAX_IMAGES} Bilder.`, ar: '' },
  emptySet:   { de: 'Füge mindestens eine Frage hinzu.', ar: '' },
};

// Client-side compression: downscale + JPEG so the upload stays ~1MB even from a modern phone camera.
function compressImage(file, maxDim = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const longest = Math.max(width, height) || 1;
      if (longest > maxDim) { const s = maxDim / longest; width = Math.round(width * s); height = Math.round(height * s); }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image_load')); };
    img.src = url;
  });
}

export default function CustomQuestions({ token, apiUrl, lang = 'de', onClose, onStart }) {
  const ar = lang === 'ar';
  const t = (k) => (ar && T[k].ar) || T[k].de;
  const rtl = ar ? { direction: 'rtl', textAlign: 'right' } : null;

  const [images, setImages] = useState([]);        // [dataUrl]
  const [questions, setQuestions] = useState(null); // null = not extracted yet; [] = extracted, none
  const [phase, setPhase] = useState('pick');       // pick | extracting | confirm | saving
  const [err, setErr] = useState(null);
  const hdr = { Authorization: `Bearer ${token}` };

  // Pre-load an existing saved set so a returning user edits/re-runs it instead of starting cold.
  useEffect(() => {
    let alive = true;
    fetch(`${apiUrl}/api/custom-questions`, { headers: hdr })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.set?.questions?.length) { setQuestions(d.set.questions); setPhase('confirm'); } })
      .catch(() => {});
    return () => { alive = false; };
  }, [apiUrl, token]);   // eslint-disable-line react-hooks/exhaustive-deps

  const onFiles = useCallback(async (e) => {
    setErr(null);
    const files = Array.from(e.target.files || []).filter((f) => /^image\//.test(f.type));
    e.target.value = '';   // allow re-picking the same file
    if (!files.length) return;
    const room = MAX_IMAGES - images.length;
    if (room <= 0) { setErr(t('tooMany')); return; }
    try {
      const next = [];
      for (const f of files.slice(0, room)) next.push(await compressImage(f));
      setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGES));
    } catch { setErr(t('failExtract')); }
  }, [images.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  const extract = async () => {
    if (!images.length) return;
    setPhase('extracting'); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/custom-questions/extract`, {
        method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'extract_failed');
      setQuestions(Array.isArray(d.questions) ? d.questions : []);
      setPhase('confirm');
    } catch { setQuestions([]); setPhase('confirm'); setErr(t('failExtract')); }
  };

  const editQ = (i, v) => setQuestions((qs) => qs.map((q, j) => (j === i ? v : q)));
  const removeQ = (i) => setQuestions((qs) => qs.filter((_, j) => j !== i));
  const addQ = () => setQuestions((qs) => [...(qs || []), ''].slice(0, MAX_QUESTIONS));

  const startInterview = async () => {
    const clean = (questions || []).map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUESTIONS);
    if (!clean.length) { setErr(t('emptySet')); return; }
    setPhase('saving'); setErr(null);
    try {
      const r = await fetch(`${apiUrl}/api/custom-questions`, {
        method: 'POST', headers: { ...hdr, 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions: clean }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'save_failed');
      onStart?.();   // parent closes this overlay and calls beginSession({ customQuestions: true })
    } catch { setPhase('confirm'); setErr(t('failSave')); }
  };

  const label = { fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', color: 'var(--accent)' };
  const thumb = { width: 54, height: 54, borderRadius: 8, objectFit: 'cover', border: '1px solid var(--line-strong)' };
  const qInput = { flex: 1, minHeight: 44, padding: '10px 12px', borderRadius: 8, resize: 'vertical',
    background: 'rgba(2,6,16,0.7)', color: 'var(--text)', border: '1px solid var(--line-strong)', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.4 };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 240, overflowY: 'auto',
      background: 'radial-gradient(120% 90% at 50% 12%, var(--bg-2) 0%, var(--bg-0) 65%)',
      color: 'var(--text)', padding: '20px 16px 40px', boxSizing: 'border-box', ...rtl }}>
      <div style={{ maxWidth: 460, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={label}>{t('title')}{/* OWNER-AR slot */}</div>
          <button onClick={onClose} style={{ ...ghostBtn }}>{t('close')} ✕</button>
        </div>
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{t('intro')}</p>

        {/* ── Pick + extract ─────────────────────────────────────────────── */}
        {phase !== 'confirm' && phase !== 'saving' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px',
            borderRadius: 'var(--r-lg)', background: 'var(--surface)', border: '1px solid var(--line)' }}>
            {images.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {images.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img src={src} alt="" style={thumb} />
                    <button aria-label="Bild entfernen" onClick={() => setImages((im) => im.filter((_, j) => j !== i))}
                      style={{ position: 'absolute', top: -6, insetInlineEnd: -6, width: 20, height: 20, borderRadius: '50%',
                        border: '1px solid var(--line-strong)', background: 'var(--bg-0)', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            <label style={{ ...ghostBtn, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              minHeight: 44, cursor: images.length >= MAX_IMAGES ? 'default' : 'pointer', opacity: images.length >= MAX_IMAGES ? 0.5 : 1 }}>
              {images.length ? t('pickMore') : t('pick')}
              <input type="file" accept="image/*" multiple disabled={images.length >= MAX_IMAGES}
                onChange={onFiles} style={{ display: 'none' }} />
            </label>
            <button onClick={extract} disabled={!images.length || phase === 'extracting'}
              style={{ ...actionBtn, opacity: !images.length || phase === 'extracting' ? 0.55 : 1,
                cursor: !images.length || phase === 'extracting' ? 'default' : 'pointer' }}>
              {phase === 'extracting' ? t('extracting') : t('extract')}
            </button>
          </div>
        )}

        {/* ── Confirm / edit (mandatory) ─────────────────────────────────── */}
        {(phase === 'confirm' || phase === 'saving') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              {questions && questions.length === 0 ? t('none') : t('confirmHint')}
            </p>
            {(questions || []).map((q, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <textarea value={q} rows={2} onChange={(e) => editQ(i, e.target.value)}
                  placeholder="…" style={qInput} />
                <button aria-label="Frage entfernen" onClick={() => removeQ(i)}
                  style={{ ...ghostBtn, minHeight: 44, padding: '8px 10px' }}>✕</button>
              </div>
            ))}
            {(questions || []).length < MAX_QUESTIONS && (
              <button onClick={addQ} style={{ ...ghostBtn, minHeight: 44, alignSelf: 'flex-start' }}>{t('add')}</button>
            )}
            <button onClick={startInterview} disabled={phase === 'saving'}
              style={{ ...actionBtn, marginTop: 4, opacity: phase === 'saving' ? 0.55 : 1, cursor: phase === 'saving' ? 'default' : 'pointer' }}>
              {phase === 'saving' ? t('saving') : t('start')}
            </button>
          </div>
        )}

        {err && <p role="alert" style={{ margin: 0, fontSize: 12, color: '#fca5a5', lineHeight: 1.5 }}>{err}</p>}
      </div>
    </div>
  );
}
