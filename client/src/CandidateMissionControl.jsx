import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  APPLICATION_OUTCOME_OPTIONS,
  EXPERIENCE_BAND_OPTIONS,
  FACT_TYPE_OPTIONS,
  GERMAN_LEVEL_OPTIONS,
  INDUSTRY_OPTIONS,
  LOCATION_MODE_OPTIONS,
  PASSPORT_SKILL_OPTIONS,
  ROLE_OPTIONS,
  SHIFT_PREFERENCE_OPTIONS,
  WORK_AUTHORIZATION_OPTIONS,
  MissionControlRequestError,
  createMissionControlClient,
} from './missionControlClient.js';

const FOCUSABLE = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';
const TRUSTED_APPLY_HOSTS = new Set([
  'wuzzuf.net', 'jobs.lever.co', 'boards.greenhouse.io', 'apply.workable.com', 'jobs.smartrecruiters.com',
]);

const STATUS_LABELS = Object.freeze({
  discovered: 'Entdeckt', shortlisted: 'Vorgemerkt', measure_first: 'Erst messen',
  prep_first: 'Erst vorbereiten', ready_to_apply: 'Bewerbungsbereit', pack_approved: 'Pack freigegeben',
  user_submitted: 'Selbst eingereicht', acknowledged: 'Eingang bestätigt', human_response: 'Antwort erhalten',
  interview_proposed: 'Interview vorgeschlagen', interview_confirmed: 'Interview bestätigt',
  preparation: 'In Vorbereitung', rejected: 'Abgelehnt', offer: 'Angebot', hired: 'Eingestellt',
  withdrawn: 'Zurückgezogen', expired: 'Abgelaufen',
});

const READINESS_LABELS = Object.freeze({
  READY_TO_APPLY: ['Bereit', 'جاهز'], PREP_FIRST: ['Zuerst vorbereiten', 'استعد أولاً'],
  MEASURE_FIRST: ['Zuerst messen', 'قيّم مستواك أولاً'],
  HARD_MISMATCH: ['Harte Lücke', 'فجوة أساسية'],
});

const FIT_LABELS = Object.freeze({
  role: 'Zielrolle passt', industry: 'Zielbranche passt', german: 'Deutschniveau passt',
  skills: 'Relevante Skills bestätigt', evidence: 'Teilbare Belege vorhanden',
});
const GAP_LABELS = Object.freeze({
  role: 'Zielrolle weicht ab', industry: 'Branchenbeleg fehlt', german: 'Deutschniveau reicht noch nicht',
  skills: 'Relevante Skills fehlen', evidence: 'Mindestens zwei konkrete Belege fehlen',
});
const READINESS_REASON_LABELS = Object.freeze({
  missing_measurement: 'Deutschniveau zuerst messen', insufficient_evidence: 'Mehr bestätigte Belege nötig',
  role_gap: 'Rollenabgleich nötig', industry_gap: 'Branchenbezug vorbereiten', german_gap: 'Deutsch-Lücke zuerst schließen',
  skill_gap: 'Rollenskill zuerst üben', ready_on_confirmed_facts: 'Auf bestätigten Fakten bewerbungsbereit',
  account_unverified: 'E-Mail zuerst bestätigen', passport_stale: 'Passport-Fakten erneut bestätigen',
  assessment_required: 'Gemessenes Deutschniveau fehlt', assessment_stale: 'Deutschniveau erneut messen',
  debrief_required: 'Ein vollständiges Probeinterview fehlt', posting_unverified: 'Offizielle Stelle muss erneut geprüft werden',
});

const PASS_STEP_COPY = Object.freeze({
  vacancy_requirements_and_introduction:['Anforderungen + 60-Sekunden-Vorstellung', 'متطلبات الوظيفة + تقديم نفسك في 60 ثانية'],
  motivation_availability_and_logistics:['Motivation, Verfügbarkeit und Logistik', 'الدافع والتوفر والتفاصيل العملية'],
  relevant_star_story:['Eine belegbare STAR-Geschichte', 'قصة STAR حقيقية ومدعومة'],
  role_specific_customer_scenario:['Rollenspezifisches Kundenszenario', 'سيناريو عميل خاص بالدور'],
  pressure_and_deescalation:['Druck und Deeskalation', 'الضغط وتهدئة التصعيد'],
  full_vacancy_tailored_mock_interview:['Vollständiges zielgerichtetes Probeinterview', 'مقابلة تجريبية كاملة مخصصة للوظيفة'],
  weakness_retest_and_final_readiness:['Schwächen-Retest und Abschlussbereitschaft', 'إعادة اختبار نقاط الضعف والاستعداد النهائي'],
  emergency_introduction_and_motivation:['Sofort: Vorstellung und Motivation', 'عاجل: التعريف بالنفس والدافع'],
  emergency_evidence_and_pressure:['Sofort: Beleg und Drucksituation', 'عاجل: الدليل وموقف الضغط'],
  emergency_mock_and_closing:['Sofort: Probeinterview und Abschluss', 'عاجل: مقابلة تجريبية وإنهاء قوي'],
});

const panelStyle = {
  border: '1px solid rgba(96,165,250,0.24)', borderRadius: 17, background: 'rgba(4,10,20,0.94)',
  color: 'var(--text, #e2e8f0)', boxShadow: '0 24px 60px rgba(0,0,0,0.3)', overflow: 'hidden',
};
const fieldStyle = {
  width: '100%', minHeight: 46, boxSizing: 'border-box', borderRadius: 10,
  border: '1px solid var(--line-strong, rgba(148,163,184,0.32))', background: 'rgba(2,6,16,0.84)',
  color: 'var(--text, #e2e8f0)', font: 'inherit', fontSize: 13.5, padding: '10px 11px',
};
const quietButton = {
  minHeight: 44, borderRadius: 10, border: '1px solid rgba(96,165,250,0.38)',
  background: 'rgba(59,130,246,0.07)', color: 'var(--accent-2, #93c5fd)', cursor: 'pointer',
  font: 'inherit', fontSize: 12, fontWeight: 750, padding: '9px 13px',
};
const neutralButton = {
  ...quietButton, border: '1px solid var(--line, rgba(148,163,184,0.2))',
  background: 'transparent', color: 'var(--text-dim, #94a3b8)',
};
const dialogPrimary = {
  ...quietButton, borderColor: 'var(--accent, #3b82f6)', background: 'var(--accent, #3b82f6)', color: '#06101d', fontWeight: 850,
};

function text(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function editableText(value, max = 500) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function safeOfficialUrl(value) {
  try {
    const url = new URL(String(value || ''));
    const host = url.hostname.toLowerCase().replace(/\.$/u, '');
    return url.protocol === 'https:' && !url.username && !url.password && TRUSTED_APPLY_HOSTS.has(host)
      ? url.toString() : '';
  } catch { return ''; }
}

function errorText(error) {
  const code = error instanceof MissionControlRequestError ? error.code : 'network_error';
  const copy = {
    feature_disabled: ['Mission Control ist für dieses Konto nicht aktiv.', 'مركز التحكم غير متاح لهذا الحساب.'],
    auth_required: ['Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.', 'انتهت الجلسة. سجّل الدخول مرة أخرى.'],
    email_verification_required: ['Bestätige zuerst deine E-Mail-Adresse.', 'أكّد بريدك الإلكتروني أولاً.'],
    plan_required: ['Dieser Schritt gehört zu Basic oder Elite.', 'هذه الخطوة متاحة في Basic أو Elite.'],
    upgrade_required: ['Dieser Schreib-Pack gehört zu Basic oder Elite.', 'حزمة الكتابة متاحة في Basic أو Elite.'],
    tracked_limit: ['Dein aktuelles Limit für aktive Bewerbungen ist erreicht.', 'وصلت إلى حد الطلبات النشطة في خطتك.'],
    application_limit: ['Dein Limit für aktive Bewerbungen ist erreicht.', 'وصلت إلى حد طلبات التقديم النشطة.'],
    not_ready_to_apply: ['BrainGuide zeigt dir zuerst die fehlende Vorbereitung.', 'سيعرض BrainGuide خطوة الاستعداد المطلوبة أولاً.'],
    passport_evidence_required: ['Bestätige zuerst mindestens einen nachweisbaren Punkt in deinem Bewerbungsprofil.', 'أكّد أولاً معلومة واحدة موثوقة في ملف التقديم.'],
    application_pack_stale: ['Dein Passport hat sich geändert. Erstelle den Pack neu und prüfe ihn erneut.', 'تم تعديل ملف المرشح. أنشئ الحزمة من جديد وراجعها.'],
    request_timeout: ['Der Server braucht zu lange. Bitte versuche es erneut.', 'الخادم يستغرق وقتاً طويلاً. حاول مرة أخرى.'],
    too_many_attempts: ['Bitte warte kurz, bevor du es erneut versuchst.', 'انتظر قليلاً قبل المحاولة مرة أخرى.'],
    network_error: ['Keine Verbindung zum Server. Bitte versuche es erneut.', 'لا يوجد اتصال بالخادم. حاول مرة أخرى.'],
  };
  return copy[code] || ['Das hat gerade nicht geklappt. Bitte prüfe deine Angaben.', 'لم تكتمل العملية. راجع البيانات وحاول مرة أخرى.'];
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

function toggleArray(current, id, max = 20) {
  return current.includes(id) ? current.filter((item) => item !== id) : [...current, id].slice(0, max);
}

function Label({ htmlFor, de, ar }) {
  return (
    <label htmlFor={htmlFor} style={{ display: 'block', marginBottom: 6 }}>
      <span style={{ display: 'block', color: 'var(--text, #e2e8f0)', fontSize: 12.5, fontWeight: 750 }}>{de}</span>
      <span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', fontSize: 10.5, marginTop: 2 }}>{ar}</span>
    </label>
  );
}

function Dialog({ open, title, titleAr, description, busy = false, onClose, children, width = 760 }) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot?.inert === true;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;
    const focusTimer = setTimeout(() => dialogRef.current?.querySelector('[data-autofocus],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled])')?.focus(), 0);
    const keydown = (event) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onCloseRef.current?.(); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!nodes.length) { event.preventDefault(); dialogRef.current?.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      clearTimeout(focusTimer);
      document.removeEventListener('keydown', keydown);
      document.body.style.overflow = previousOverflow;
      if (appRoot) appRoot.inert = wasInert;
      previousFocus?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="cmc-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose?.(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 12000, display: 'grid', placeItems: 'center', padding: 16,
        background: 'rgba(1,5,12,0.84)', backdropFilter: 'blur(7px)' }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="cmc-dialog-title" aria-describedby={description ? 'cmc-dialog-description' : undefined}
        aria-busy={busy} tabIndex={-1} style={{ ...panelStyle, width: '100%', maxWidth: width, maxHeight: 'min(92svh,900px)', overflowY: 'auto' }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 2, display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start', padding: '17px 18px',
          background: 'rgba(5,12,23,0.98)', borderBottom: '1px solid var(--line, rgba(148,163,184,0.18))' }}>
          <div style={{ minWidth: 0 }}>
            <h2 id="cmc-dialog-title" style={{ margin: 0, color: '#f8fafc', fontSize: 18, lineHeight: 1.3 }}>{title}</h2>
            {titleAr && <div dir="rtl" style={{ marginTop: 3, color: 'var(--text-dim, #94a3b8)', fontSize: 12.5 }}>{titleAr}</div>}
            {description && <p id="cmc-dialog-description" style={{ margin: '6px 0 0', color: 'var(--text-faint, #64748b)', fontSize: 11.5, lineHeight: 1.5 }}>{description}</p>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Dialog schließen" style={{ ...neutralButton, flex: '0 0 auto', paddingInline: 12 }}>SCHLIESSEN</button>
        </header>
        <div style={{ padding: 18 }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function Chip({ children, tone = 'neutral' }) {
  const color = tone === 'orange' ? 'var(--action, #f97316)' : tone === 'blue' ? 'var(--accent-2, #93c5fd)' : 'var(--text-dim, #94a3b8)';
  const border = tone === 'orange' ? 'rgba(249,115,22,0.35)' : tone === 'blue' ? 'rgba(96,165,250,0.35)' : 'rgba(148,163,184,0.2)';
  return <span style={{ display: 'inline-flex', alignItems: 'center', minHeight: 27, padding: '4px 8px', borderRadius: 999, border: `1px solid ${border}`, color, fontSize: 10.5, fontWeight: 750 }}>{children}</span>;
}

function EmptyState({ de, ar }) {
  return (
    <div style={{ padding: '24px 16px', textAlign: 'center', borderRadius: 12, border: '1px dashed rgba(148,163,184,0.25)' }}>
      <div style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 13 }}>{de}</div>
      <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 12, marginTop: 4 }}>{ar}</div>
    </div>
  );
}

function OpportunityCard({ opportunity, tracker = false, busy, onPack, onOpenApply, onMarkSubmitted, onResponse, onInterview, onOutcome }) {
  const readiness = READINESS_LABELS[opportunity.readinessState] || READINESS_LABELS.MEASURE_FIRST;
  const applyUrl = safeOfficialUrl(opportunity.applyUrl);
  const trackingOnly = opportunity.applicationPack?.trackingOnly === true
    || opportunity.applicationPack?.status === 'tracker_only';
  const packApproved = trackingOnly || opportunity.applicationPack?.status === 'approved'
    || opportunity.applicationPack?.status === 'submitted';
  const submitted = opportunity.applicationPack?.status === 'submitted' || opportunity.status === 'user_submitted';
  const invite = opportunity.response?.classification === 'interview_invitation'
    || opportunity.status === 'interview_proposed';
  const [outcome, setOutcome] = useState('');
  return (
    <article id={`cmc-opportunity-${opportunity.id}`} tabIndex={-1} style={{ padding: 15, borderRadius: 13, border: '1px solid var(--line, rgba(148,163,184,0.18))', background: 'rgba(255,255,255,0.018)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: '1 1 250px' }}>
          <div style={{ color: 'var(--text-faint, #64748b)', fontSize: 10.5 }}>{opportunity.employerDisplay}</div>
          <h3 style={{ margin: '4px 0 0', color: '#f8fafc', fontSize: 15.5, lineHeight: 1.35 }}>{opportunity.title}</h3>
          <div style={{ marginTop: 5, color: 'var(--text-dim, #94a3b8)', fontSize: 11.5 }}>
            {[opportunity.location, opportunity.sourceHost, opportunity.postedDate].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <Chip tone={opportunity.hardFit ? 'blue' : 'orange'}>{opportunity.hardFit ? 'HARD FIT' : 'FIT PRÜFEN'}</Chip>
          <Chip tone={opportunity.readinessState === 'READY_TO_APPLY' ? 'blue' : 'orange'}>{readiness[0]}</Chip>
          <Chip>{opportunity.fitScore}/100</Chip>
          <Chip>{STATUS_LABELS[opportunity.status] || opportunity.status}</Chip>
        </div>
      </div>

      <div className="cmc-two" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 10, marginTop: 13 }}>
        <div style={{ padding: '10px 11px', borderRadius: 10, background: 'rgba(59,130,246,0.045)', border: '1px solid rgba(96,165,250,0.16)' }}>
          <div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 10.5, fontWeight: 800 }}>WARUM PASSEND</div>
          <ul style={{ margin: '7px 0 0', paddingLeft: 17, color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.55 }}>
            {(opportunity.fitReasons.length ? opportunity.fitReasons : ['Noch keine bestätigten Fit-Gründe.']).map((item) => <li key={item}>{FIT_LABELS[item] || item}</li>)}
          </ul>
        </div>
        <div style={{ padding: '10px 11px', borderRadius: 10, background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.16)' }}>
          <div style={{ color: 'var(--action, #f97316)', fontSize: 10.5, fontWeight: 800 }}>LÜCKEN / VORBEHALTE</div>
          <ul style={{ margin: '7px 0 0', paddingLeft: 17, color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.55 }}>
            {(opportunity.fitGaps.length ? opportunity.fitGaps : ['Keine harte Lücke aus den bestätigten Daten erkannt.']).map((item) => <li key={item}>{GAP_LABELS[item] || item}</li>)}
          </ul>
        </div>
      </div>
      {!!opportunity.readinessReasons.length && (
        <div style={{ marginTop: 9, color: 'var(--text-faint, #64748b)', fontSize: 11.5, lineHeight: 1.5 }}>
          <b style={{ color: 'var(--text-dim, #94a3b8)' }}>Readiness:</b> {opportunity.readinessReasons.map((item) => READINESS_REASON_LABELS[item] || item).join(' · ')}
        </div>
      )}

      <div className="cmc-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
        <button type="button" onClick={() => onPack(opportunity)} disabled={busy || opportunity.readinessState !== 'READY_TO_APPLY'} style={quietButton}
          title={opportunity.readinessState !== 'READY_TO_APPLY' ? 'BrainGuide zeigt zuerst den nötigen Vorbereitungsschritt.' : undefined}>
          {opportunity.applicationPack ? (trackingOnly ? 'TRACKER PRÜFEN' : 'PACK PRÜFEN') : 'PACK ERSTELLEN'}
        </button>
        {packApproved && applyUrl && <button type="button" onClick={() => onOpenApply(opportunity, applyUrl)} disabled={busy} style={neutralButton}>OFFIZIELLE SEITE ÖFFNEN</button>}
        {packApproved && !submitted && <button type="button" onClick={() => onMarkSubmitted(opportunity)} disabled={busy} style={neutralButton}>ICH HABE ES EINGEREICHT</button>}
        {submitted && <button type="button" onClick={() => onResponse(opportunity)} disabled={busy} style={neutralButton}>ANTWORT EINORDNEN</button>}
        {invite && <button type="button" onClick={() => onInterview(opportunity)} disabled={busy} style={neutralButton}>INTERVIEW BESTÄTIGEN</button>}
      </div>

      {tracker && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap', marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--line, rgba(148,163,184,0.16))' }}>
          <div style={{ flex: '1 1 190px' }}>
            <label htmlFor={`cmc-outcome-${opportunity.id}`} style={{ display: 'block', color: 'var(--text-faint, #64748b)', fontSize: 10.5, marginBottom: 5 }}>Abschlussstatus</label>
            <select id={`cmc-outcome-${opportunity.id}`} value={outcome} onChange={(event) => setOutcome(event.target.value)} style={{ ...fieldStyle, minHeight: 44 }}>
              <option value="">Keine Änderung</option>
              {APPLICATION_OUTCOME_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}
            </select>
          </div>
          <button type="button" onClick={() => outcome && onOutcome(opportunity, outcome)} disabled={busy || !outcome} style={neutralButton}>STATUS SPEICHERN</button>
        </div>
      )}
    </article>
  );
}

function freshPassport(passport) {
  return {
    roleTypes: [...(passport?.roleTypes || [])], industryKeys: [...(passport?.industryKeys || [])],
    germanLevel: passport?.germanLevel || 'unspecified', locationMode: passport?.locationMode || 'flexible',
    shiftPreferences: [...(passport?.shiftPreferences || [])], availabilityDate: passport?.availabilityDate || '',
    experienceBand: passport?.experienceBand || 'entry', salaryFloorEGP: passport?.salaryFloorEGP ?? '',
    workAuthorization: passport?.workAuthorization || 'egypt_authorized', skillIds: [...(passport?.skillIds || [])],
    facts: (passport?.facts || []).map((fact) => ({ ...fact })),
    consentVersion: Number(passport?.consentVersion) || 1,
  };
}

export function CandidateMissionControl({
  apiUrl,
  token,
  enabled = false,
  featureState = 'off',
  entitlement = null,
  onBeacon,
  onOpenOfficialApplication,
  onInterviewConfirmed,
  onStartAssessment,
  onMissionStateChange,
  onRequestUpgrade,
  openRequest = null,
  refreshKey = 0,
  className = '',
}) {
  const active = enabled === true && (featureState === 'on' || featureState === 'beta') && !!apiUrl && !!token;
  const client = useMemo(() => {
    if (!active) return null;
    try { return createMissionControlClient({ apiUrl, token }); } catch { return null; }
  }, [active, apiUrl, token]);
  const [visibility, setVisibility] = useState('checking');
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState('today');
  const [passport, setPassport] = useState(null);
  const [interviewPass, setInterviewPass] = useState(null);
  const [capabilities, setCapabilities] = useState({});
  const [radar, setRadar] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyAction, setBusyAction] = useState('');
  const [dialog, setDialog] = useState(null);
  const [passportDraft, setPassportDraft] = useState(null);
  const [passportConsent, setPassportConsent] = useState(false);
  const [factDraft, setFactDraft] = useState({ type: 'experience', value: '', shareAllowed: false });
  const [importMode, setImportMode] = useState('link');
  const [importValue, setImportValue] = useState('');
  const [pack, setPack] = useState(null);
  const [cvIdentity, setCvIdentity] = useState({ fullName:'', email:'', phone:'', city:'' });
  const [packChecks, setPackChecks] = useState([false, false, false]);
  const [submissionConfirmed, setSubmissionConfirmed] = useState(false);
  const [responseText, setResponseText] = useState('');
  const [classification, setClassification] = useState(null);
  const [interviewForm, setInterviewForm] = useState({ interviewDate: '', interviewTime: '', confirmed: false });
  const loadControllerRef = useRef(null);
  const actionControllerRef = useRef(null);
  const radarBeaconRef = useRef(false);
  const rootRef = useRef(null);
  const lastOpenRequestRef = useRef(0);

  const emit = useCallback((event) => {
    try { onBeacon?.(event); } catch { /* analytics never changes a candidate decision */ }
  }, [onBeacon]);

  const mergeOpportunity = useCallback((next) => {
    if (!next?.id) return;
    setOpportunities((current) => uniqueById([next, ...current.filter((item) => item.id !== next.id)]));
    setRadar((current) => current.map((item) => item.id === next.id ? { ...item, ...next } : item));
  }, []);

  const reload = useCallback(async () => {
    if (!client) { setVisibility('hidden'); return; }
    loadControllerRef.current?.abort();
    const controller = new AbortController();
    loadControllerRef.current = controller;
    const results = await Promise.allSettled([
      client.getMissionBundle({ signal: controller.signal }),
      client.getRadar({ signal: controller.signal }),
      client.getOpportunities({ signal: controller.signal }),
    ]);
    if (controller.signal.aborted) return;
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    if (!fulfilled.length) {
      const statuses = results.map((result) => result.reason?.status).filter(Boolean);
      setVisibility(statuses.length > 0 && statuses.every((status) => status === 403) ? 'locked' : 'hidden');
      return;
    }
    if (results[0].status === 'fulfilled') {
      if (results[0].value.enabled !== true || results[0].value.paused) {
        setVisibility('hidden');
        return;
      }
      setPassport(results[0].value.passport);
      setInterviewPass(results[0].value.interviewPass);
      setCapabilities(results[0].value.capabilities);
    }
    if (results[1].status === 'fulfilled') {
      setRadar(results[1].value.slice(0, 5));
    }
    if (results[2].status === 'fulfilled') setOpportunities(results[2].value);
    setVisibility('visible');
  }, [client, emit]);

  useEffect(() => {
    if (!active || !client) { setVisibility('hidden'); return undefined; }
    reload();
    return () => { loadControllerRef.current?.abort(); actionControllerRef.current?.abort(); };
  }, [active, client, emit, refreshKey, reload]);

  useEffect(() => {
    if (!expanded || radarBeaconRef.current || visibility !== 'visible') return;
    radarBeaconRef.current = true;
    emit('job_radar_viewed');
  }, [emit, expanded, visibility]);

  useEffect(() => {
    const requestId = typeof openRequest === 'object' ? openRequest?.id : openRequest;
    if (!requestId || requestId === lastOpenRequestRef.current || visibility !== 'visible') return;
    lastOpenRequestRef.current = requestId;
    const step = typeof openRequest === 'object' ? openRequest?.step : 'today';
    const opportunityId = typeof openRequest === 'object' ? openRequest?.opportunityId : '';
    const opportunity = [...opportunities, ...radar].find((item) => item.id === opportunityId) || null;
    emit('mission_control_opened');
    if (step === 'measure') {
      onStartAssessment?.();
      return;
    }
    if (step === 'passport') {
      openPassport();
      return;
    }
    setExpanded(true);
    if (step === 'pack' && opportunity) openPack(opportunity);
    else if (step === 'submit' && opportunity) openOfficial(opportunity);
    else if (step === 'response' && opportunity) openResponse(opportunity);
    else if (step === 'interview' && opportunity) onInterviewConfirmed?.({ opportunityId:opportunity.id, opportunity, routeOnly:true });
    else setView(step === 'shortlist' || step === 'today' || step === 'prep' ? 'today' : 'tracker');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      rootRef.current?.scrollIntoView({ behavior:'smooth', block:'start' });
      const target = opportunityId ? document.getElementById(`cmc-opportunity-${opportunityId}`) : null;
      target?.scrollIntoView({ behavior:'smooth', block:'center' });
      (target || rootRef.current)?.querySelector?.('button:not(:disabled)')?.focus();
    }));
    // Route actions are function declarations that deliberately use the latest loaded bundle.
    // requestId makes this effect idempotent even though those declarations are recreated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit, openRequest, onInterviewConfirmed, onStartAssessment, opportunities, radar, visibility]);

  if (!active || !client || visibility === 'checking' || visibility === 'hidden') return null;

  function closeDialog() {
    if (busyAction) return;
    setDialog(null); setError(null); setNotice(null); setResponseText(''); setClassification(null);
    setPack(null); setPackChecks([false, false, false]); setSubmissionConfirmed(false); setImportValue('');
    setCvIdentity({ fullName:'', email:'', phone:'', city:'' });
  }

  async function runAction(name, action) {
    if (busyAction) return null;
    actionControllerRef.current?.abort();
    const controller = new AbortController();
    actionControllerRef.current = controller;
    setBusyAction(name); setError(null); setNotice(null);
    try { return await action(controller.signal); }
    catch (actionError) {
      if (actionError?.name !== 'AbortError') {
        setError(errorText(actionError));
        if (actionError?.status === 403 && ['plan_required', 'entitlement_required', 'upgrade_required', 'application_limit'].includes(actionError.code)) emit('mission_paywall_shown');
      }
      return null;
    } finally {
      if (actionControllerRef.current === controller) actionControllerRef.current = null;
      setBusyAction('');
    }
  }

  function openPassport() {
    if (capabilities.fullPassport !== true) {
      setNotice(['Das vollständige Bewerbungsprofil gehört zu Basic und Elite.', 'ملف التقديم الكامل متاح في Basic وElite.']);
      emit('mission_paywall_shown');
      onRequestUpgrade?.();
      return;
    }
    setPassportDraft(freshPassport(passport)); setPassportConsent(false); setFactDraft({ type: 'experience', value: '', shareAllowed: false });
    setError(null); setNotice(null); setDialog('passport'); emit('candidate_passport_opened');
  }

  function updateDraft(key, value) { setPassportDraft((current) => ({ ...current, [key]: value })); }

  function addFact() {
    const value = text(factDraft.value, 240);
    if (!value || !passportDraft || passportDraft.facts.length >= 12) return;
    const fact = {
      id: `fact_${Date.now().toString(36)}_${passportDraft.facts.length + 1}`,
      type: factDraft.type, value, provenance: 'user_confirmed', confirmedAt: Date.now(), shareAllowed: factDraft.shareAllowed,
    };
    updateDraft('facts', [...passportDraft.facts, fact]);
    setFactDraft({ type: 'experience', value: '', shareAllowed: false });
  }

  async function savePassport() {
    if (!passportDraft?.roleTypes.length || !passportDraft?.industryKeys.length || !passportConsent) {
      setError(['Wähle mindestens eine Zielrolle und Branche und bestätige die Richtigkeit.', 'اختر وظيفة ومجالاً مستهدفين على الأقل وأكّد صحة البيانات.']);
      return;
    }
    const body = {
      roleTypes: passportDraft.roleTypes.slice(0, 5), industryKeys: passportDraft.industryKeys.slice(0, 10),
      germanLevel: passportDraft.germanLevel, locationMode: passportDraft.locationMode,
      shiftPreferences: passportDraft.shiftPreferences.slice(0, 5), availabilityDate: passportDraft.availabilityDate || null,
      experienceBand: passportDraft.experienceBand,
      salaryFloorEGP: passportDraft.salaryFloorEGP === '' ? null : Math.max(0, Math.round(Number(passportDraft.salaryFloorEGP) || 0)),
      workAuthorization: passportDraft.workAuthorization, skillIds: passportDraft.skillIds.slice(0, 8),
      facts: passportDraft.facts.slice(0, 12).map((fact) => ({
        id: text(fact.id, 80), type: text(fact.type, 50), value: text(fact.value, 240), provenance: 'user_confirmed',
        confirmedAt: Number(fact.confirmedAt) || Date.now(), shareAllowed: fact.shareAllowed === true,
      })),
      consentVersion: 1,
    };
    const saved = await runAction('passport', (signal) => client.savePassport(body, { signal }));
    if (!saved) return;
    setPassport(saved); setNotice(['Passport gespeichert.', 'تم حفظ ملف المرشح.']); emit('candidate_passport_saved');
    onMissionStateChange?.();
    setTimeout(() => setDialog(null), 250);
    reload();
  }

  function openImport() { setDialog('import'); setImportMode('link'); setImportValue(''); setError(null); setNotice(null); }

  async function importOpportunity() {
    const value = importValue.trim();
    if (!value) { setError(['Füge einen öffentlichen Link oder den Anzeigentext ein.', 'أضف رابطاً عاماً أو نص الإعلان.']); return; }
    let source;
    if (importMode === 'link') {
      const url = safeOfficialUrl(value);
      if (!url) { setError(['Nur vollständige öffentliche https://-Links sind erlaubt.', 'يُسمح فقط بروابط https العامة والكاملة.']); return; }
      source = { sourceUrl: url };
    } else source = { vacancyText: value.slice(0, 20_000) };
    setImportValue('');
    const imported = await runAction('import', (signal) => client.importOpportunity(source, { signal }));
    if (!imported?.id) return;
    mergeOpportunity(imported); setNotice(['Stelle wurde geprüft und gespeichert.', 'تم فحص الوظيفة وحفظها.']); emit('opportunity_imported');
    onMissionStateChange?.();
    setTimeout(() => setDialog(null), 300); reload();
  }

  async function openPack(opportunity) {
    setDialog('pack'); setPack(null); setPackChecks([false, false, false]); setSubmissionConfirmed(false); setError(null); setNotice(null);
    setCvIdentity({ fullName:'', email:'', phone:'', city:'' });
    emit('application_pack_opened');
    const created = await runAction('pack', (signal) => client.createApplicationPack(opportunity.id, { signal }));
    if (!created?.id) return;
    const wasNew = !opportunity.applicationPack;
    setPack({ ...created, opportunityId: created.opportunityId || opportunity.id, applyUrl: created.applyUrl || opportunity.applyUrl });
    mergeOpportunity({ ...opportunity, applicationPack: {
      id: created.id, status: created.status, trackingOnly: created.trackingOnly,
    } });
    if (wasNew && !created.trackingOnly) emit('application_pack_created');
  }

  async function approvePack() {
    if (!pack?.id || !packChecks.every(Boolean)) {
      setError(['Bestätige alle drei Wahrheits- und Kontrollpunkte.', 'أكّد نقاط الحقيقة والتحكم الثلاث.']); return;
    }
    const visibleFactIds = pack.facts.map((fact) => fact.id).filter(Boolean);
    if (!visibleFactIds.length) {
      setError(['Dieser Pack enthält keine sichtbaren Fakten und kann nicht freigegeben werden.', 'لا توجد حقائق ظاهرة يمكن تأكيدها في هذه الحزمة.']);
      return;
    }
    const approved = await runAction('approve-pack', (signal) => client.approveApplicationPack(pack.id, {
      confirmed: true, factLockIds: visibleFactIds, confirmationVersion: 1,
    }, { signal }));
    if (!approved?.id) return;
    setPack({ ...approved, summary:pack.summary, coverNote:pack.coverNote, answers:pack.answers }); emit('application_pack_approved');
    onMissionStateChange?.();
    const opportunity = opportunities.find((item) => item.id === (approved.opportunityId || pack.opportunityId))
      || radar.find((item) => item.id === (approved.opportunityId || pack.opportunityId));
    if (opportunity) mergeOpportunity({ ...opportunity, applicationPack: { id: approved.id, status: approved.status || 'approved' } });
  }

  async function openOfficial(opportunity) {
    if (!opportunity?.id || typeof client.verifyOfficialPage !== 'function') {
      setError(['Die offizielle Bewerbungsseite konnte nicht sicher geprüft werden.', 'تعذّر التحقق الآمن من صفحة التقديم الرسمية.']);
      return;
    }
    const verified = await runAction('verify-official-page', (signal) => client.verifyOfficialPage(opportunity.id, { signal }));
    const url = safeOfficialUrl(verified?.officialApplyUrl);
    if (!url) { setError(['Die offizielle Bewerbungsseite ist nicht mehr verfügbar.', 'صفحة التقديم الرسمية لم تعد متاحة.']); return; }
    emit('official_apply_opened');
    if (typeof onOpenOfficialApplication === 'function') onOpenOfficialApplication({ opportunity, url });
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  function updatePackText(key, value) {
    setPack((current) => current ? { ...current, [key]: editableText(value, key === 'coverNote' ? 3000 : 1600) } : current);
  }

  function updatePackAnswer(answerId, value) {
    setPack((current) => current ? {
      ...current,
      answers: current.answers.map((answer) => answer.id === answerId ? { ...answer, answer:editableText(value, 1200) } : answer),
    } : current);
  }

  async function copyApplicationNote() {
    if (!pack?.coverNote || !navigator.clipboard?.writeText) {
      setError(['Kopieren ist in diesem Browser nicht verfügbar. Markiere den Text manuell.', 'النسخ غير متاح في هذا المتصفح. حدّد النص يدوياً.']);
      return;
    }
    try {
      await navigator.clipboard.writeText(pack.coverNote);
      setNotice(['Anschreiben kopiert.', 'تم نسخ رسالة التقديم.']);
    } catch {
      setError(['Kopieren wurde vom Browser blockiert. Markiere den Text manuell.', 'المتصفح منع النسخ. حدّد النص يدوياً.']);
    }
  }

  function downloadAtsCv() {
    const fullName = text(cvIdentity.fullName, 100);
    const email = text(cvIdentity.email, 160);
    const phone = text(cvIdentity.phone, 60);
    const city = text(cvIdentity.city, 100);
    if (!pack || !fullName || (!email && !phone)) {
      setError(['Für den lokalen CV-Export fehlen dein Name und mindestens E-Mail oder Telefon.', 'لتصدير السيرة محلياً أضف اسمك والبريد أو الهاتف على الأقل.']);
      return;
    }
    const contact = [email, phone, city].filter(Boolean).join(' | ');
    const lines = [
      fullName.toUpperCase(), contact, '',
      'BERUFLICHES PROFIL', pack.summary || 'Bitte ergänzen.', '',
      'RELEVANTE ERFAHRUNG UND KOMPETENZEN',
      ...pack.facts.map((fact) => `- ${fact.value}`), '',
      'ZIELROLLE', `${pack.title}${pack.employerDisplay ? ` — ${pack.employerDisplay}` : ''}`, '',
      'HINWEIS', 'Vor dem Einreichen vollständig prüfen und fehlende Ausbildung, Zeiträume und Stationen ergänzen.',
    ];
    const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type:'text/plain;charset=utf-8' });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = `CV_${fullName.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 60) || 'Kandidat'}_ATS.txt`;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
    emit('application_pack_exported');
    setNotice(['ATS-lesbarer CV-Text wurde lokal erstellt. Nichts davon wurde hochgeladen.', 'تم إنشاء نص سيرة مناسب لأنظمة التوظيف محلياً ولم يتم رفع أي بيانات.']);
  }

  function requestMarkSubmitted(opportunity) {
    setPack({
      id: opportunity.applicationPack?.id, opportunityId: opportunity.id, status: opportunity.applicationPack?.status,
      trackingOnly: opportunity.applicationPack?.trackingOnly === true,
      title: opportunity.title, employerDisplay: opportunity.employerDisplay, applyUrl: opportunity.applyUrl,
      facts: [], answers: [], warnings: [], summary: '', coverNote: '',
    });
    setSubmissionConfirmed(false); setDialog('submitted'); setError(null); setNotice(null);
  }

  async function markSubmitted() {
    if (!pack?.id || !submissionConfirmed) { setError(['Bestätige, dass du selbst eingereicht hast.', 'أكّد أنك قدّمت الطلب بنفسك.']); return; }
    const result = await runAction('submitted', (signal) => client.markSubmitted(pack.id, { signal }));
    if (!result) return;
    const opportunity = opportunities.find((item) => item.id === pack.opportunityId) || radar.find((item) => item.id === pack.opportunityId);
    if (opportunity) mergeOpportunity({ ...opportunity, status: 'user_submitted', applicationPack: { id: pack.id, status: 'submitted' } });
    emit('application_marked_submitted'); setNotice(['Als selbst eingereicht markiert.', 'تم تسجيل أنك قدّمت الطلب بنفسك.']);
    onMissionStateChange?.();
    setTimeout(() => setDialog(null), 300);
  }

  function openResponse(opportunity) {
    setPack({ id: opportunity.applicationPack?.id || '', opportunityId: opportunity.id, title: opportunity.title,
      employerDisplay: opportunity.employerDisplay, applyUrl: opportunity.applyUrl, facts: [], answers: [], warnings: [], summary: '', coverNote: '' });
    setResponseText(''); setClassification(null); setDialog('response'); setError(null); setNotice(null);
  }

  async function classifyResponse() {
    const transient = responseText.trim();
    if (transient.length < 8 || !pack?.opportunityId) { setError(['Füge die relevante Arbeitgeber-Antwort ein.', 'ألصق رد صاحب العمل ذي الصلة.']); return; }
    setResponseText('');
    const result = await runAction('response', (signal) => client.classifyResponse(pack.opportunityId, transient.slice(0, 10_000), { signal }));
    if (!result) return;
    setClassification(result); emit('response_classified');
    onMissionStateChange?.();
    const opportunity = opportunities.find((item) => item.id === pack.opportunityId) || radar.find((item) => item.id === pack.opportunityId);
    if (opportunity) mergeOpportunity({ ...opportunity, status: result.classification === 'interview_invitation' ? 'interview_proposed' : 'human_response', response: result });
  }

  function openInterview(opportunity, response = null) {
    const source = response || opportunity.response || {};
    setPack({ id: opportunity.applicationPack?.id || '', opportunityId: opportunity.id, title: opportunity.title,
      employerDisplay: opportunity.employerDisplay, applyUrl: opportunity.applyUrl, facts: [], answers: [], warnings: [], summary: '', coverNote: '' });
    setInterviewForm({ interviewDate: source.proposedDate || opportunity.interviewDate || '', interviewTime: source.proposedTime || opportunity.interviewTime || '', confirmed: false });
    setDialog('interview'); setError(null); setNotice(null);
  }

  async function confirmInterview() {
    if (!pack?.opportunityId || !/^\d{4}-\d{2}-\d{2}$/u.test(interviewForm.interviewDate) || !interviewForm.confirmed) {
      setError(['Wähle das bestätigte Datum und bestätige es.', 'اختر التاريخ المؤكد ثم أكّده.']); return;
    }
    const confirmation = {
      interviewDate: interviewForm.interviewDate,
      interviewTime: /^\d{2}:\d{2}$/u.test(interviewForm.interviewTime) ? interviewForm.interviewTime : null,
      timezone: 'Africa/Cairo', confirmed: true,
    };
    const result = await runAction('interview', (signal) => client.confirmInterview(pack.opportunityId, confirmation, { signal }));
    if (!result) return;
    const opportunity = opportunities.find((item) => item.id === pack.opportunityId) || radar.find((item) => item.id === pack.opportunityId);
    if (opportunity) mergeOpportunity({ ...opportunity, status: 'interview_confirmed', ...confirmation });
    emit('interview_confirmed'); onInterviewConfirmed?.({ opportunityId: pack.opportunityId, ...confirmation, result });
    onMissionStateChange?.();
    setNotice(['Interview bestätigt. BrainGuide übernimmt jetzt den nächsten Vorbereitungsschritt.', 'تم تأكيد المقابلة. BrainGuide سيحدد خطوة الاستعداد التالية.']);
    setTimeout(() => setDialog(null), 450);
  }

  async function updateOutcome(opportunity, outcome) {
    const updated = await runAction('outcome', (signal) => client.updateOutcome(opportunity.id, outcome, { signal }));
    if (!updated?.id) return;
    mergeOpportunity(updated); emit('application_outcome_recorded');
    onMissionStateChange?.();
  }

  if (visibility === 'locked') {
    return (
      <section className={`cmc ${className}`.trim()} style={{ ...panelStyle, padding: 16 }}>
        <div style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 12.5 }}>Mission Control ist für dieses Konto noch nicht verfügbar.</div>
        <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 11.5, marginTop: 4 }}>مركز التحكم غير متاح في هذه الخطة حالياً.</div>
        {typeof onRequestUpgrade === 'function' && <button type="button" onClick={() => { emit('mission_paywall_shown'); onRequestUpgrade(); }} style={{ ...neutralButton, marginTop: 10 }}>PLÄNE ANSEHEN</button>}
      </section>
    );
  }

  const allOpportunities = uniqueById([...opportunities, ...radar]);
  const interviewDayOpportunity = allOpportunities.find((item) => (
    item.status === 'interview_confirmed' && /^\d{4}-\d{2}-\d{2}$/u.test(item.interviewDate || '')
  )) || null;
  const passportCompleteness = passport?.completeness ?? Math.min(100, (passport?.roleTypes?.length ? 25 : 0) + (passport?.germanLevel !== 'unspecified' ? 20 : 0)
    + (passport?.shiftPreferences?.length ? 15 : 0) + (passport?.skillIds?.length ? 15 : 0) + (passport?.facts?.length ? 25 : 0));
  const busy = !!busyAction;
  const currentPassStep = interviewPass?.schedule?.[0] || null;
  const currentPassCopy = currentPassStep ? (PASS_STEP_COPY[currentPassStep.id] || [currentPassStep.title, 'خطوة التحضير التالية']) : null;

  if (!expanded) {
    return (
      <section ref={rootRef} className={`cmc ${className}`.trim()} aria-labelledby="cmc-compact-title"
        style={{ ...panelStyle, padding: '13px 14px', marginTop: 10 }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
          <div style={{ minWidth:0 }}>
            <div style={{ color:'var(--accent, #3b82f6)', fontSize:9.5, fontWeight:850, letterSpacing:'0.14em' }}>BEWERBUNGS-MISSION</div>
            <h2 id="cmc-compact-title" style={{ margin:'4px 0 0', color:'var(--text, #e2e8f0)', fontSize:14.5 }}>
              {currentPassCopy?.[0] || 'Dein Bewerbungsprofil, passende Stellen und dein Tracker'}
            </h2>
            <div dir="rtl" style={{ marginTop:3, color:'var(--text-faint, #64748b)', fontSize:10.5 }}>
              {currentPassCopy?.[1] || 'ملفك والوظائف الأنسب وتتبع التقديم — داخل OMNI-PERFORM'}
            </div>
          </div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <Chip tone="blue">{passportCompleteness}% PROFIL</Chip>
            <button type="button" onClick={() => { setExpanded(true); emit('mission_control_opened'); }} style={neutralButton}>VERWALTEN</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section ref={rootRef} className={`cmc ${className}`.trim()} aria-labelledby="cmc-title" aria-busy={busy} style={panelStyle}>
      <style>{`
        .cmc *{box-sizing:border-box}.cmc button:focus-visible,.cmc a:focus-visible,.cmc input:focus-visible,.cmc textarea:focus-visible,.cmc select:focus-visible,.cmc-overlay button:focus-visible,.cmc-overlay a:focus-visible,.cmc-overlay input:focus-visible,.cmc-overlay textarea:focus-visible,.cmc-overlay select:focus-visible{outline:3px solid rgba(96,165,250,.85);outline-offset:3px}.cmc button:disabled,.cmc-overlay button:disabled{cursor:not-allowed;opacity:.48}.cmc-tab{transition:background 140ms ease,border-color 140ms ease}.cmc-tab:hover{border-color:rgba(96,165,250,.48)!important}@media(max-width:620px){.cmc-head{padding:16px!important}.cmc-body{padding:14px!important}.cmc-two{grid-template-columns:1fr!important}.cmc-actions{flex-direction:column!important}.cmc-actions>button,.cmc-actions>a{width:100%}.cmc-tabs{grid-template-columns:repeat(2,minmax(0,1fr))!important}.cmc-tab{padding-inline:5px!important;font-size:10.5px!important}}@media(prefers-reduced-motion:reduce){.cmc *,.cmc-overlay *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}
      `}</style>
      <header className="cmc-head" style={{ padding: '19px 20px 16px', borderBottom: '1px solid var(--line, rgba(148,163,184,0.18))', background: 'rgba(7,15,28,0.9)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-display, inherit)', color: 'var(--accent, #3b82f6)', fontSize: 9.5, letterSpacing: '0.17em', fontWeight: 850 }}>BEWERBUNGEN</div>
            <h2 id="cmc-title" style={{ margin: '7px 0 0', color: '#f8fafc', fontSize: 'clamp(18px,3vw,23px)', lineHeight: 1.25 }}>Passende Stellen und dein Bewerbungs-Tracker</h2>
            <div dir="rtl" style={{ marginTop: 5, color: 'var(--text-dim, #94a3b8)', fontSize: 13 }}>الوظائف المناسبة ومتابعة التقديم — داخل OMNI-PERFORM</div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            <button type="button" onClick={openPassport} style={neutralButton}>PROFIL BEARBEITEN</button>
            <button type="button" onClick={() => { closeDialog(); setExpanded(false); }} style={neutralButton}>SCHLIESSEN</button>
          </div>
        </div>
      </header>

      <div className="cmc-body" style={{ padding: 18 }}>
        {(error || notice) && (
          <div role={error ? 'alert' : 'status'} style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 10,
            border: `1px solid ${error ? 'rgba(248,113,113,0.45)' : 'rgba(96,165,250,0.3)'}`,
            background: error ? 'rgba(127,29,29,0.14)' : 'rgba(59,130,246,0.055)' }}>
            <div style={{ color: error ? '#fecaca' : 'var(--accent-2, #93c5fd)', fontSize: 12 }}>{(error || notice)[0]}</div>
            <div dir="rtl" style={{ color: error ? '#fca5a5' : 'var(--text-dim, #94a3b8)', fontSize: 11.5, marginTop: 3 }}>{(error || notice)[1]}</div>
          </div>
        )}
        <nav aria-label="Bewerbungsbereiche" className="cmc-tabs" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,180px))', gap: 7 }}>
          {[
            ['today', 'HEUTE', 'اليوم'], ['tracker', 'TRACKER', 'المتابعة'],
          ].map(([id, de, ar]) => (
            <button key={id} type="button" onClick={() => setView(id)} aria-current={view === id ? 'page' : undefined}
              className="cmc-tab" style={{ ...neutralButton, borderColor: view === id ? 'rgba(96,165,250,0.58)' : 'rgba(148,163,184,0.18)', background: view === id ? 'rgba(59,130,246,0.11)' : 'transparent' }}>
              {de}<span dir="rtl" style={{ display: 'block', marginTop: 2, fontSize: 9.5, fontWeight: 500, color: 'var(--text-faint, #64748b)' }}>{ar}</span>
            </button>
          ))}
        </nav>

        {view === 'today' && (
          <div style={{ marginTop: 15 }}>
            {interviewDayOpportunity && (
              <section aria-labelledby="cmc-interview-pack-title" style={{ marginBottom:14, padding:'14px 15px', borderRadius:12,
                border:'1px solid rgba(249,115,22,0.3)', background:'rgba(249,115,22,0.045)' }}>
                <div style={{ color:'var(--action, #f97316)', fontSize:9.5, fontWeight:850, letterSpacing:'0.13em' }}>INTERVIEW-TAG PACK</div>
                <h3 id="cmc-interview-pack-title" style={{ margin:'5px 0 0', color:'#f8fafc', fontSize:15.5 }}>
                  {interviewDayOpportunity.title} · {interviewDayOpportunity.interviewDate}
                  {interviewDayOpportunity.interviewTime ? ` · ${interviewDayOpportunity.interviewTime}` : ''}
                </h3>
                <div dir="rtl" style={{ marginTop:3, color:'var(--text-faint, #64748b)', fontSize:11.5 }}>
                  حزمة يوم المقابلة مبنية فقط على البيانات التي أكّدتها
                </div>
                <div className="cmc-two" style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:10, marginTop:12 }}>
                  <div style={{ padding:'10px 11px', borderRadius:10, border:'1px solid rgba(148,163,184,0.16)' }}>
                    <div style={{ color:'var(--text-dim, #94a3b8)', fontSize:10.5, fontWeight:800 }}>DEINE BELEGE</div>
                    <ul style={{ margin:'7px 0 0', paddingLeft:17, color:'var(--text, #e2e8f0)', fontSize:11.5, lineHeight:1.55 }}>
                      {(passport?.facts || []).filter((fact) => fact.shareAllowed).slice(0, 3).map((fact) => <li key={fact.id}>{fact.value}</li>)}
                      {!(passport?.facts || []).some((fact) => fact.shareAllowed) && <li>Vor dem Gespräch bestätigte Belege ergänzen.</li>}
                    </ul>
                  </div>
                  <div style={{ padding:'10px 11px', borderRadius:10, border:'1px solid rgba(148,163,184,0.16)' }}>
                    <div style={{ color:'var(--text-dim, #94a3b8)', fontSize:10.5, fontWeight:800 }}>LETZTER CHECK</div>
                    <ul style={{ margin:'7px 0 0', paddingLeft:17, color:'var(--text, #e2e8f0)', fontSize:11.5, lineHeight:1.55 }}>
                      <li>Zeit, Zeitzone und Zugang bestätigen</li>
                      <li>60-Sekunden-Vorstellung einmal laut sprechen</li>
                      <li>Zwei ehrliche Arbeitgeberfragen bereithalten</li>
                    </ul>
                  </div>
                </div>
              </section>
            )}
            {interviewPass && (
              <section aria-labelledby="cmc-pass-title" style={{ marginBottom:14, padding:'14px 15px', borderRadius:12,
                border:'1px solid rgba(96,165,250,0.24)', background:'rgba(59,130,246,0.045)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:10, alignItems:'start', flexWrap:'wrap' }}>
                  <div>
                    <div style={{ color:'var(--accent-2, #93c5fd)', fontSize:9.5, fontWeight:850, letterSpacing:'0.13em' }}>INTERVIEW PASS</div>
                    <h3 id="cmc-pass-title" style={{ margin:'5px 0 0', color:'#f8fafc', fontSize:15.5 }}>Dein gespeicherter Vorbereitungsplan</h3>
                    <div dir="rtl" style={{ marginTop:3, color:'var(--text-faint, #64748b)', fontSize:11.5 }}>خطة التحضير المحفوظة داخل حسابك</div>
                  </div>
                  <Chip tone={interviewPass.planAccess === 'full' ? 'blue' : 'orange'}>
                    {interviewPass.planAccess === 'full' ? 'VOLLSTÄNDIG' : 'TAG 1'}
                  </Chip>
                </div>
                <ol style={{ margin:'12px 0 0', paddingLeft:22, display:'grid', gap:8 }}>
                  {interviewPass.schedule.map((step) => {
                    const copy = PASS_STEP_COPY[step.id] || [step.title, 'خطوة تحضير'];
                    return <li key={step.id} style={{ color:'var(--text, #e2e8f0)', fontSize:12.5, lineHeight:1.45 }}>
                      <span>{copy[0]}</span>
                      <span dir="rtl" style={{ display:'block', color:'var(--text-faint, #64748b)', fontSize:10.5 }}>{copy[1]}</span>
                    </li>;
                  })}
                </ol>
                {interviewPass.planAccess !== 'full' && (
                  <button type="button" onClick={() => { emit('mission_paywall_shown'); onRequestUpgrade?.(); }} style={{ ...neutralButton, marginTop:12 }}>
                    VOLLSTÄNDIGEN 7-TAGE-PLAN FREISCHALTEN
                  </button>
                )}
              </section>
            )}
            <div style={{ marginBottom: 11, color: 'var(--text-faint, #64748b)', fontSize: 11.5, lineHeight: 1.55 }}>
              Maximal fünf erklärte Chancen. Keine automatische Bewerbung, keine erfundenen Fakten.
              <span dir="rtl" style={{ display: 'block', marginTop: 2 }}>خمس فرص بحد أقصى، مع أسباب واضحة. لا يوجد تقديم تلقائي أو معلومات مختلقة.</span>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {radar.length ? radar.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} busy={busy}
                onPack={openPack} onOpenApply={openOfficial} onMarkSubmitted={requestMarkSubmitted}
                onResponse={openResponse} onInterview={openInterview} onOutcome={updateOutcome} />)
                : <EmptyState de="Heute gibt es noch keine verifizierte Empfehlung." ar="لا توجد توصية موثقة لليوم بعد." />}
            </div>
          </div>
        )}

        {view === 'tracker' && (
          <div style={{ marginTop: 15 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 11 }}>
              <div>
                <div style={{ color: 'var(--text, #e2e8f0)', fontSize: 13, fontWeight: 750 }}>Bewerbungs-Tracker</div>
                <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 11, marginTop: 2 }}>متابعة طلبات التوظيف</div>
              </div>
              <button type="button" onClick={openImport} style={neutralButton}>STELLE HINZUFÜGEN</button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {allOpportunities.length ? allOpportunities.map((opportunity) => <OpportunityCard key={opportunity.id} opportunity={opportunity} tracker busy={busy}
                onPack={openPack} onOpenApply={openOfficial} onMarkSubmitted={requestMarkSubmitted}
                onResponse={openResponse} onInterview={openInterview} onOutcome={updateOutcome} />)
                : <EmptyState de="Noch keine Stelle im Tracker." ar="لا توجد وظيفة في المتابعة بعد." />}
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialog === 'passport'} title="Dein privates Bewerbungsprofil" titleAr="ملف التقديم الخاص بك" busy={busy} onClose={closeDialog}
        description="Hier bestätigst du Zieljob, Erfahrung und Verfügbarkeit. Die App nutzt nur deine bestätigten Angaben für passende Stellen und Bewerbungshilfen.">
        {passportDraft && <div style={{ display: 'grid', gap: 15 }}>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend style={{ color: 'var(--text, #e2e8f0)', fontSize: 12.5, fontWeight: 750 }}>Zielrollen <span dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontWeight: 500 }}>الوظائف المستهدفة</span></legend>
            <div className="cmc-two" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 7, marginTop: 8 }}>
              {ROLE_OPTIONS.map((item) => <label key={item.id} style={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.18)', cursor: 'pointer' }}>
                <input type="checkbox" checked={passportDraft.roleTypes.includes(item.id)} onChange={() => updateDraft('roleTypes', toggleArray(passportDraft.roleTypes, item.id, 5))} style={{ width: 19, height: 19, accentColor: 'var(--accent, #3b82f6)' }} />
                <span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5 }}>{item.de}<span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', fontSize: 9.5 }}>{item.ar}</span></span>
              </label>)}
            </div>
          </fieldset>

          <div className="cmc-two" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12 }}>
            <div><Label htmlFor="cmc-level" de="Deutschniveau" ar="مستوى الألمانية"/><select id="cmc-level" value={passportDraft.germanLevel} onChange={(event) => updateDraft('germanLevel', event.target.value)} style={fieldStyle}>{GERMAN_LEVEL_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}</select></div>
            <div><Label htmlFor="cmc-location" de="Arbeitsort" ar="مكان العمل"/><select id="cmc-location" value={passportDraft.locationMode} onChange={(event) => updateDraft('locationMode', event.target.value)} style={fieldStyle}>{LOCATION_MODE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}</select></div>
            <div><Label htmlFor="cmc-exp" de="Erfahrung" ar="الخبرة"/><select id="cmc-exp" value={passportDraft.experienceBand} onChange={(event) => updateDraft('experienceBand', event.target.value)} style={fieldStyle}>{EXPERIENCE_BAND_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}</select></div>
            <div><Label htmlFor="cmc-auth" de="Arbeitserlaubnis" ar="تصريح العمل"/><select id="cmc-auth" value={passportDraft.workAuthorization} onChange={(event) => updateDraft('workAuthorization', event.target.value)} style={fieldStyle}>{WORK_AUTHORIZATION_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}</select></div>
            <div><Label htmlFor="cmc-availability" de="Verfügbar ab" ar="متاح من تاريخ"/><input id="cmc-availability" type="date" value={passportDraft.availabilityDate} onChange={(event) => updateDraft('availabilityDate', event.target.value)} style={fieldStyle}/></div>
            <div><Label htmlFor="cmc-salary" de="Gehaltsuntergrenze EGP (optional)" ar="الحد الأدنى للراتب بالجنيه (اختياري)"/><input id="cmc-salary" type="number" min="0" step="500" inputMode="numeric" value={passportDraft.salaryFloorEGP} onChange={(event) => updateDraft('salaryFloorEGP', event.target.value)} style={fieldStyle}/></div>
          </div>

          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ color: 'var(--text, #e2e8f0)', fontSize: 12.5, fontWeight: 750 }}>Zielbranchen <span dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontWeight: 500 }}>المجالات المستهدفة</span></legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>{INDUSTRY_OPTIONS.map((item) => <label key={item.id} style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.18)', cursor: 'pointer' }}><input type="checkbox" checked={passportDraft.industryKeys.includes(item.id)} onChange={() => updateDraft('industryKeys', toggleArray(passportDraft.industryKeys, item.id, 10))} style={{ width: 18, height: 18, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11 }}>{item.de}<span dir="rtl" style={{ display: 'block', fontSize: 9, color: 'var(--text-faint, #64748b)' }}>{item.ar}</span></span></label>)}</div></fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ color: 'var(--text, #e2e8f0)', fontSize: 12.5, fontWeight: 750 }}>Schichten <span dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontWeight: 500 }}>الشيفتات</span></legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>{SHIFT_PREFERENCE_OPTIONS.map((item) => <label key={item.id} style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.18)', cursor: 'pointer' }}><input type="checkbox" checked={passportDraft.shiftPreferences.includes(item.id)} onChange={() => updateDraft('shiftPreferences', toggleArray(passportDraft.shiftPreferences, item.id, 5))} style={{ width: 18, height: 18, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11 }}>{item.de}<span dir="rtl" style={{ display: 'block', fontSize: 9, color: 'var(--text-faint, #64748b)' }}>{item.ar}</span></span></label>)}</div></fieldset>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ color: 'var(--text, #e2e8f0)', fontSize: 12.5, fontWeight: 750 }}>Bestätigte Skills <span dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontWeight: 500 }}>المهارات المؤكدة</span></legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7, marginTop: 8 }}>{PASSPORT_SKILL_OPTIONS.map((item) => <label key={item.id} style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 7, padding: '7px 9px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.18)', cursor: 'pointer' }}><input type="checkbox" checked={passportDraft.skillIds.includes(item.id)} onChange={() => updateDraft('skillIds', toggleArray(passportDraft.skillIds, item.id, 8))} style={{ width: 18, height: 18, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11 }}>{item.de}<span dir="rtl" style={{ display: 'block', fontSize: 9, color: 'var(--text-faint, #64748b)' }}>{item.ar}</span></span></label>)}</div></fieldset>

          <section aria-labelledby="cmc-facts-title" style={{ paddingTop: 13, borderTop: '1px solid var(--line, rgba(148,163,184,0.16))' }}>
            <h3 id="cmc-facts-title" style={{ margin: 0, color: 'var(--text, #e2e8f0)', fontSize: 13 }}>Bestätigte Faktenkarten</h3>
            <div dir="rtl" style={{ color: 'var(--text-faint, #64748b)', fontSize: 10.5, marginTop: 2 }}>حقائق لا تدخل ملف التقديم إلا بعد تأكيدك</div>
            <div style={{ display: 'grid', gap: 7, marginTop: 9 }}>{passportDraft.facts.map((fact) => <div key={fact.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 9, alignItems: 'center', padding: '9px 10px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.17)' }}><div><div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 9.5, fontWeight: 800 }}>{FACT_TYPE_OPTIONS.find((item) => item.id === fact.type)?.de || fact.type}{fact.shareAllowed ? ' · SHARE ALLOWED' : ' · PRIVATE'}</div><div style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.45, marginTop: 3 }}>{fact.value}</div></div><button type="button" onClick={() => updateDraft('facts', passportDraft.facts.filter((item) => item.id !== fact.id))} style={{ ...neutralButton, minWidth: 44, paddingInline: 9 }}>ENTFERNEN</button></div>)}</div>
            {passportDraft.facts.length < 12 && <div className="cmc-two" style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr)', gap: 8, marginTop: 9 }}><select aria-label="Faktentyp" value={factDraft.type} onChange={(event) => setFactDraft((current) => ({ ...current, type: event.target.value }))} style={fieldStyle}>{FACT_TYPE_OPTIONS.map((item) => <option key={item.id} value={item.id}>{item.de}</option>)}</select><input aria-label="Bestätigte Tatsache" maxLength={240} value={factDraft.value} onChange={(event) => setFactDraft((current) => ({ ...current, value: event.target.value }))} placeholder="Nur eine konkrete, wahre Tatsache" style={fieldStyle}/><label style={{ minHeight: 44, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-dim, #94a3b8)', fontSize: 11 }}><input type="checkbox" checked={factDraft.shareAllowed} onChange={(event) => setFactDraft((current) => ({ ...current, shareAllowed: event.target.checked }))} style={{ width: 18, height: 18, accentColor: 'var(--accent, #3b82f6)' }}/>Darf in einen Bewerbungs-Pack</label><button type="button" onClick={addFact} disabled={!factDraft.value.trim()} style={neutralButton}>FAKT HINZUFÜGEN</button></div>}
          </section>
          <label style={{ minHeight: 48, display: 'flex', alignItems: 'start', gap: 9, padding: '10px 11px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.26)', cursor: 'pointer' }}><input type="checkbox" checked={passportConsent} onChange={(event) => setPassportConsent(event.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.5 }}>Ich bestätige, dass diese Angaben wahr sind. Nur Karten mit „Darf in einen Bewerbungs-Pack“ dürfen geteilt werden.<span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', marginTop: 3 }}>أؤكد أن البيانات صحيحة، ولا تُستخدم إلا الحقائق التي سمحت بمشاركتها.</span></span></label>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}><button type="button" onClick={savePassport} disabled={busy || !passportConsent} style={dialogPrimary}>PROFIL SPEICHERN</button></div>
        </div>}
      </Dialog>

      <Dialog open={dialog === 'import'} title="Stelle hinzufügen" titleAr="إضافة وظيفة" busy={busy} onClose={closeDialog} width={620} description="Nur öffentliche Stellenanzeigen. Keine Login-Links oder privaten Nachrichten.">
        <div style={{ display: 'flex', gap: 7 }}><button type="button" onClick={() => { setImportMode('link'); setImportValue(''); }} style={importMode === 'link' ? quietButton : neutralButton}>LINK</button><button type="button" onClick={() => { setImportMode('paste'); setImportValue(''); }} style={importMode === 'paste' ? quietButton : neutralButton}>TEXT</button></div>
        <div style={{ marginTop: 13 }}><Label htmlFor="cmc-import" de={importMode === 'link' ? 'Öffentlicher https://-Link' : 'Text der Stellenanzeige'} ar={importMode === 'link' ? 'رابط https عام' : 'نص إعلان الوظيفة'}/>{importMode === 'link' ? <input id="cmc-import" data-autofocus type="url" inputMode="url" autoComplete="url" value={importValue} onChange={(event) => setImportValue(event.target.value)} style={fieldStyle}/> : <textarea id="cmc-import" data-autofocus rows={10} maxLength={20_000} value={importValue} onChange={(event) => setImportValue(event.target.value)} style={{ ...fieldStyle, minHeight: 180, resize: 'vertical' }}/>}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}><button type="button" onClick={importOpportunity} disabled={busy || !importValue.trim()} style={dialogPrimary}>{busy ? 'PRÜFE…' : 'PRÜFEN UND SPEICHERN'}</button></div>
      </Dialog>

      <Dialog open={dialog === 'pack'} title="Faktengebundener Bewerbungs-Pack" titleAr="حزمة تقديم مرتبطة بالحقائق" busy={busy} onClose={closeDialog} description="Kein Text darf mehr behaupten als dein bestätigter Passport und die öffentliche Anzeige.">
        {!pack ? <div role="status" style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 12.5 }}>Pack wird vorbereitet…</div> : <div style={{ display: 'grid', gap: 13 }}>
          <div><div style={{ color: 'var(--text-faint, #64748b)', fontSize: 10.5 }}>{pack.employerDisplay}</div><h3 style={{ margin: '4px 0 0', color: '#f8fafc', fontSize: 16 }}>{pack.title}</h3></div>
          {!!pack.warnings.length && <div style={{ padding: '10px 11px', borderRadius: 9, border: '1px solid rgba(249,115,22,0.3)', background: 'rgba(249,115,22,0.045)' }}><div style={{ color: 'var(--action, #f97316)', fontSize: 10.5, fontWeight: 800 }}>VOR PRÜFUNG KLÄREN</div><ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--text-dim, #94a3b8)', fontSize: 11.5 }}>{pack.warnings.map((item) => <li key={item}>{item}</li>)}</ul></div>}
          {!!pack.facts.length && <section><h3 style={{ margin: 0, color: 'var(--text, #e2e8f0)', fontSize: 13 }}>Gesperrte Fakten</h3><div style={{ display: 'grid', gap: 6, marginTop: 8 }}>{pack.facts.map((fact) => <div key={fact.id} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(96,165,250,0.2)' }}><div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 9.5, fontWeight: 800 }}>{fact.label}{fact.source ? ` · ${fact.source}` : ''}</div><div style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, marginTop: 3 }}>{fact.value}</div></div>)}</div></section>}
          {pack.summary && <section><Label htmlFor="cmc-pack-summary" de="Editierbares Kurzprofil" ar="ملخص مهني قابل للتعديل"/><textarea id="cmc-pack-summary" rows={5} maxLength={1600} value={pack.summary} onChange={(event) => updatePackText('summary', event.target.value)} style={{ ...fieldStyle, minHeight:110, resize:'vertical' }}/></section>}
          {pack.coverNote && <section><Label htmlFor="cmc-pack-note" de="Editierbarer Anschreiben-Entwurf" ar="مسودة رسالة تقديم قابلة للتعديل"/><textarea id="cmc-pack-note" rows={7} maxLength={3000} value={pack.coverNote} onChange={(event) => updatePackText('coverNote', event.target.value)} style={{ ...fieldStyle, minHeight:145, resize:'vertical' }}/><button type="button" onClick={copyApplicationNote} style={{ ...neutralButton, marginTop:7 }}>ANSCHREIBEN KOPIEREN</button></section>}
          {!!pack.answers.length && <section><h3 style={{ margin: 0, color: 'var(--text, #e2e8f0)', fontSize: 13 }}>Editierbare Antwortentwürfe</h3><div style={{ display: 'grid', gap: 7, marginTop: 7 }}>{pack.answers.map((answer) => <div key={answer.id} style={{ padding: '9px 10px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.17)' }}><Label htmlFor={`cmc-answer-${answer.id}`} de={answer.question} ar="راجع الإجابة واكتبها بطريقتك"/><textarea id={`cmc-answer-${answer.id}`} rows={4} maxLength={1200} value={answer.answer} onChange={(event) => updatePackAnswer(answer.id, event.target.value)} style={{ ...fieldStyle, minHeight:96, resize:'vertical' }}/></div>)}</div></section>}
          {!pack.trackingOnly && <section style={{ padding:'12px 13px', borderRadius:10, border:'1px solid rgba(96,165,250,0.25)', background:'rgba(59,130,246,0.045)' }}><h3 style={{ margin:0, color:'var(--accent-2, #93c5fd)', fontSize:13 }}>ATS-lesbaren CV lokal erstellen</h3><div dir="rtl" style={{ color:'var(--text-faint, #64748b)', fontSize:10.5, marginTop:3 }}>هذه البيانات تبقى في المتصفح ولا تُرسل إلى الخادم</div><div className="cmc-two" style={{ display:'grid', gridTemplateColumns:'repeat(2,minmax(0,1fr))', gap:8, marginTop:10 }}><input aria-label="Vollständiger Name" autoComplete="name" placeholder="Vollständiger Name" maxLength={100} value={cvIdentity.fullName} onChange={(event) => setCvIdentity((current) => ({ ...current, fullName:event.target.value }))} style={fieldStyle}/><input aria-label="E-Mail nur für lokalen CV" autoComplete="email" type="email" placeholder="E-Mail" maxLength={160} value={cvIdentity.email} onChange={(event) => setCvIdentity((current) => ({ ...current, email:event.target.value }))} style={fieldStyle}/><input aria-label="Telefon nur für lokalen CV" autoComplete="tel" type="tel" placeholder="Telefon" maxLength={60} value={cvIdentity.phone} onChange={(event) => setCvIdentity((current) => ({ ...current, phone:event.target.value }))} style={fieldStyle}/><input aria-label="Ort nur für lokalen CV" autoComplete="address-level2" placeholder="Ort" maxLength={100} value={cvIdentity.city} onChange={(event) => setCvIdentity((current) => ({ ...current, city:event.target.value }))} style={fieldStyle}/></div><p style={{ margin:'8px 0 0', color:'var(--text-faint, #64748b)', fontSize:10.5, lineHeight:1.5 }}>Der Export ist bewusst reiner Text: gut lesbar für ATS und leicht in Word zu vervollständigen. Prüfe Zeiträume und Ausbildung vor dem Upload.</p><button type="button" onClick={downloadAtsCv} style={{ ...neutralButton, marginTop:8 }}>ATS-CV-TEXT HERUNTERLADEN</button></section>}
          {pack.trackingOnly ? <div style={{ padding: '12px 13px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.25)', background: 'rgba(59,130,246,0.05)' }}><div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 11, fontWeight: 800 }}>KOSTENLOSER BEWERBUNGS-TRACKER</div><p style={{ margin: '6px 0 0', color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.55 }}>Du reichst selbst auf der offiziellen Seite ein. Ein faktengebundener Schreib-Pack gehört zu Basic oder Elite.</p><div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>{safeOfficialUrl(pack.applyUrl) && <button type="button" onClick={() => openOfficial({ id: pack.opportunityId, title: pack.title, employerDisplay: pack.employerDisplay, applyUrl: pack.applyUrl })} style={neutralButton}>OFFIZIELLE SEITE ÖFFNEN</button>}{pack.status !== 'submitted' && <button type="button" onClick={() => { setSubmissionConfirmed(false); setDialog('submitted'); }} style={neutralButton}>ICH HABE ES EINGEREICHT</button>}</div></div> : pack.status !== 'approved' && pack.status !== 'submitted' ? <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend style={{ color: 'var(--text, #e2e8f0)', fontSize: 12.5, fontWeight: 750 }}>Freigabe vor jeder externen Verwendung</legend><div style={{ display: 'grid', gap: 7, marginTop: 8 }}>{[
            ['Alle Aussagen über meine Erfahrung sind wahr.', 'كل ما يخص خبرتي صحيح.'],
            ['Sprache, Verfügbarkeit und Gehalt sind korrekt.', 'اللغة والتوفر والراتب صحيحة.'],
            ['Ich reiche selbst auf der offiziellen Arbeitgeberseite ein.', 'سأقدّم بنفسي على صفحة صاحب العمل الرسمية.'],
          ].map(([de, ar], index) => <label key={de} style={{ minHeight: 48, display: 'flex', alignItems: 'start', gap: 9, padding: '9px 10px', borderRadius: 9, border: '1px solid rgba(148,163,184,0.18)', cursor: 'pointer' }}><input type="checkbox" checked={packChecks[index]} onChange={(event) => setPackChecks((current) => current.map((value, i) => i === index ? event.target.checked : value))} style={{ width: 19, height: 19, marginTop: 1, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.45 }}>{de}<span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', marginTop: 2 }}>{ar}</span></span></label>)}</div><div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 11 }}><button type="button" onClick={approvePack} disabled={busy || !packChecks.every(Boolean)} style={dialogPrimary}>FAKTEN BESTÄTIGEN</button></div></fieldset> : <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}><Chip tone="blue">PACK FREIGEGEBEN</Chip>{safeOfficialUrl(pack.applyUrl) && <button type="button" onClick={() => openOfficial({ id: pack.opportunityId, title: pack.title, employerDisplay: pack.employerDisplay, applyUrl: pack.applyUrl })} style={neutralButton}>OFFIZIELLE SEITE ÖFFNEN</button>}{pack.status !== 'submitted' && <button type="button" onClick={() => { setSubmissionConfirmed(false); setDialog('submitted'); }} style={neutralButton}>ICH HABE ES EINGEREICHT</button>}</div>}
        </div>}
      </Dialog>

      <Dialog open={dialog === 'submitted'} title="Einreichung bestätigen" titleAr="تأكيد التقديم" busy={busy} onClose={closeDialog} width={540} description="OMNI-PERFORM reicht nichts automatisch ein.">
        <label style={{ minHeight: 52, display: 'flex', alignItems: 'start', gap: 10, padding: '11px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.26)', cursor: 'pointer' }}><input data-autofocus type="checkbox" checked={submissionConfirmed} onChange={(event) => setSubmissionConfirmed(event.target.checked)} style={{ width: 20, height: 20, marginTop: 1, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 12, lineHeight: 1.5 }}>Ich habe diese Bewerbung selbst auf der offiziellen Arbeitgeberseite eingereicht.<span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', marginTop: 3 }}>أنا قدّمت هذا الطلب بنفسي على الصفحة الرسمية لصاحب العمل.</span></span></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 13 }}><button type="button" onClick={markSubmitted} disabled={busy || !submissionConfirmed} style={dialogPrimary}>ALS EINGEREICHT MARKIEREN</button></div>
      </Dialog>

      <Dialog open={dialog === 'response'} title="Arbeitgeber-Antwort einordnen" titleAr="تصنيف رد صاحب العمل" busy={busy} onClose={closeDialog} width={620} description="Der eingefügte Text wird nur zur Einordnung gesendet und danach sofort aus dem Eingabefeld gelöscht.">
        {!classification ? <><Label htmlFor="cmc-response" de="Relevanten Antworttext einfügen" ar="ألصق الجزء المهم من الرد"/><textarea id="cmc-response" data-autofocus rows={9} maxLength={10_000} value={responseText} onChange={(event) => setResponseText(event.target.value)} autoComplete="off" style={{ ...fieldStyle, minHeight: 170, resize: 'vertical' }}/><div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" onClick={classifyResponse} disabled={busy || responseText.trim().length < 8} style={dialogPrimary}>EINORDNEN UND TEXT LÖSCHEN</button></div></> : <div><div style={{ padding: '12px 13px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.28)', background: 'rgba(59,130,246,0.055)' }}><div style={{ color: 'var(--accent-2, #93c5fd)', fontSize: 10, fontWeight: 850 }}>STRUKTURIERTES ERGEBNIS</div><div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 800, marginTop: 5 }}>{classification.classification.replaceAll('_', ' ')}</div>{classification.proposedDate && <div style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 12, marginTop: 5 }}>{classification.proposedDate}{classification.proposedTime ? ` · ${classification.proposedTime}` : ''} · noch nicht bestätigt</div>}</div>{classification.classification === 'interview_invitation' && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}><button type="button" onClick={() => openInterview({ id: pack.opportunityId, title: pack.title, employerDisplay: pack.employerDisplay, applyUrl: pack.applyUrl, response: classification }, classification)} style={dialogPrimary}>INTERVIEW BESTÄTIGEN</button></div>}</div>}
      </Dialog>

      <Dialog open={dialog === 'interview'} title="Interviewtermin bestätigen" titleAr="تأكيد موعد المقابلة" busy={busy} onClose={closeDialog} width={560} description="Erst deine Bestätigung aktiviert die zielgenaue Vorbereitung in BrainGuide.">
        <div className="cmc-two" style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 11 }}><div><Label htmlFor="cmc-interview-date" de="Datum" ar="التاريخ"/><input id="cmc-interview-date" data-autofocus type="date" value={interviewForm.interviewDate} onChange={(event) => setInterviewForm((current) => ({ ...current, interviewDate: event.target.value }))} style={fieldStyle}/></div><div><Label htmlFor="cmc-interview-time" de="Uhrzeit (optional)" ar="الوقت (اختياري)"/><input id="cmc-interview-time" type="time" value={interviewForm.interviewTime} onChange={(event) => setInterviewForm((current) => ({ ...current, interviewTime: event.target.value }))} style={fieldStyle}/></div></div>
        <div style={{ marginTop: 8, color: 'var(--text-faint, #64748b)', fontSize: 10.5 }}>Zeitzone: Africa/Cairo</div>
        <label style={{ minHeight: 50, display: 'flex', alignItems: 'start', gap: 9, marginTop: 13, padding: '10px 11px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.25)', cursor: 'pointer' }}><input type="checkbox" checked={interviewForm.confirmed} onChange={(event) => setInterviewForm((current) => ({ ...current, confirmed: event.target.checked }))} style={{ width: 20, height: 20, marginTop: 1, accentColor: 'var(--accent, #3b82f6)' }}/><span style={{ color: 'var(--text-dim, #94a3b8)', fontSize: 11.5, lineHeight: 1.5 }}>Ich habe Datum und Uhrzeit selbst geprüft.<span dir="rtl" style={{ display: 'block', color: 'var(--text-faint, #64748b)', marginTop: 3 }}>راجعت التاريخ والوقت بنفسي.</span></span></label>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 13 }}><button type="button" onClick={confirmInterview} disabled={busy || !interviewForm.confirmed || !interviewForm.interviewDate} style={dialogPrimary}>TERMIN BESTÄTIGEN</button></div>
      </Dialog>
    </section>
  );
}

export default CandidateMissionControl;
