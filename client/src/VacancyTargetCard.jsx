import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const EMPTY_CAPABILITIES = Object.freeze({
  canPreview: false,
  canPlan: false,
  canLive: false,
  linkImport: false,
});

const INDUSTRIES = [
  ['telecom', 'Telekommunikation & Internet'],
  ['ecommerce', 'E-Commerce & Handel'],
  ['fintech', 'Banken & Fintech'],
  ['airline', 'Airlines & Reisen'],
  ['delivery', 'Lieferdienste'],
  ['logistik', 'Logistik & Versand'],
  ['energie', 'Energie'],
  ['versicherung', 'Versicherungen'],
  ['streaming', 'Streaming & Abo-Dienste'],
  ['b2b', 'B2B & Werbekonten'],
];

const INDUSTRY_LABELS = new Map(INDUSTRIES);
const ROLE_TYPES = [
  ['customer_service', 'Kundenservice'],
  ['technical_support', 'Technischer Support'],
  ['sales', 'Vertrieb'],
  ['retention', 'Kundenrückgewinnung'],
  ['backoffice', 'Backoffice'],
];
const GERMAN_LEVELS = [
  ['unspecified', 'Nicht angegeben'],
  ['a2-b1', 'A2–B1'],
  ['b2', 'B2'],
  ['c1', 'C1'],
];
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

class VacancyRequestError extends Error {
  constructor(code, status = 0) {
    super(code || 'request_failed');
    this.name = 'VacancyRequestError';
    this.code = code || 'request_failed';
    this.status = status;
  }
}

function apiErrorCode(payload, fallback) {
  if (typeof payload?.error === 'string') return payload.error;
  if (typeof payload?.error?.code === 'string') return payload.error.code;
  if (typeof payload?.code === 'string') return payload.code;
  return fallback;
}

function userError(error) {
  const code = error?.code || error?.message;
  if (code === 'paste_required') return 'Der Link lässt sich nicht zuverlässig lesen. Füge bitte den Text der Stellenanzeige ein.';
  if (code === 'unsupported_vacancy') return 'Wir konnten darin keine konkrete Stelle erkennen. Prüfe den Text oder verwende eine andere Anzeige.';
  if (code === 'invalid_url') return 'Bitte gib einen vollständigen, öffentlichen https://-Link ohne Zugangsdaten ein.';
  if (code === 'vacancy_text_required') return 'Füge bitte den Text der Stellenanzeige ein.';
  if (code === 'role_required') return 'Prüfe bitte die Stellenbezeichnung.';
  if (code === 'industry_required') return 'Wähle bitte die passende Branche.';
  if (code === 'preview_used') return 'Deine kostenlose Stellen-Vorschau wurde bereits genutzt. Deine gespeicherte Ziel-Stelle bleibt verfügbar.';
  if (code === 'analysis_limit') return 'Das Analyse-Limit ist erreicht. Öffne eine bereits geprüfte Stelle oder versuche es später erneut.';
  if (code === 'meaningful_debrief_required') return 'Dieser Schritt wird erst nach einem echten, ausgewerteten Probeinterview abgeschlossen.';
  if (code === 'request_timeout') return 'Die Prüfung dauert gerade zu lange. Versuche es bitte noch einmal.';
  if (error?.status === 401) return 'Deine Sitzung ist abgelaufen. Melde dich bitte erneut an.';
  if (error?.status === 409) return 'Die Ziel-Stelle wurde in einem anderen Fenster geändert. Versuche es bitte erneut.';
  return 'Das hat gerade nicht geklappt. Prüfe deine Verbindung und versuche es noch einmal.';
}

function validSourceUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? raw : '';
  } catch {
    return '';
  }
}

function firstString(record, keys) {
  const sources = [record, record?.vacancy, record?.extracted, record?.summary].filter(Boolean);
  for (const source of sources) {
    for (const key of keys) {
      if (typeof source?.[key] === 'string' && source[key].trim()) return source[key].trim();
    }
  }
  return '';
}

function detailsFrom(record) {
  const industryKey = firstString(record, ['industryKey', 'industry', 'targetIndustry']);
  return {
    roleTitle: firstString(record, ['roleTitle', 'role', 'jobTitle', 'title', 'position']),
    employerDisplay: firstString(record, ['employerDisplay', 'employer', 'companyName', 'company']),
    industryKey,
    industryLabel: INDUSTRY_LABELS.get(industryKey) || firstString(record, ['industryLabel']) || industryKey,
    roleType: firstString(record, ['roleType']),
    germanLevel: firstString(record, ['germanLevel']),
    interviewDate: firstString(record, ['interviewDate', 'interview_date']),
  };
}

function dateInputValue(value) {
  const raw = String(value || '');
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function localDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formattedDate(value) {
  const date = localDate(value);
  if (!date) return 'Nicht angegeben';
  return new Intl.DateTimeFormat('de-DE', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
  }).format(date);
}

function calendarDayNumber(date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function countdownFor(value, now) {
  const date = localDate(value);
  if (!date) return { headline: 'Ohne festen Termin', detail: 'Trainiere in deinem Tempo.' };
  const days = Math.round(calendarDayNumber(date) - calendarDayNumber(now));
  if (days === 0) return { headline: 'Heute ist dein Interview', detail: formattedDate(value) };
  if (days === 1) return { headline: 'Morgen ist dein Interview', detail: formattedDate(value) };
  if (days > 1) return { headline: `Noch ${days} Tage`, detail: formattedDate(value) };
  return { headline: 'Interviewdatum prüfen', detail: `${formattedDate(value)} ist vorbei.` };
}

function entitlementLine(capabilities) {
  if (capabilities.canLive) return 'Elite: voller Plan + Live-Interviews zu dieser Stelle';
  if (capabilities.canPlan) return 'Basic: vollständiger Vorbereitungsplan';
  if (capabilities.canPreview) return 'Kostenlos: 3 passende Fragen + Tag 1';
  return 'Deine Stelle bleibt als privates Trainingsziel gespeichert.';
}

function looksLikeVacancy(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
  const details = detailsFrom(record);
  return !!(details.roleTitle || details.employerDisplay || details.industryKey || details.interviewDate);
}

function recordFrom(payload, key) {
  const nested = payload?.[key] ?? payload?.data?.[key];
  if (looksLikeVacancy(nested)) return nested;
  if (!('enabled' in (payload || {})) && looksLikeVacancy(payload)) return payload;
  return null;
}

function confirmationFrom(record, review) {
  const allowed = {
    roleTitle: review.roleTitle.trim(),
    employerDisplay: review.employerDisplay.trim() || null,
    industryKey: review.industryKey,
    roleType: review.roleType,
    germanLevel: review.germanLevel,
    interviewDate: review.interviewDate || null,
  };
  return allowed;
}

function initialReview(record, fallbackDate = '') {
  const details = detailsFrom(record);
  return {
    roleTitle: details.roleTitle,
    employerDisplay: details.employerDisplay,
    industryKey: details.industryKey,
    roleType: details.roleType || 'customer_service',
    germanLevel: details.germanLevel || 'unspecified',
    interviewDate: dateInputValue(details.interviewDate || fallbackDate),
  };
}

function TierPromise({ capabilities }) {
  return (
    <div style={{ display:'flex', alignItems:'center', gap:7, color:'var(--text-dim)', fontSize:'var(--fs-meta)', lineHeight:1.45 }}>
      <span aria-hidden="true" style={{ width:6, height:6, flex:'0 0 auto', borderRadius:'50%', background:'var(--accent)' }} />
      <span>{entitlementLine(capabilities)}</span>
    </div>
  );
}

function ReadonlyDetails({ record }) {
  const details = detailsFrom(record);
  const rows = [
    ['Stelle', details.roleTitle || 'Nicht erkannt'],
    ['Arbeitgeber', details.employerDisplay || 'Nicht genannt'],
    ['Branche', details.industryLabel || 'Nicht erkannt'],
    ['Interview', formattedDate(details.interviewDate)],
  ];
  return (
    <dl style={{ margin:0, display:'grid', gap:1, overflow:'hidden', borderRadius:12, border:'1px solid var(--line)', background:'var(--line)' }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display:'grid', gridTemplateColumns:'92px minmax(0,1fr)', gap:10, padding:'10px 12px', background:'var(--bg-1)' }}>
          <dt style={{ margin:0, color:'var(--text-faint)', fontSize:'var(--fs-meta)' }}>{label}</dt>
          <dd style={{ margin:0, color:'var(--text)', fontSize:'var(--fs-label)', overflowWrap:'anywhere' }}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function isLiveMilestone(id) {
  return id === 'day_6_mock' || id === 'day_7_rehearsal' || id === 'emergency_mock';
}

function nextMilestone(record) {
  return Array.isArray(record?.schedule) ? record.schedule.find((row) => !row.completedAt) || null : null;
}

function PracticeQuestions({ record }) {
  const questions = Array.isArray(record?.practiceQuestions) ? record.practiceQuestions.slice(0, 3) : [];
  if (!questions.length) return null;
  return (
    <section aria-labelledby="vacancy-practice-title" style={{ display:'grid', gap:8 }}>
      <div>
        <div id="vacancy-practice-title" style={{ color:'var(--text)', fontWeight:800, fontSize:13 }}>3 passende Übungsfragen</div>
        <div style={{ marginTop:3, color:'var(--text-faint)', fontSize:10.5, lineHeight:1.45 }}>
          Übungsprognosen – keine bestätigten Fragen des Arbeitgebers und keine Arbeitgeber-Verbindung.
        </div>
      </div>
      <ol style={{ margin:0, paddingLeft:20, display:'grid', gap:7, color:'var(--text-dim)', fontSize:12, lineHeight:1.5 }}>
        {questions.map((question) => <li key={question.id}>{question.text}</li>)}
      </ol>
    </section>
  );
}

function ScheduleList({ record, busy, onComplete, canLive }) {
  const schedule = Array.isArray(record?.schedule) ? record.schedule : [];
  if (!schedule.length) return null;
  const omitted = schedule[0]?.omittedMilestoneIds?.length || 0;
  return (
    <section aria-labelledby="vacancy-plan-title" style={{ display:'grid', gap:8 }}>
      <div>
        <div id="vacancy-plan-title" style={{ color:'var(--text)', fontWeight:800, fontSize:13 }}>Dein Vorbereitungsplan</div>
        {omitted > 0 && (
          <div style={{ marginTop:3, color:'#fdba74', fontSize:10.5, lineHeight:1.45 }}>
            Der Termin ist nah. {omitted} reguläre Schritte wurden ehrlich ausgelassen und die wichtigsten Inhalte verdichtet.
          </div>
        )}
      </div>
      <ol style={{ listStyle:'none', margin:0, padding:0, display:'grid', gap:7 }}>
        {schedule.map((row) => {
          const complete = !!row.completedAt;
          const live = isLiveMilestone(row.id);
          return (
            <li key={row.id} style={{ display:'grid', gridTemplateColumns:'28px minmax(0,1fr) auto', gap:9, alignItems:'start', padding:'10px', borderRadius:10, border:'1px solid var(--line)', background:complete ? 'rgba(59,130,246,0.08)' : 'var(--surface-2)' }}>
              <span aria-hidden="true" style={{ width:26, height:26, display:'grid', placeItems:'center', borderRadius:'50%', background:complete ? 'var(--accent)' : 'rgba(59,130,246,0.14)', color:complete ? '#03111f' : 'var(--accent-2)', fontSize:11, fontWeight:600 }}>
                {complete ? '✓' : row.day}
              </span>
              <span style={{ minWidth:0 }}>
                <span style={{ display:'block', color:'var(--text)', fontSize:12, fontWeight:750 }}>{row.title}</span>
                <span style={{ display:'block', marginTop:2, color:'var(--text-faint)', fontSize:10.5, lineHeight:1.4 }}>{row.objective}</span>
                <span style={{ display:'block', marginTop:4, color:'var(--text-dim)', fontSize:10 }}>{formattedDate(row.scheduledDate)}</span>
              </span>
              {!complete && !live && (
                <button type="button" onClick={() => onComplete(row.id)} disabled={busy}
                  style={{ ...quietButtonStyle, minWidth:44, minHeight:44, padding:'8px 10px', fontSize:10 }}>
                  Fertig
                </button>
              )}
              {!complete && live && (
                <span style={{ color:'var(--text-faint)', fontSize:9.5, maxWidth:82, lineHeight:1.35, textAlign:'right' }}>
                  {canLive ? 'Nach echtem Interview-Debrief' : 'Mit Elite im Live-Interview'}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

const fieldStyle = {
  width:'100%', minHeight:44, boxSizing:'border-box', borderRadius:10,
  border:'1px solid var(--line-strong)', background: 'var(--surface)',
  color:'var(--text)', font:'inherit', fontSize:14, padding:'10px 12px',
};

const quietButtonStyle = {
  minHeight:44, borderRadius:10, border:'1px solid var(--line-strong)',
  background:'transparent', color:'var(--text-dim)', font:'inherit', fontWeight:700,
  fontSize:12, padding:'10px 14px', cursor:'pointer',
};

const primaryButtonStyle = {
  minHeight:46, borderRadius:10, border:'1px solid var(--accent)',
  background:'rgba(59,130,246,0.16)', color:'var(--accent-2)', font:'inherit',
  fontWeight:800, fontSize:12, letterSpacing:'0.02em', padding:'11px 16px', cursor:'pointer',
};

function Label({ children, htmlFor }) {
  return <label htmlFor={htmlFor} style={{ display:'block', marginBottom:6, color:'var(--text-dim)', fontSize:'var(--fs-meta)' }}>{children}</label>;
}

export function VacancyTargetCard({ apiUrl, token, onBeacon, onActiveChange, openRequest = 0 }) {
  const baseUrl = useMemo(() => String(apiUrl || '').replace(/\/+$/, ''), [apiUrl]);
  const [enabled, setEnabled] = useState(null);
  const [capabilities, setCapabilities] = useState(EMPTY_CAPABILITIES);
  const [draft, setDraft] = useState(null);
  const [target, setTarget] = useState(null);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState('form');
  const [mode, setMode] = useState('link');
  const [sourceUrl, setSourceUrl] = useState('');
  const [vacancyText, setVacancyText] = useState('');
  const [interviewDate, setInterviewDate] = useState('');
  const [activeDate, setActiveDate] = useState('');
  const [review, setReview] = useState(initialReview(null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => new Date());
  const dialogRef = useRef(null);
  const textareaRef = useRef(null);
  const busyRef = useRef(false);
  const activeControllerRef = useRef(null);
  const lastOpenRequestRef = useRef(openRequest);

  useEffect(() => { busyRef.current = busy; }, [busy]);

  const emit = useCallback((event) => {
    try { onBeacon?.(event); } catch { /* analytics must never affect the workflow */ }
  }, [onBeacon]);

  const request = useCallback(async (path, { method = 'GET', body, signal } = {}) => {
    const headers = { Accept:'application/json', Authorization:`Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    activeControllerRef.current?.abort();
    activeControllerRef.current = controller;
    let timedOut = false;
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once:true });
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 45_000);
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method, headers, signal:controller.signal, cache:method === 'GET' ? 'no-store' : undefined,
        body:body === undefined ? undefined : JSON.stringify(body),
      });
      const raw = await response.text();
      let payload = null;
      if (raw) {
        try { payload = JSON.parse(raw); } catch { payload = null; }
      }
      if (!response.ok) throw new VacancyRequestError(apiErrorCode(payload, `http_${response.status}`), response.status);
      return payload;
    } catch (requestError) {
      if (timedOut) throw new VacancyRequestError('request_timeout');
      throw requestError;
    } finally {
      window.clearTimeout(timeout);
      if (activeControllerRef.current === controller) activeControllerRef.current = null;
      signal?.removeEventListener('abort', abortFromCaller);
    }
  }, [baseUrl, token]);

  const applyCurrent = useCallback((payload) => {
    if (payload?.enabled !== true) {
      setEnabled(false);
      setDraft(null);
      setTarget(null);
      setOpen(false);
      setBusy(false);
      setError('');
      setNotice('');
      onActiveChange?.(false);
      return;
    }
    setEnabled(true);
    setCapabilities({ ...EMPTY_CAPABILITIES, ...(payload.capabilities || {}) });
    setDraft(payload.draft || null);
    setTarget(payload.target || null);
    onActiveChange?.(!!payload.target && !!payload.capabilities?.canLive);
  }, [onActiveChange]);

  const loadCurrent = useCallback(async (signal) => {
    const payload = await request('/api/vacancy-target', { signal });
    applyCurrent(payload);
    return payload;
  }, [applyCurrent, request]);

  const reconcileConflict = useCallback(async () => {
    try {
      const current = await loadCurrent();
      if (current?.enabled !== true) return true;
      if (current.draft) {
        setReview(initialReview(current.draft));
        setView('review');
      } else if (current.target) {
        setActiveDate(dateInputValue(detailsFrom(current.target).interviewDate));
        setView('manage');
      } else {
        setSourceUrl('');
        setVacancyText('');
        setInterviewDate('');
        setMode(current.capabilities?.linkImport ? 'link' : 'paste');
        setView('form');
      }
      return true;
    } catch {
      return false;
    }
  }, [loadCurrent]);

  const showRequestError = useCallback(async (requestError) => {
    if (requestError?.name === 'AbortError') return;
    if (requestError?.status !== 409) {
      setError(userError(requestError));
      return;
    }
    const reloaded = await reconcileConflict();
    setError(reloaded
      ? 'Die Ziel-Stelle wurde in einem anderen Fenster geändert. Der aktuelle Stand wurde neu geladen.'
      : 'Die Ziel-Stelle wurde in einem anderen Fenster geändert. Der aktuelle Stand konnte nicht geladen werden. Versuche es erneut.');
  }, [reconcileConflict]);

  useEffect(() => {
    const controller = new AbortController();
    loadCurrent(controller.signal).catch((loadError) => {
      if (loadError?.name !== 'AbortError') {
        setEnabled(null);
        onActiveChange?.(false);
      }
    });
    return () => controller.abort();
  }, [loadCurrent, onActiveChange]);

  useEffect(() => {
    if (!enabled || !target) return undefined;
    const refreshNow = () => setNow(new Date());
    const timer = window.setInterval(refreshNow, 60_000);
    document.addEventListener('visibilitychange', refreshNow);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshNow);
    };
  }, [enabled, target]);

  useEffect(() => {
    if (!open) return undefined;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    const appRoot = document.getElementById('root');
    const rootWasInert = appRoot?.inert === true;
    document.body.style.overflow = 'hidden';
    if (appRoot) appRoot.inert = true;
    const focusTimer = window.setTimeout(() => {
      const preferred = dialogRef.current?.querySelector('[data-autofocus]');
      (preferred || dialogRef.current?.querySelector(FOCUSABLE))?.focus();
    }, 0);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        activeControllerRef.current?.abort();
        setOpen(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...(dialogRef.current?.querySelectorAll(FOCUSABLE) || [])];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (appRoot && !rootWasInert) appRoot.inert = false;
      previousFocus?.focus?.();
    };
  }, [open]);

  const closeModal = useCallback(() => {
    activeControllerRef.current?.abort();
    setOpen(false);
    setError('');
    setNotice('');
  }, []);

  const openModal = () => {
    setError('');
    setNotice('');
    setMode(capabilities.linkImport ? 'link' : 'paste');
    if (draft) {
      setReview(initialReview(draft));
      setView('review');
    } else if (target) {
      setActiveDate(dateInputValue(detailsFrom(target).interviewDate));
      setView('manage');
    } else {
      setSourceUrl('');
      setVacancyText('');
      setInterviewDate('');
      setView('form');
    }
    setOpen(true);
    emit('vacancy_target_opened');
  };

  useEffect(() => {
    if (!openRequest || openRequest === lastOpenRequestRef.current || enabled !== true) return;
    lastOpenRequestRef.current = openRequest;
    openModal();
    // openModal intentionally reflects current draft/target state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequest, enabled]);

  const createDraft = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    let body;
    if (mode === 'link') {
      const url = validSourceUrl(sourceUrl);
      if (!url) { setError(userError(new VacancyRequestError('invalid_url'))); return; }
      body = { sourceUrl: url };
    } else {
      const text = vacancyText.trim();
      if (!text) { setError(userError(new VacancyRequestError('vacancy_text_required'))); return; }
      body = { vacancyText: text };
    }
    if (interviewDate) body.interviewDate = interviewDate;

    setBusy(true);
    try {
      const payload = await request('/api/vacancy-target/draft', { method:'POST', body });
      let nextDraft = recordFrom(payload, 'draft');
      if (!nextDraft) {
        const current = await loadCurrent();
        nextDraft = current?.draft || null;
      }
      if (!nextDraft) throw new VacancyRequestError('invalid_response');
      setDraft(nextDraft);
      setReview(initialReview(nextDraft, interviewDate));
      setView('review');
      emit(mode === 'link' ? 'vacancy_import_link_ok' : 'vacancy_import_paste_ok');
      emit('vacancy_preview_shown');
    } catch (requestError) {
      if (requestError?.code === 'paste_required') {
        emit('vacancy_import_paste_required');
        setMode('paste');
        window.setTimeout(() => textareaRef.current?.focus(), 0);
      }
      else emit('vacancy_import_failed');
      await showRequestError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const confirmDraft = async () => {
    if (!review.roleTitle.trim()) { setError(userError(new VacancyRequestError('role_required'))); return; }
    if (!review.industryKey) { setError(userError(new VacancyRequestError('industry_required'))); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const body = confirmationFrom(draft, review);
      const payload = await request('/api/vacancy-target/active', { method:'PUT', body });
      const activated = recordFrom(payload, 'target') || { ...(draft || {}), ...body };
      setTarget(activated);
      setDraft(null);
      onActiveChange?.(!!capabilities.canLive);
      setOpen(false);
      emit('vacancy_target_confirmed');
    } catch (requestError) {
      await showRequestError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const saveDate = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await request('/api/vacancy-target/active', {
        method:'PATCH', body:{ interviewDate: activeDate || null },
      });
      const updated = recordFrom(payload, 'target') || { ...(target || {}), interviewDate: activeDate || null };
      setTarget(updated);
      onActiveChange?.(!!capabilities.canLive);
      setNotice('Interviewdatum gespeichert.');
    } catch (requestError) {
      await showRequestError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const completeMilestone = async (milestoneId) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = await request('/api/vacancy-target/active', {
        method:'PATCH', body:{ completeMilestoneId:milestoneId },
      });
      const updated = recordFrom(payload, 'target');
      if (!updated) throw new VacancyRequestError('invalid_response');
      setTarget(updated);
      if (milestoneId === 'day_1_foundation' || milestoneId === 'emergency_intro') emit('vacancy_day1_completed');
      setNotice('Schritt als erledigt gespeichert.');
    } catch (requestError) {
      await showRequestError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const removeTarget = async () => {
    const confirmed = window.confirm('Ziel-Stelle entfernen? Dein bisheriger Trainingsfortschritt bleibt erhalten.');
    if (!confirmed) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/vacancy-target/active', { method:'DELETE' });
      setTarget(null);
      onActiveChange?.(false);
      setOpen(false);
      emit('vacancy_target_removed');
    } catch (requestError) {
      await showRequestError(requestError);
    } finally {
      setBusy(false);
    }
  };

  const replaceTarget = () => {
    setSourceUrl('');
    setVacancyText('');
    setInterviewDate(dateInputValue(detailsFrom(target).interviewDate));
    setMode(capabilities.linkImport ? 'link' : 'paste');
    setError('');
    setNotice('');
    setView('form');
  };

  if (enabled !== true) return null;

  const targetDetails = detailsFrom(target);
  const countdown = countdownFor(targetDetails.interviewDate, now);
  const due = nextMilestone(target);
  const dateChanged = activeDate !== dateInputValue(targetDetails.interviewDate);
  const industryOptions = review.industryKey && !INDUSTRY_LABELS.has(review.industryKey)
    ? [[review.industryKey, review.industryKey], ...INDUSTRIES]
    : INDUSTRIES;

  return (
    <>
      <section aria-label="Private Ziel-Stelle" style={{
        marginTop:10, padding:'13px 14px', borderRadius:14,
        border:'1px solid rgba(59,130,246,0.28)', background:'rgba(59,130,246,0.07)',
      }}>
        {!target ? (
          <div style={{ display:'grid', gap:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ color:'var(--accent-2)', fontFamily:'var(--font-display)', fontWeight:800, fontSize:11, letterSpacing:'0.08em' }}>
                  DEINE ZIEL-STELLE
                </div>
                <div style={{ marginTop:4, color:'var(--text)', fontSize:'var(--fs-label)', lineHeight:1.45 }}>
                  Übe mit Fragen aus einer echten Stellenanzeige.
                </div>
              </div>
              <button type="button" onClick={openModal} style={{ ...primaryButtonStyle, minHeight:40, flex:'0 0 auto', padding:'8px 12px' }}>
                {draft ? 'Entwurf prüfen' : 'Stelle hinzufügen'}
              </button>
            </div>
            <TierPromise capabilities={capabilities} />
            <div style={{ color:'var(--text-faint)', fontSize:10, lineHeight:1.4 }}>
              Privat. Wir senden keine Bewerbung und kontaktieren keinen Arbeitgeber.
            </div>
          </div>
        ) : (
          <div style={{ display:'grid', gap:10 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
              <div style={{ minWidth:0 }}>
                <div style={{ color:'var(--accent-2)', fontFamily:'var(--font-display)', fontWeight:800, fontSize:10, letterSpacing:'0.08em' }}>
                  PRIVATE ZIEL-STELLE
                </div>
                <div style={{ marginTop:4, color:'var(--text)', fontFamily:'var(--font-display)', fontWeight:750, fontSize:'var(--fs-label)', lineHeight:1.35, overflowWrap:'anywhere' }}>
                  {targetDetails.roleTitle || 'Ziel-Stelle'}
                </div>
                {targetDetails.employerDisplay && (
                  <div style={{ marginTop:2, color:'var(--text-dim)', fontSize:'var(--fs-meta)', overflowWrap:'anywhere' }}>
                    {targetDetails.employerDisplay}{targetDetails.industryLabel ? ` · ${targetDetails.industryLabel}` : ''}
                  </div>
                )}
              </div>
              <button type="button" onClick={openModal} style={{ ...quietButtonStyle, minHeight:38, padding:'7px 11px', flex:'0 0 auto' }}>
                {draft ? 'Entwurf prüfen' : 'Verwalten'}
              </button>
            </div>
            <div aria-live="polite" style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10, paddingTop:9, borderTop:'1px solid var(--line)' }}>
              <span style={{ color:'var(--text)', fontWeight:800, fontSize:13 }}>{countdown.headline}</span>
              <span style={{ color:'var(--text-faint)', fontSize:10, textAlign:'right' }}>{countdown.detail}</span>
            </div>
            {due && (
              <div style={{ padding:'9px 10px', borderRadius:10, background: 'var(--surface)', border:'1px solid var(--line)' }}>
                <div style={{ color:'var(--text-faint)', fontSize:9.5, letterSpacing:'0.06em' }}>NÄCHSTER SCHRITT</div>
                <div style={{ marginTop:3, color:'var(--text)', fontSize:12, fontWeight:750 }}>{due.title}</div>
              </div>
            )}
            <TierPromise capabilities={capabilities} />
          </div>
        )}
      </section>

      {open && createPortal((
        <div role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal(); }} style={{
          position:'fixed', inset:0, zIndex:420, display:'flex', alignItems:'center', justifyContent:'center',
          padding:'max(12px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom))',
          background: 'var(--surface)', backdropFilter:'blur(6px)',
          isolation:'isolate', overscrollBehavior:'contain', touchAction:'pan-y',
        }}>
          <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="vacancy-target-title" aria-describedby="vacancy-target-privacy" aria-busy={busy} style={{
            width:'min(100%, 500px)', maxHeight:'min(780px, 94svh)', overflowY:'auto', boxSizing:'border-box',
            borderRadius:18, border:'1px solid var(--line-strong)', background:'var(--bg-1)',
            boxShadow:'0 24px 80px rgba(14,19,32,0.16)', padding:'18px 16px',
          }}>
            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:15 }}>
              <div>
                <div id="vacancy-target-title" style={{ color:'var(--text)', fontFamily:'var(--font-display)', fontWeight:850, fontSize:17 }}>
                  {view === 'form' ? 'Ziel-Stelle einrichten' : view === 'review' ? 'Angaben prüfen' : 'Deine Ziel-Stelle'}
                </div>
                <div id="vacancy-target-privacy" style={{ color:'var(--text-faint)', fontSize:11, lineHeight:1.45, marginTop:4 }}>
                  Nur in deinem Konto sichtbar.
                </div>
              </div>
              <button type="button" onClick={closeModal} aria-label={busy ? 'Vorgang abbrechen und schließen' : 'Schließen'} style={{
                width:44, height:44, flex:'0 0 auto', borderRadius:'50%', border:'1px solid var(--line)',
                background:'transparent', color:'var(--text-dim)', fontSize:22, cursor:'pointer',
              }}>×</button>
            </div>

            {error && (
              <div role="alert" style={{ marginBottom:12, padding:'10px 12px', borderRadius:10, border:'1px solid rgba(248,113,113,0.35)', background:'rgba(248,113,113,0.08)', color:'#fca5a5', fontSize:12, lineHeight:1.5 }}>
                {error}
              </div>
            )}
            {notice && (
              <div role="status" style={{ marginBottom:12, padding:'10px 12px', borderRadius:10, border:'1px solid rgba(59,130,246,0.28)', background:'rgba(59,130,246,0.08)', color:'var(--accent-2)', fontSize:12 }}>
                {notice}
              </div>
            )}

            {view === 'form' && (
              <form onSubmit={createDraft} style={{ display:'grid', gap:14 }}>
                {mode === 'link' ? (
                  <div>
                    <Label htmlFor="vacancy-source-url">Link zur Stellenanzeige</Label>
                    <input id="vacancy-source-url" data-autofocus type="url" inputMode="url" autoComplete="url"
                      value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} disabled={busy}
                      placeholder="https://…" style={fieldStyle} />
                    <button type="button" onClick={() => { setMode('paste'); setError(''); window.setTimeout(() => textareaRef.current?.focus(), 0); }} disabled={busy}
                      style={{ border:0, background:'transparent', color:'var(--accent-2)', padding:'8px 0 0', font:'inherit', fontSize:11, cursor:'pointer' }}>
                      Link nicht lesbar? Anzeigentext einfügen
                    </button>
                  </div>
                ) : (
                  <div>
                    <Label htmlFor="vacancy-text">Text der Stellenanzeige</Label>
                    <textarea id="vacancy-text" ref={textareaRef} data-autofocus={!capabilities.linkImport || undefined}
                      value={vacancyText} onChange={(event) => setVacancyText(event.target.value)} disabled={busy}
                      placeholder="Aufgaben, Anforderungen und Beschreibung hier einfügen …"
                      rows={8} style={{ ...fieldStyle, minHeight:150, resize:'vertical', lineHeight:1.5 }} />
                    {capabilities.linkImport ? (
                      <button type="button" onClick={() => { setMode('link'); setError(''); }} disabled={busy}
                        style={{ border:0, background:'transparent', color:'var(--accent-2)', padding:'8px 0 0', font:'inherit', fontSize:11, cursor:'pointer' }}>
                        Zurück zum Link
                      </button>
                    ) : (
                      <div style={{ color:'var(--text-faint)', paddingTop:7, fontSize:10, lineHeight:1.4 }}>
                        Der direkte Linkimport ist für dein Konto momentan nicht verfügbar.
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <Label htmlFor="vacancy-interview-date">Interviewdatum <span style={{ color:'var(--text-faint)' }}>(optional)</span></Label>
                  <input id="vacancy-interview-date" type="date" value={interviewDate}
                    onChange={(event) => setInterviewDate(event.target.value)} disabled={busy} style={fieldStyle} />
                </div>

                <div style={{ padding:'10px 12px', borderRadius:10, background:'var(--surface-2)', color:'var(--text-faint)', fontSize:10.5, lineHeight:1.5 }}>
                  Wir analysieren nur die Anzeige für dein Training. Wir bewerben dich nicht, kontaktieren den Arbeitgeber nicht und versprechen keine Einstellung.
                </div>
                <button type="submit" disabled={busy} style={{ ...primaryButtonStyle, width:'100%', opacity:busy ? 0.65 : 1, cursor:busy ? 'wait' : 'pointer' }}>
                  {busy ? 'Anzeige wird geprüft …' : 'Anzeige prüfen'}
                </button>
              </form>
            )}

            {view === 'review' && (
              <div style={{ display:'grid', gap:13 }}>
                <div style={{ color:'var(--text-dim)', fontSize:11.5, lineHeight:1.5 }}>
                  KI-Zusammenfassung: Korrigiere Fehler, bevor die Stelle dein Training steuert.
                </div>
                <div>
                  <Label htmlFor="vacancy-review-role">Stelle</Label>
                  <input id="vacancy-review-role" data-autofocus value={review.roleTitle} disabled={busy}
                    onChange={(event) => setReview((current) => ({ ...current, roleTitle:event.target.value }))} style={fieldStyle} />
                </div>
                <div>
                  <Label htmlFor="vacancy-review-employer">Arbeitgeber <span style={{ color:'var(--text-faint)' }}>(nur privat sichtbar)</span></Label>
                  <input id="vacancy-review-employer" value={review.employerDisplay} disabled={busy}
                    onChange={(event) => setReview((current) => ({ ...current, employerDisplay:event.target.value }))} style={fieldStyle} />
                </div>
                <div>
                  <Label htmlFor="vacancy-review-industry">Branche</Label>
                  <select id="vacancy-review-industry" value={review.industryKey} disabled={busy}
                    onChange={(event) => setReview((current) => ({ ...current, industryKey:event.target.value }))} style={fieldStyle}>
                    <option value="" disabled>Branche wählen</option>
                    {industryOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="vacancy-review-role-type">Rollenart</Label>
                  <select id="vacancy-review-role-type" value={review.roleType} disabled={busy}
                    onChange={(event) => setReview((current) => ({ ...current, roleType:event.target.value }))} style={fieldStyle}>
                    {ROLE_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="vacancy-review-german">Deutschniveau der Stelle</Label>
                  <select id="vacancy-review-german" value={review.germanLevel} disabled={busy}
                    onChange={(event) => setReview((current) => ({ ...current, germanLevel:event.target.value }))} style={fieldStyle}>
                    {GERMAN_LEVELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </div>
                <div>
                  <Label htmlFor="vacancy-review-date">Interviewdatum <span style={{ color:'var(--text-faint)' }}>(optional)</span></Label>
                  <input id="vacancy-review-date" type="date" value={review.interviewDate} disabled={busy}
                    onChange={(event) => setReview((current) => ({ ...current, interviewDate:event.target.value }))} style={fieldStyle} />
                </div>
                <TierPromise capabilities={capabilities} />
                <div style={{ display:'grid', gap:8 }}>
                  <button type="button" onClick={confirmDraft} disabled={busy} style={{ ...primaryButtonStyle, width:'100%', opacity:busy ? 0.65 : 1, cursor:busy ? 'wait' : 'pointer' }}>
                    {busy ? 'Wird bestätigt …' : 'Als Ziel-Stelle bestätigen'}
                  </button>
                  {target && (
                    <button type="button" onClick={() => {
                      setActiveDate(dateInputValue(detailsFrom(target).interviewDate));
                      setError('');
                      setView('manage');
                    }} disabled={busy} style={{ ...quietButtonStyle, width:'100%' }}>
                      Aktive Stelle verwalten
                    </button>
                  )}
                  <button type="button" onClick={() => { setError(''); setView('form'); }} disabled={busy} style={{ ...quietButtonStyle, width:'100%' }}>
                    Andere Anzeige verwenden
                  </button>
                </div>
                <div style={{ color:'var(--text-faint)', fontSize:10, lineHeight:1.45 }}>
                  Die Fragen und der Plan sind Trainingshilfen. Sie bilden keine echte Auswahlentscheidung des Arbeitgebers ab.
                </div>
              </div>
            )}

            {view === 'manage' && target && (
              <div style={{ display:'grid', gap:14 }}>
                <ReadonlyDetails record={target} />
                <PracticeQuestions record={target} />
                <ScheduleList record={target} busy={busy} onComplete={completeMilestone} canLive={capabilities.canLive} />
                <TierPromise capabilities={capabilities} />
                <div>
                  <Label htmlFor="vacancy-active-date">Interviewdatum <span style={{ color:'var(--text-faint)' }}>(optional)</span></Label>
                  <input id="vacancy-active-date" data-autofocus type="date" value={activeDate} disabled={busy}
                    onChange={(event) => { setActiveDate(event.target.value); setNotice(''); }} style={fieldStyle} />
                  <button type="button" onClick={saveDate} disabled={busy || !dateChanged}
                    style={{ ...primaryButtonStyle, width:'100%', marginTop:8, opacity:(busy || !dateChanged) ? 0.45 : 1, cursor:(busy || !dateChanged) ? 'default' : 'pointer' }}>
                    {busy ? 'Wird gespeichert …' : 'Datum speichern'}
                  </button>
                </div>
                {draft ? (
                  <button type="button" onClick={() => { setReview(initialReview(draft)); setError(''); setView('review'); }}
                    disabled={busy} style={{ ...quietButtonStyle, width:'100%' }}>
                    Entwurf weiter prüfen
                  </button>
                ) : (
                  <button type="button" onClick={replaceTarget} disabled={busy} style={{ ...quietButtonStyle, width:'100%' }}>
                    Andere Stellenanzeige verwenden
                  </button>
                )}
                <button type="button" onClick={removeTarget} disabled={busy} style={{
                  minHeight:40, border:0, background:'transparent', color:'#fca5a5', font:'inherit', fontSize:11, cursor:busy ? 'wait' : 'pointer',
                }}>
                  Ziel-Stelle entfernen
                </button>
                <div style={{ color:'var(--text-faint)', fontSize:10, lineHeight:1.45 }}>
                  Privat. Keine Bewerbung wird gesendet; der Arbeitgeber wird nicht kontaktiert. Dein bisheriger Trainingsfortschritt bleibt bei Änderungen erhalten.
                </div>
              </div>
            )}
          </div>
        </div>
      ), document.body)}
    </>
  );
}

export default VacancyTargetCard;
