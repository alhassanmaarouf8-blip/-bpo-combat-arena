import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EVIDENCE_OPTIONS,
  GERMAN_LEVEL_OPTIONS,
  INDUSTRY_OPTIONS,
  ROLE_OPTIONS,
  TIMING_OPTIONS,
  MissionControlRequestError,
  createMissionControlClient,
} from './missionControlClient.js';
import { isPreviewUnavailableError } from './interviewPassAvailability.js';

const CV_MIN_CHARS = 80;
const CV_MAX_CHARS = 16_000;

const EVIDENCE_HINTS = Object.freeze({
  customer_contact: /\b(?:customer|client|kunde|kunden|support|service|call|kontakt|عميل|عملاء|خدمة)\b/iu,
  deescalation: /\b(?:complaint|escalat|angry|conflict|beschwer|eskalat|reklamation|شكوى|شكاوى|تصعيد)\b/iu,
  sales_result: /\b(?:sales|sell|upsell|cross.?sell|retention|renew|verkauf|vertrieb|bindung|مبيعات|بيع|احتفاظ)\b/iu,
  technical_triage: /\b(?:technical|troubleshoot|ticket|diagnos|incident|support|fehler|störung|تقني|تذكرة|مشكلة)\b/iu,
  data_accuracy: /\b(?:data|document|record|crm|quality|accuracy|daten|dokument|qualität|بيانات|توثيق|جودة)\b/iu,
  shift_flexibility: /\b(?:shift|night|weekend|schedule|schicht|wochenende|شيفت|ورديات|عطلة)\b/iu,
  quantified_result: /(?:\b\d+(?:[.,]\d+)?\s*%|\b\d+\s+(?:calls?|tickets?|cases?|kunden|fälle|مكالمة|حالة))/iu,
});

const ERROR_COPY = Object.freeze({
  invalid_preview_input: ['Bitte beantworte alle Fragen und bestätige mindestens einen Beleg.', 'أجب عن كل الأسئلة وأكّد دليلاً واحداً على الأقل.'],
  preview_limit: ['Deine kostenlose Vorschau wurde bereits verwendet.', 'تم استخدام المعاينة المجانية بالفعل.'],
  preview_used: ['Deine kostenlose Vorschau wurde bereits verwendet.', 'تم استخدام المعاينة المجانية بالفعل.'],
  request_timeout: ['Die Analyse dauert zu lange. Bitte versuche es erneut.', 'التحليل يستغرق وقتاً أطول من المتوقع. حاول مرة أخرى.'],
  too_many_attempts: ['Zu viele Versuche. Bitte warte kurz und versuche es erneut.', 'محاولات كثيرة. انتظر قليلاً ثم حاول مرة أخرى.'],
  network_error: ['Keine Verbindung zum Server. Deine Auswahl bleibt erhalten.', 'لا يوجد اتصال بالخادم. اختياراتك ما زالت محفوظة في هذه الصفحة.'],
  invalid_response: ['Die Vorschau war unvollständig und wurde nicht angezeigt. Bitte versuche es erneut.', 'المعاينة كانت غير مكتملة ولم نعرضها. حاول مرة أخرى.'],
});

const DAY_ONE_ACTIONS = Object.freeze({
  map_requirements: 'Die wichtigsten Rollenanforderungen ordnen',
  build_60_second_introduction: 'Eine 60-Sekunden-Vorstellung aufbauen',
  practice_predictions: 'Die drei Übungsprognosen laut beantworten',
});

function optionLabel(options, id) {
  return options.find((item) => item.id === id) || null;
}

function suggestEvidence(cvText) {
  const normalized = String(cvText || '').normalize('NFKC').toLowerCase();
  return Object.entries(EVIDENCE_HINTS).filter(([, pattern]) => pattern.test(normalized)).map(([id]) => id);
}

function errorCopy(error) {
  const code = error instanceof MissionControlRequestError ? error.code : 'network_error';
  return ERROR_COPY[code] || ['Das hat gerade nicht geklappt. Bitte versuche es erneut.', 'لم تكتمل العملية. حاول مرة أخرى.'];
}

const shellStyle = {
  width: '100%', maxWidth: 880, margin: '0 auto', boxSizing: 'border-box',
  border: '1px solid rgba(96,165,250,0.28)', borderRadius: 18,
  background: 'var(--surface)', boxShadow: '0 28px 70px rgba(14,19,32,0.16)',
  color: 'var(--text, #e2e8f0)', overflow: 'hidden',
};

const fieldStyle = {
  width: '100%', minHeight: 48, boxSizing: 'border-box', borderRadius: 11,
  border: '1px solid var(--line-strong, rgba(148,163,184,0.32))',
  background: 'var(--surface)', color: 'var(--text, #e2e8f0)',
  font: 'inherit', fontSize: 14, padding: '11px 12px',
};

const primaryStyle = {
  minHeight: 48, borderRadius: 11, border: '1px solid var(--action, #f97316)',
  background: 'var(--action, #f97316)', color: '#071018', cursor: 'pointer',
  font: 'inherit', fontSize: 13, fontWeight: 850, padding: '11px 18px',
};

const secondaryStyle = {
  minHeight: 44, borderRadius: 11, border: '1px solid rgba(96,165,250,0.42)',
  background: 'rgba(59,130,246,0.09)', color: 'var(--accent-2, #93c5fd)', cursor: 'pointer',
  font: 'inherit', fontSize: 12.5, fontWeight: 750, padding: '10px 15px',
};

const quietStyle = {
  minHeight: 44, borderRadius: 11, border: '1px solid var(--line, rgba(148,163,184,0.2))',
  background: 'transparent', color: 'var(--text-dim, #94a3b8)', cursor: 'pointer',
  font: 'inherit', fontSize: 12, fontWeight: 700, padding: '10px 14px',
};

function BilingualLabel({ de, ar, htmlFor }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', marginBottom: 7 }}>
      <span style={{ display: 'block', color: 'var(--text, #e2e8f0)', fontSize: 13, fontWeight: 750 }}>{de}</span>
      <span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', fontSize: 11.5, marginTop: 2 }}>{ar}</span>
    </label>
  );
}

function StepHeader({ step }) {
  const steps = [
    ['1', 'Lebenslauf', 'السيرة الذاتية'],
    ['2', 'Ziel', 'الهدف'],
    ['3', 'Vorschau', 'المعاينة'],
  ];
  return (
    <ol aria-label="Fortschritt" className="ipx-step-row" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
      {steps.map(([id, de, ar], index) => {
        const active = index + 1 === step;
        const done = index + 1 < step;
        return (
          <li key={id} aria-current={active ? 'step' : undefined} style={{ minWidth: 0, padding: '9px 10px', borderRadius: 10,
            border: `1px solid ${active ? 'rgba(96,165,250,0.65)' : 'rgba(148,163,184,0.16)'}`,
            background: active ? 'rgba(59,130,246,0.12)' : done ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.018)' }}>
            <span aria-hidden="true" style={{ display: 'inline-grid', placeItems: 'center', width: 22, height: 22, borderRadius: '50%',
              background: active || done ? 'var(--accent, #3b82f6)' : 'rgba(148,163,184,0.16)',
              color: active || done ? '#06101d' : 'var(--text-faint, #64748b)', fontSize: 11, fontWeight: 600 }}>{done ? '✓' : id}</span>
            <span style={{ display: 'block', marginTop: 5, fontSize: 11.5, fontWeight: 750, color: active ? 'var(--accent-2, #93c5fd)' : 'var(--text-dim, #94a3b8)' }}>{de}</span>
            <span dir="rtl" style={{ display: 'block', marginTop: 2, fontSize: 10.5, color: 'var(--text-faint, #64748b)' }}>{ar}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function InterviewPassPreview({
  apiUrl,
  enabled = false,
  featureState = 'off',
  serverVerified = false,
  onUnavailable,
  onSave,
  onLogin,
  onBeacon,
  className = '',
}) {
  const active = enabled === true && (featureState === 'on' || featureState === 'beta');
  const [step, setStep] = useState(1);
  const [cvText, setCvText] = useState('');
  const [suggested, setSuggested] = useState([]);
  const [roleType, setRoleType] = useState('');
  const [industryKey, setIndustryKey] = useState('');
  const [germanLevel, setGermanLevel] = useState('');
  const [timing, setTiming] = useState('');
  const [evidenceCategories, setEvidenceCategories] = useState([]);
  const [preview, setPreview] = useState(null);
  const [availability, setAvailability] = useState(serverVerified ? 'enabled' : 'checking');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);
  const resultRef = useRef(null);
  const openedRef = useRef(false);
  const unavailableNotifiedRef = useRef(false);

  const client = useMemo(() => {
    if (!active || !apiUrl) return null;
    try { return createMissionControlClient({ apiUrl }); }
    catch { return null; }
  }, [active, apiUrl]);

  const emit = useCallback((event) => {
    try { onBeacon?.(event); } catch { /* analytics never changes the proof */ }
  }, [onBeacon]);

  const markUnavailable = useCallback((code) => {
    setAvailability('hidden');
    controllerRef.current?.abort();
    setCvText('');
    setSuggested([]);
    setPreview(null);
    setError(null);
    if (unavailableNotifiedRef.current) return;
    unavailableNotifiedRef.current = true;
    try { onUnavailable?.(code); } catch { /* parent notification must not block rollback */ }
  }, [onUnavailable]);

  useEffect(() => {
    if (!active || !client) { setAvailability('hidden'); return undefined; }
    if (serverVerified) { setAvailability('enabled'); return undefined; }
    const controller = new AbortController();
    client.getPreviewStatus({ signal: controller.signal })
      .then((status) => setAvailability(status.enabled ? 'enabled' : 'hidden'))
      .catch(() => setAvailability('hidden'));
    return () => controller.abort();
  }, [active, client, serverVerified]);

  useEffect(() => {
    if (availability === 'enabled' && !openedRef.current) {
      openedRef.current = true;
      emit('interview_pass_opened');
    }
  }, [availability, emit]);

  useEffect(() => () => { controllerRef.current?.abort(); }, []);

  useEffect(() => {
    if (step === 3) resultRef.current?.focus();
  }, [step]);

  if (!active || !client || availability !== 'enabled') return null;

  function moveToGuidance() {
    const length = cvText.trim().length;
    if (length < CV_MIN_CHARS) {
      setError(['Bitte füge mindestens einen kurzen Lebenslauf oder deine wichtigsten Stationen ein.', 'ألصق سيرة ذاتية قصيرة أو أهم خبراتك على الأقل.']);
      return;
    }
    if (length > CV_MAX_CHARS) {
      setError([`Der Text ist zu lang. Maximal ${CV_MAX_CHARS.toLocaleString('de-DE')} Zeichen.`, `النص طويل جداً. الحد الأقصى ${CV_MAX_CHARS.toLocaleString('ar-EG')} حرفاً.`]);
      return;
    }
    setSuggested(suggestEvidence(cvText));
    setError(null);
    setStep(2);
    emit('interview_pass_cv_local_ready');
  }

  function toggleEvidence(id) {
    setEvidenceCategories((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, 5));
  }

  async function buildPreview() {
    if (busy) return;
    if (!roleType || !industryKey || !germanLevel || !timing || !evidenceCategories.length) {
      setError(ERROR_COPY.invalid_preview_input);
      return;
    }
    const safeInput = { roleType, industryKey, germanLevel, timing, evidenceCategories };
    setError(null); setBusy(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const result = await client.preview(safeInput, { signal: controller.signal });
      setPreview({ ...result, safeInput });
      setCvText('');
      setSuggested([]);
      setStep(3);
      emit('interview_pass_previewed');
    } catch (requestError) {
      if (isPreviewUnavailableError(requestError)) markUnavailable(requestError.code);
      else if (requestError?.name !== 'AbortError') setError(errorCopy(requestError));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setBusy(false);
    }
  }

  function savePass() {
    if (!preview?.previewToken || typeof onSave !== 'function') return;
    emit('interview_pass_signup_clicked');
    onSave({ previewToken: preview.previewToken, expiresAt: preview.expiresAt, preview });
  }

  function restart() {
    controllerRef.current?.abort();
    setStep(1); setCvText(''); setSuggested([]); setRoleType(''); setIndustryKey('');
    setGermanLevel(''); setTiming(''); setEvidenceCategories([]); setPreview(null); setError(null); setBusy(false);
  }

  const confirmedEvidence = preview?.confirmedEvidence?.length
    ? preview.confirmedEvidence.map((id) => optionLabel(EVIDENCE_OPTIONS, id)?.de || id)
    : evidenceCategories.map((id) => optionLabel(EVIDENCE_OPTIONS, id)?.de).filter(Boolean);
  const gapCode = preview?.gap?.detail;
  const gapDetail = (gapCode && optionLabel(EVIDENCE_OPTIONS, gapCode)?.de
    ? `Bereite einen ehrlichen Beleg für „${optionLabel(EVIDENCE_OPTIONS, gapCode).de}“ vor.`
    : gapCode) || (!evidenceCategories.includes('quantified_result')
    ? 'Ergänze vor dem Interview eine konkrete Zahl oder ein klar beobachtbares Ergebnis.'
    : 'Bereite ein zweites Beispiel vor, falls HR nach einem anderen Kontext fragt.');

  return (
    <section className={`ipx ${className}`.trim()} aria-labelledby="ipx-title" aria-busy={busy} style={shellStyle}>
      <style>{`
        .ipx *{box-sizing:border-box}.ipx button:focus-visible,.ipx textarea:focus-visible,.ipx select:focus-visible,.ipx input:focus-visible{outline:3px solid rgba(96,165,250,.85);outline-offset:3px}.ipx button:disabled{cursor:not-allowed;opacity:.48}.ipx-choice{transition:border-color 140ms ease,background 140ms ease}.ipx-choice:hover{border-color:rgba(96,165,250,.58)!important}.ipx-result{animation:ipx-rise 240ms ease-out both}@keyframes ipx-rise{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}@media(max-width:560px){.ipx-body{padding:18px!important}.ipx-grid{grid-template-columns:1fr!important}.ipx-actions{align-items:stretch!important;flex-direction:column!important}.ipx-actions>button{width:100%}.ipx-step-row{gap:5px!important}.ipx-step-row li{padding:8px 6px!important}}@media(prefers-reduced-motion:reduce){.ipx *{animation:none!important;scroll-behavior:auto!important;transition:none!important}}
      `}</style>
      <header style={{ padding: '20px 22px 17px', borderBottom: '1px solid var(--line, rgba(148,163,184,0.18))', background: 'var(--surface)' }}>
        <div style={{ fontFamily: 'var(--font-display, inherit)', fontSize: 10, fontWeight: 850, letterSpacing: '0.17em', color: 'var(--accent, #3b82f6)' }}>
          INTERVIEW X-RAY
        </div>
        <h2 id="ipx-title" style={{ margin: '8px 0 0', fontFamily: 'var(--font-display, inherit)', fontSize: 'clamp(22px,4vw,31px)', lineHeight: 1.2, color: 'var(--text)' }}>
          Dein Interview Pass vor der Anmeldung
        </h2>
        <div dir="rtl" style={{ marginTop: 7, color: 'var(--text-dim, #94a3b8)', fontSize: 14, lineHeight: 1.65 }}>
          شاهد دليلاً مخصصاً لك قبل إنشاء الحساب
        </div>
        <p style={{ margin: '8px 0 0', color: 'var(--text-faint, #64748b)', fontSize: 12.5, lineHeight: 1.6 }}>
          60–90 Sekunden. Drei realistische Übungsprognosen, ein Antwortaufbau und eine ehrliche Lücke.
        </p>
      </header>

      <div className="ipx-body" style={{ padding: 22 }}>
        <StepHeader step={step} />

        {error && (
          <div role="alert" style={{ marginTop: 16, padding: '11px 13px', borderRadius: 10, border: '1px solid rgba(248,113,113,0.5)', background: 'rgba(127,29,29,0.16)' }}>
            <div style={{ color: '#fecaca', fontSize: 12.5, lineHeight: 1.5 }}>{error[0]}</div>
            <div dir="rtl" style={{ color: '#fca5a5', fontSize: 12, lineHeight: 1.6, marginTop: 3 }}>{error[1]}</div>
          </div>
        )}

        {step === 1 && (
          <div style={{ marginTop: 20 }}>
            <BilingualLabel htmlFor="ipx-cv" de="Lebenslauf als Text einfügen" ar="ألصق نص السيرة الذاتية" />
            <textarea id="ipx-cv" value={cvText} onChange={(event) => setCvText(event.target.value.slice(0, CV_MAX_CHARS + 1))}
              autoComplete="off" spellCheck="false" rows={10} maxLength={CV_MAX_CHARS + 1}
              placeholder="Berufserfahrung, Aufgaben, messbare Ergebnisse, Sprachen…"
              style={{ ...fieldStyle, minHeight: 190, resize: 'vertical', lineHeight: 1.55 }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 7, color: 'var(--text-faint, #64748b)', fontSize: 11 }}>
              <span>{cvText.length.toLocaleString('de-DE')} / {CV_MAX_CHARS.toLocaleString('de-DE')}</span>
              <span dir="rtl">لا تضع رقم البطاقة أو بيانات مالية</span>
            </div>
            <div style={{ marginTop: 13, padding: '11px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.22)', background: 'rgba(59,130,246,0.055)' }}>
              <div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 12, fontWeight: 750 }}>Dein CV bleibt auf diesem Gerät.</div>
              <div dir="rtl" style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.65, marginTop: 3 }}>
                نص السيرة لا يُرسل ولا يُحفظ. نرسل فقط اختيارات عامة تؤكدها بنفسك.
              </div>
            </div>
            <div className="ipx-actions" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 17 }}>
              {typeof onLogin === 'function' && <button type="button" onClick={onLogin} style={quietStyle}>Schon registriert? Anmelden</button>}
              <button type="button" onClick={moveToGuidance} style={primaryStyle}>WEITER ZUM ZIEL</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div style={{ marginTop: 20 }}>
            <div className="ipx-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 14 }}>
              <div>
                <BilingualLabel htmlFor="ipx-role" de="Zielrolle" ar="الوظيفة المستهدفة" />
                <select id="ipx-role" value={roleType} onChange={(event) => setRoleType(event.target.value)} style={fieldStyle}>
                  <option value="">Bitte wählen</option>
                  {ROLE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}
                </select>
              </div>
              <div>
                <BilingualLabel htmlFor="ipx-industry" de="Zielbranche" ar="المجال المستهدف" />
                <select id="ipx-industry" value={industryKey} onChange={(event) => setIndustryKey(event.target.value)} style={fieldStyle}>
                  <option value="">Bitte wählen</option>
                  {INDUSTRY_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}
                </select>
              </div>
              <div>
                <BilingualLabel htmlFor="ipx-level" de="Aktuelles Deutschniveau" ar="مستوى اللغة الألمانية الحالي" />
                <select id="ipx-level" value={germanLevel} onChange={(event) => setGermanLevel(event.target.value)} style={fieldStyle}>
                  <option value="">Bitte wählen</option>
                  {GERMAN_LEVEL_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}
                </select>
              </div>
              <div>
                <BilingualLabel htmlFor="ipx-timing" de="Wann ist das Interview?" ar="متى موعد المقابلة؟" />
                <select id="ipx-timing" value={timing} onChange={(event) => setTiming(event.target.value)} style={fieldStyle}>
                  <option value="">Bitte wählen</option>
                  {TIMING_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}
                </select>
              </div>
            </div>

            <fieldset style={{ margin: '18px 0 0', padding: 0, border: 0 }}>
              <legend style={{ padding: 0, color: 'var(--text, #e2e8f0)', fontSize: 13, fontWeight: 750 }}>
                Welche Belege kannst du im Interview ehrlich erklären?
              </legend>
              <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 11.5, marginTop: 3 }}>
                اختر فقط ما يمكنك شرحه بصدق في المقابلة
              </div>
              <div className="ipx-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8, marginTop: 10 }}>
                {EVIDENCE_OPTIONS.map((item) => {
                  const checked = evidenceCategories.includes(item.id);
                  const hinted = suggested.includes(item.id);
                  return (
                    <label key={item.id} className="ipx-choice" style={{ minHeight: 54, display: 'flex', gap: 10, alignItems: 'center', padding: '9px 11px', cursor: 'pointer', borderRadius: 10,
                      border: `1px solid ${checked ? 'rgba(96,165,250,0.68)' : 'rgba(148,163,184,0.19)'}`,
                      background: checked ? 'rgba(59,130,246,0.11)' : 'rgba(255,255,255,0.018)' }}>
                      <input type="checkbox" checked={checked} onChange={() => toggleEvidence(item.id)} style={{ width: 20, height: 20, accentColor: 'var(--accent, #3b82f6)', flex: '0 0 auto' }} />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', color: 'var(--text, #e2e8f0)', fontSize: 12.5, lineHeight: 1.35 }}>{item.de}</span>
                        <span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', fontSize: 10.5, lineHeight: 1.5, marginTop: 2 }}>{item.ar}</span>
                        {hinted && <span style={{ display: 'block', color: 'var(--accent-2, #93c5fd)', fontSize: 9.5, marginTop: 3 }}>Im CV erkannt — bitte selbst bestätigen</span>}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="ipx-actions" style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={() => { setError(null); setStep(1); }} disabled={busy} style={quietStyle}>ZURÜCK</button>
              <button type="button" onClick={buildPreview} disabled={busy} style={primaryStyle}>
                {busy ? 'ERSTELLE VORSCHAU…' : 'INTERVIEW PASS ZEIGEN'}
              </button>
            </div>
          </div>
        )}

        {step === 3 && preview && (
          <div ref={resultRef} tabIndex={-1} className="ipx-result" style={{ marginTop: 20 }}>
            <div style={{ padding: '14px 15px', borderRadius: 12, border: '1px solid rgba(96,165,250,0.38)', background: 'rgba(59,130,246,0.085)' }}>
              <div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 11, letterSpacing: '0.12em', fontWeight: 850 }}>PRIVATE VORSCHAU</div>
              <div style={{ marginTop: 6, color: 'var(--text)', fontSize: 18, fontWeight: 850 }}>{preview.roleTitle || optionLabel(ROLE_OPTIONS, roleType)?.de || 'Deine Zielrolle'}</div>
              <div dir="rtl" style={{ marginTop: 4, color: 'var(--text-dim, #94a3b8)', fontSize: 12.5 }}>معاينة تدريبية خاصة بك وليست أسئلة مؤكدة من صاحب العمل</div>
            </div>

            <section aria-labelledby="ipx-predictions" style={{ marginTop: 17 }}>
              <h3 id="ipx-predictions" style={{ margin: 0, fontSize: 14, color: 'var(--text, #e2e8f0)' }}>3 passende Übungsprognosen</h3>
              <p dir="rtl" style={{ margin: '3px 0 0', color: 'var(--text-faint, #64748b)', fontSize: 11.5 }}>توقعات للتدريب وليست أسئلة حقيقية مؤكدة</p>
              <ol style={{ margin: '10px 0 0', paddingLeft: 20, display: 'grid', gap: 8 }}>
                {preview.practicePredictions.slice(0, 3).map((question) => (
                  <li key={question.id} style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid var(--line, rgba(148,163,184,0.18))', background: 'rgba(255,255,255,0.018)', color: 'var(--text-dim, #94a3b8)', fontSize: 13, lineHeight: 1.55 }}>
                    <span style={{ display: 'block', color: 'var(--accent-2, #93c5fd)', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.1em', marginBottom: 4 }}>{question.label.toUpperCase()}</span>
                    {question.text}
                  </li>
                ))}
              </ol>
            </section>

            <section className="ipx-grid" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.1fr) minmax(0,.9fr)', gap: 12, marginTop: 16 }}>
              <div style={{ padding: '13px', borderRadius: 11, border: '1px solid var(--line, rgba(148,163,184,0.18))', background: 'rgba(255,255,255,0.018)' }}>
                <h3 style={{ margin: 0, fontSize: 13.5, color: 'var(--text, #e2e8f0)' }}>60-Sekunden-Antwort</h3>
                <div dir="rtl" style={{ marginTop: 3, color: 'var(--text-faint, #64748b)', fontSize: 11 }}>هيكل إجابة في 60 ثانية</div>
                <ol style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'grid', gap: 8 }}>
                  {preview.answerStructure.map((row, index) => (
                    <li key={`${row.seconds}-${index}`} style={{ display: 'grid', gridTemplateColumns: '56px minmax(0,1fr)', gap: 9, alignItems: 'start' }}>
                      <span style={{ color: 'var(--action, #f97316)', fontFamily: 'var(--font-mono, monospace)', fontSize: 10.5, fontWeight: 800 }}>{row.seconds}</span>
                      <span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.5 }}><b style={{ color: 'var(--text, #e2e8f0)' }}>{row.title}:</b> {row.detail}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(59,130,246,0.055)' }}>
                  <h3 style={{ margin: 0, fontSize: 13, color: 'var(--accent-2, #93c5fd)' }}>Bestätigte Belege</h3>
                  <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 10.5, marginTop: 2 }}>الأدلة التي أكّدتها بنفسك</div>
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.55 }}>
                    {confirmedEvidence.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
                <div style={{ padding: '13px', borderRadius: 11, border: '1px solid rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.055)' }}>
                  <h3 style={{ margin: 0, fontSize: 13, color: 'var(--action, #f97316)' }}>{preview.gap?.title || 'Ehrliche Lücke'}</h3>
                  <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 10.5, marginTop: 2 }}>النقطة التي تحتاج دليلاً أقوى</div>
                  <p style={{ margin: '7px 0 0', color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.55 }}>{gapDetail}</p>
                </div>
              </div>
            </section>

            {!!preview.dayOne?.actions?.length && (
              <section style={{ marginTop: 13, padding: '13px 14px', borderRadius: 11, border: '1px solid rgba(96,165,250,0.28)', background: 'rgba(59,130,246,0.05)' }}>
                <h3 style={{ margin: 0, color: 'var(--accent-2, #93c5fd)', fontSize: 13.5 }}>Dein kostenloser Tag 1</h3>
                <div dir="rtl" style={{ marginTop: 3, color: 'var(--text-faint, #64748b)', fontSize: 11 }}>خطتك المجانية لليوم الأول</div>
                <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.6 }}>
                  {preview.dayOne.actions.slice(0, 4).map((action) => <li key={action}>{DAY_ONE_ACTIONS[action] || action}</li>)}
                </ul>
              </section>
            )}

            <div className="ipx-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 18 }}>
              <button type="button" onClick={restart} style={quietStyle}>NEU STARTEN</button>
              <button type="button" onClick={savePass} disabled={!preview.previewToken || typeof onSave !== 'function'} style={primaryStyle}>
                PASS SPEICHERN · KONTO ERSTELLEN
              </button>
            </div>
            <div dir="rtl" style={{ textAlign: 'right', marginTop: 8, color: 'var(--text-faint, #64748b)', fontSize: 11 }}>
              الحساب المجاني يحفظ هذه المعاينة ويفتح الخطوة الأولى فقط
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default InterviewPassPreview;
