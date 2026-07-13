/**
 * Mission Control v1 API. This router never submits an application, contacts a
 * recruiter, connects a mailbox, or stores raw CV/vacancy/recruiter text.
 */
import express from 'express';
import { requireAuth, rateLimit } from './auth.js';
import { mutateUser } from './store.js';
import { importVacancyFromUrl, VacancyImportError } from './vacancyImport.js';
import {
  VacancyTargetError,
  analyzeVacancyDeterministically,
  deriveVacancyQuestionTopicIds,
  deriveVacancySkillIds,
  prepareImportedVacancy,
  preparePastedVacancy,
} from './vacancyTargetCore.js';
import {
  MissionControlError,
  MISSION_CONTROL_MAX_RECORDS,
  OPPORTUNITY_DUPLICATE_WINDOW_MS,
  OPPORTUNITY_STATUSES,
  advanceRadarStatuses,
  approveApplicationPack,
  assertExactObject,
  attachEncryptedMissionControl,
  buildApplicationPack,
  buildInterviewPassPreview,
  buildOpportunity,
  canonicalJson,
  candidateReadinessEvidence,
  claimInterviewPass,
  classifyResponseText,
  consumeFreeFitPreview,
  findOpportunity,
  findRecentDuplicate,
  getIdempotencyRecord,
  jobRadar,
  markApplicationSubmitted,
  missionControlView,
  normalizeConfirmInterview,
  normalizeInterviewPassPreviewRequest,
  normalizeMissionControlState,
  normalizeOfficialApplyUrl,
  normalizePassportInput,
  publicApplicationPack,
  publicInterviewPass,
  publicOpportunity,
  readEncryptedMissionControl,
  recordInterviewConfirmation,
  recordOpportunityOutcome,
  recordResponseClassification,
  refreshOpportunityReadiness,
  safeText,
  setActiveVacancyBridge,
  sha256,
  storeIdempotencyRecord,
  verifyInterviewPassToken,
} from './missionControlCore.js';
import { governedMissionControlFlagsFor } from './missionControlGovernance.js';

function asNow(value) {
  const now = typeof value === 'function' ? Number(value()) : Number(value);
  return Number.isFinite(now) && now > 0 ? now : Date.now();
}

function validateIdempotencyKey(value) {
  if (value === undefined || value === null || value === '') {
    throw new MissionControlError('idempotency_key_required', 400);
  }
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/u.test(value)) {
    throw new MissionControlError('invalid_idempotency_key');
  }
  return value;
}

function parseMutationBody(body, allowedKeys, operation, resourceId = null) {
  assertExactObject(body || {}, [...allowedKeys, 'idempotencyKey']);
  const idempotencyKey = validateIdempotencyKey(body?.idempotencyKey);
  const payload = { ...(body || {}) };
  delete payload.idempotencyKey;
  return {
    idempotencyKey,
    payload,
    payloadHash:sha256(canonicalJson({ operation, resourceId, payload })),
  };
}

function replayMutation(state, request, operation) {
  return getIdempotencyRecord(state, request.idempotencyKey, operation, request.payloadHash);
}

function rememberMutation(state, request, operation, responseStatus, responseValue, now) {
  return storeIdempotencyRecord(state, {
    key:request.idempotencyKey,
    operation,
    payloadHash:request.payloadHash,
    responseStatus,
    responseValue,
    createdAt:now,
  }).state;
}

function mutationResult(record) {
  return { replayed:true, status:record.responseStatus, body:record.responseValue };
}

function fullPassportFor(flags) {
  return flags?.fullPassport === true;
}

function enforcePassportEntitlement(passport, flags) {
  if (fullPassportFor(flags)) return passport;
  if (passport.roleTypes.length > 1 || passport.industryKeys.length > 1
    || passport.shiftPreferences.length > 1 || passport.skillIds.length > 2
    || passport.locationEligibilities.length > 1
    || passport.facts.length > 1 || passport.salaryFloorEGP !== null) {
    throw new MissionControlError('upgrade_required', 403);
  }
  return passport;
}

function publicPassportForFlags(passport, flags) {
  if (!passport || fullPassportFor(flags)) return passport || null;
  return {
    ...passport,
    roleTypes:passport.roleTypes.slice(0, 1),
    industryKeys:passport.industryKeys.slice(0, 1),
    locationEligibilities:passport.locationEligibilities.slice(0, 1),
    shiftPreferences:passport.shiftPreferences.slice(0, 1),
    salaryFloorEGP:null,
    skillIds:passport.skillIds.slice(0, 2),
    facts:passport.facts.slice(0, 1),
  };
}

function assertTrackingCapacity(state, flags) {
  const limit = Math.max(0, Number(flags?.canTrackApplications) || 0);
  if (state.opportunities.length >= limit) throw new MissionControlError('application_limit', 403);
}

function errorResponse(res, error, operation) {
  if (error instanceof VacancyImportError) {
    const reason = error.reason === 'unsafe_source' ? 'unsafe_source'
      : error.reason === 'unsupported_source' ? 'unsupported_source' : 'paste_required';
    return res.status(422).json({ error:'paste_required', reason });
  }
  if (error instanceof MissionControlError) {
    return res.status(error.status || 400).json({ error:error.code });
  }
  if (error instanceof VacancyTargetError) {
    return res.status(error.status || 400).json({ error:error.code });
  }
  // Never print exception messages: network errors can contain private source URLs.
  console.error(`[mission-control] ${operation} failed type=${String(error?.name || 'Error').slice(0, 40)}`);
  return res.status(500).json({ error:'mission_control_failed' });
}

function statusFlags(account, dependencies) {
  return governedMissionControlFlagsFor(account, {
    env:dependencies.env,
    now:asNow(dependencies.now),
  });
}

function requireInterviewAction(dependencies) {
  return (req, res, next) => {
    const flags = statusFlags(req.account || null, dependencies);
    if (flags.paused) return res.status(503).json({ error:'feature_paused' });
    if (!flags.interviewPassEnabled) return res.status(404).json({ error:'feature_disabled' });
    req.missionFlags = flags;
    next();
  };
}

function requireCopilotAction(dependencies) {
  return (req, res, next) => {
    const flags = statusFlags(req.account, dependencies);
    if (flags.paused) return res.status(503).json({ error:'feature_paused' });
    if (!flags.copilotEnabled) return res.status(404).json({ error:'feature_disabled' });
    req.missionFlags = flags;
    next();
  };
}

function requireCopilotRead(dependencies) {
  return (req, res, next) => {
    const flags = statusFlags(req.account, dependencies);
    if (flags.paused) return res.status(503).json({ error:'feature_paused' });
    if (!flags.copilotEnabled) return res.status(404).json({ error:'feature_disabled' });
    req.missionFlags = flags;
    next();
  };
}

function privacyOptions(dependencies) {
  return { env:dependencies.env, ...(dependencies.encryptionKey ? { key:dependencies.encryptionKey } : {}) };
}

function readState(profile, dependencies) {
  return readEncryptedMissionControl(profile, privacyOptions(dependencies));
}

function writeState(profile, state, dependencies) {
  attachEncryptedMissionControl(profile, state, privacyOptions(dependencies));
}

function importedPostingIsOpen(imported, now) {
  if (imported?.openState === 'closed') return false;
  if (imported?.validThrough !== undefined && imported?.validThrough !== null) {
    const expiresAt = Date.parse(String(imported.validThrough));
    if (!Number.isFinite(expiresAt) || expiresAt < now) return false;
  }
  return true;
}

async function verifyOpportunityStillOpen(opportunity, dependencies) {
  if (!opportunity?.officialApplyUrl || opportunity.openState !== 'open') {
    throw new MissionControlError('posting_unverified', 409);
  }
  let imported;
  try { imported = await dependencies.importVacancy(opportunity.officialApplyUrl); }
  catch { throw new MissionControlError('opportunity_unavailable', 409); }
  if (!importedPostingIsOpen(imported, asNow(dependencies.now))) {
    throw new MissionControlError('opportunity_closed', 409);
  }
  const fresh = prepareImportedVacancy(imported);
  if (fresh.sourceHash !== opportunity.sourceHash) {
    throw new MissionControlError('opportunity_changed', 409);
  }
  return {
    officialApplyUrl:normalizeOfficialApplyUrl(opportunity.officialApplyUrl),
    sourceHash:fresh.sourceHash,
    openState:'open',
  };
}

function parseImportRequest(body) {
  assertExactObject(body, ['sourceUrl', 'vacancyText', 'officialApplyUrl']);
  const hasUrl = Object.hasOwn(body, 'sourceUrl');
  const hasText = Object.hasOwn(body, 'vacancyText');
  if (hasUrl === hasText) throw new MissionControlError('invalid_source');
  const value = hasUrl ? body.sourceUrl : body.vacancyText;
  if (typeof value !== 'string' || !value.trim()) throw new MissionControlError('invalid_source');
  if (hasUrl && Object.hasOwn(body, 'officialApplyUrl')) throw new MissionControlError('invalid_source');
  const officialApplyUrl = hasText && body.officialApplyUrl
    ? normalizeOfficialApplyUrl(body.officialApplyUrl) : null;
  return { kind:hasUrl ? 'url' : 'paste', value, officialApplyUrl };
}

function statusFilter(value) {
  if (value === undefined || value === '') return null;
  const status = safeText(value, 40);
  if (!OPPORTUNITY_STATUSES.includes(status)) throw new MissionControlError('invalid_status');
  return status;
}

const EXPLICIT_ROLE_REQUIREMENTS = Object.freeze({
  customer_service:['Kunden professionell betreuen', 'Beschwerden ruhig deeskalieren', 'Informationen genau dokumentieren'],
  technical_support:['Technische Anliegen strukturiert eingrenzen', 'Lösungen klar erklären', 'Tickets genau dokumentieren'],
  sales:['Bedarf gezielt ermitteln', 'Einwände professionell behandeln', 'Gespräche verbindlich abschließen'],
  retention:['Kündigungsgründe aktiv erfragen', 'Passende Lösungen anbieten', 'Einwände ruhig behandeln'],
  backoffice:['Daten sorgfältig erfassen', 'Vorgänge nachvollziehbar dokumentieren', 'Fristen zuverlässig einhalten'],
});

/** Prefer an unambiguous vacancy heading over incidental duties deeper in the ad. */
function missionOpportunityAnalysis(source) {
  const analysis = analyzeVacancyDeterministically(source);
  const heading = safeText(source?.titleHint || String(source?.text || '').split(/\r?\n/u)[0], 120).toLocaleLowerCase('de');
  const matches = [
    ['technical_support', /\b(?:technical support|technischer support|helpdesk|it support)\b/iu],
    ['retention', /\b(?:retention|kundenrückgewinnung|customer retention)\b/iu],
    ['sales', /\b(?:sales|vertrieb|verkauf|telesales)\b/iu],
    ['backoffice', /\b(?:backoffice|back office|sachbearbeitung|data entry)\b/iu],
    ['customer_service', /\b(?:customer service|customer support|kundenservice|kundendienst|customer care)\b/iu],
  ].filter(([, pattern]) => pattern.test(heading)).map(([roleType]) => roleType);
  if (matches.length !== 1 || matches[0] === analysis.roleType) return analysis;
  const roleType = matches[0];
  return {
    ...analysis,
    roleType,
    skillIds:deriveVacancySkillIds(roleType),
    questionTopicIds:deriveVacancyQuestionTopicIds(roleType),
    displayRequirements:[...EXPLICIT_ROLE_REQUIREMENTS[roleType]],
  };
}

export function createMissionControlRouter(overrides = {}) {
  const dependencies = {
    env:overrides.env || process.env,
    now:overrides.now || Date.now,
    importVacancy:overrides.importVacancy || importVacancyFromUrl,
    encryptionKey:overrides.encryptionKey || null,
  };
  const router = express.Router();
  const interviewAction = requireInterviewAction(dependencies);
  const copilotAction = requireCopilotAction(dependencies);
  const copilotRead = requireCopilotRead(dependencies);

  // Public pre-signup probe: no user data and unknown/beta-only configuration stays absent.
  router.get('/interview-pass/preview',
    rateLimit({ windowMs:60 * 1000, max:120, tag:'interview-pass-probe' }),
    (req, res) => {
      const flags = statusFlags(null, dependencies);
      res.set('Cache-Control', 'public, max-age=60');
      return res.json({ enabled:flags.interviewPassEnabled === true });
    });

  router.post('/interview-pass/preview',
    rateLimit({ windowMs:60 * 60 * 1000, max:60, tag:'interview-pass-preview-global', global:true }),
    rateLimit({ windowMs:60 * 60 * 1000, max:12, tag:'interview-pass-preview-ip' }),
    interviewAction,
    (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = normalizeInterviewPassPreviewRequest(req.body);
        const preview = buildInterviewPassPreview(request, {
          ...privacyOptions(dependencies), now:asNow(dependencies.now),
        });
        return res.json(preview);
      } catch (error) { return errorResponse(res, error, 'preview'); }
    });

  router.post('/interview-pass/claim', requireAuth, interviewAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:12, tag:'interview-pass-claim-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(req.body, ['previewToken'], 'interview_pass_claim');
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'interview_pass_claim');
          if (replay) return { save:false, value:{
            ...mutationResult(replay),
            body:{ ...replay.responseValue,
              pass:publicInterviewPass(state.interviewPass, req.missionFlags) },
          } };
          const payload = verifyInterviewPassToken(request.payload.previewToken, {
            ...privacyOptions(dependencies), now,
          });
          if (state.claimedPreviewIds.includes(payload.previewId)
            && state.interviewPass?.previewId !== payload.previewId) {
            throw new MissionControlError('preview_token_used', 409);
          }
          const claimed = claimInterviewPass(state, payload, req.missionFlags, now);
          const body = { pass:publicInterviewPass(claimed.pass, req.missionFlags), created:claimed.created };
          const status = claimed.created ? 201 : 200;
          state = rememberMutation(claimed.state, request, 'interview_pass_claim', status, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'claim'); }
    });

  router.get('/candidate-passport', requireAuth, copilotRead, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const result = await mutateUser(req.account.id, async (profile) => {
        const before = readState(profile, dependencies);
        const state = refreshOpportunityReadiness(
          before, before.passport, asNow(dependencies.now),
          candidateReadinessEvidence(profile, req.account, asNow(dependencies.now)),
        );
        const view = missionControlView(state, req.missionFlags, asNow(dependencies.now));
        return { save:false, value:{ enabled:true, passport:publicPassportForFlags(view.passport, req.missionFlags),
          interviewPass:view.interviewPass, capabilities:view.capabilities } };
      });
      return res.json(result);
    } catch (error) { return errorResponse(res, error, 'passport-get'); }
  });

  router.put('/candidate-passport', requireAuth, copilotAction,
    rateLimit({ windowMs:10 * 60 * 1000, max:20, tag:'passport-write-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const now = asNow(dependencies.now);
        const request = parseMutationBody(req.body, [
          'roleTypes', 'industryKeys', 'germanLevel', 'locationMode', 'shiftPreferences',
          'availabilityDate', 'experienceBand', 'salaryFloorEGP', 'workAuthorization',
          'locationEligibilities', 'skillIds', 'facts', 'consentVersion',
        ], 'candidate_passport_put');
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'candidate_passport_put');
          if (replay) return { save:false, value:{
            ...mutationResult(replay),
            body:{ passport:publicPassportForFlags(state.passport, req.missionFlags) },
          } };
          const passport = enforcePassportEntitlement(
            normalizePassportInput(request.payload, now), req.missionFlags,
          );
          const comparable = { ...passport }; delete comparable.updatedAt;
          const previous = state.passport ? { ...state.passport } : null;
          if (previous) delete previous.updatedAt;
          let body;
          if (previous && JSON.stringify(previous) === JSON.stringify(comparable)) {
            body = { passport:publicPassportForFlags(
              missionControlView(state, req.missionFlags, now).passport, req.missionFlags,
            ) };
          } else {
            state.passport = passport;
            state = refreshOpportunityReadiness(
              state, passport, now, candidateReadinessEvidence(profile, req.account, now),
            );
            body = { passport:publicPassportForFlags(
              missionControlView(state, req.missionFlags, now).passport, req.missionFlags,
            ) };
          }
          state = rememberMutation(state, request, 'candidate_passport_put', 200, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'passport-put'); }
    });

  router.get('/job-radar/today', requireAuth, copilotRead, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = asNow(dependencies.now);
      const result = await mutateUser(req.account.id, async (profile) => {
        let state = readState(profile, dependencies);
        state = refreshOpportunityReadiness(
          state, state.passport, now, candidateReadinessEvidence(profile, req.account, now),
        );
        const radar = jobRadar(state, req.missionFlags, now);
        const advanced = advanceRadarStatuses(state, radar.map((item) => item.id), now);
        state = advanced.state;
        const refreshed = jobRadar(state, req.missionFlags, now);
        return { save:false, value:{ opportunities:refreshed } };
      });
      return res.json(result);
    } catch (error) { return errorResponse(res, error, 'radar'); }
  });

  router.post('/opportunities/import', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:40, tag:'opportunity-import-ip' }),
    rateLimit({ windowMs:60 * 60 * 1000, max:10, tag:'opportunity-import-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const mutation = parseMutationBody(
          req.body, ['sourceUrl', 'vacancyText', 'officialApplyUrl'], 'opportunity_import',
        );
        const request = parseImportRequest(mutation.payload);
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, mutation, 'opportunity_import');
          if (replay) return { save:false, value:mutationResult(replay) };
          let source;
          let imported = null;
          if (request.kind === 'paste') {
            source = { ...preparePastedVacancy(request.value), officialApplyUrl:request.officialApplyUrl };
            const duplicate = findRecentDuplicate(state, source.sourceHash, now);
            if (duplicate) {
              const body = { ...publicOpportunity(duplicate, state), duplicate:true };
              state = rememberMutation(state, mutation, 'opportunity_import', 200, body, now);
              writeState(profile, state, dependencies);
              return { value:{ replayed:false, status:200, body } };
            }
          } else {
            const officialApplyUrl = normalizeOfficialApplyUrl(request.value);
            const cachedByDestination = state.opportunities.find((item) => item.officialApplyUrl === officialApplyUrl
              && now - item.importedAt <= OPPORTUNITY_DUPLICATE_WINDOW_MS);
            if (cachedByDestination) {
              const body = { ...publicOpportunity(cachedByDestination, state), duplicate:true };
              state = rememberMutation(state, mutation, 'opportunity_import', 200, body, now);
              writeState(profile, state, dependencies);
              return { value:{ replayed:false, status:200, body } };
            }
            assertTrackingCapacity(state, req.missionFlags);
            // Free quota is checked before the network fetch; paid accounts retain bounded route limits.
            if (!req.missionFlags.fullPassport) consumeFreeFitPreview(state, req.missionFlags, now);
            imported = await dependencies.importVacancy(request.value);
            if (!importedPostingIsOpen(imported, now)) {
              throw new MissionControlError('opportunity_closed', 409);
            }
            source = { ...prepareImportedVacancy(imported), officialApplyUrl };
            const duplicate = findRecentDuplicate(state, source.sourceHash, now);
            if (duplicate) {
              const body = { ...publicOpportunity(duplicate, state), duplicate:true };
              state = rememberMutation(state, mutation, 'opportunity_import', 200, body, now);
              writeState(profile, state, dependencies);
              return { value:{ replayed:false, status:200, body } };
            }
          }
          assertTrackingCapacity(state, req.missionFlags);
          if (!req.missionFlags.fullPassport) state = consumeFreeFitPreview(state, req.missionFlags, now);
          const analysis = missionOpportunityAnalysis(source);
          if (imported?.employer) analysis.employerDisplay = safeText(imported.employer, 100, { nullable:true });
          if (imported?.eligibilityRequirements) {
            analysis.eligibilityRequirements = imported.eligibilityRequirements;
          }
          if (imported) analysis.openState = 'open';
          const opportunity = buildOpportunity(
            source, analysis, state.passport, now,
            candidateReadinessEvidence(profile, req.account, now),
          );
          state.opportunities.push(opportunity);
          state.opportunities = state.opportunities.slice(-MISSION_CONTROL_MAX_RECORDS);
          state.updatedAt = now;
          const body = { ...publicOpportunity(opportunity, state), duplicate:false };
          state = rememberMutation(state, mutation, 'opportunity_import', 201, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:201, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'opportunity-import'); }
    });

  router.get('/opportunities', requireAuth, copilotRead, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const filter = statusFilter(req.query?.status);
      const result = await mutateUser(req.account.id, async (profile) => {
        const before = readState(profile, dependencies);
        const state = refreshOpportunityReadiness(
          before, before.passport, asNow(dependencies.now),
          candidateReadinessEvidence(profile, req.account, asNow(dependencies.now)),
        );
        const opportunities = state.opportunities
          .filter((item) => !filter || item.status === filter)
          .map((item) => publicOpportunity(item, state)).filter(Boolean);
        return { save:false, value:{ opportunities } };
      });
      return res.json(result);
    } catch (error) { return errorResponse(res, error, 'opportunities-get'); }
  });

  router.post('/opportunities/:id/application-pack', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:20, tag:'application-pack-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(
          req.body, [], 'application_pack_create', String(req.params.id || ''),
        );
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'application_pack_create');
          if (replay) {
            const packId = replay.responseValue?.applicationPack?.id;
            const pack = state.applicationPacks.find((item) => item.id === packId);
            return { save:false, value:{ ...mutationResult(replay), body:{
              applicationPack:publicApplicationPack(pack, req.missionFlags),
              created:replay.responseValue?.created === true,
            } } };
          }
          state = refreshOpportunityReadiness(
            state, state.passport, now, candidateReadinessEvidence(profile, req.account, now),
          );
          const opportunity = findOpportunity(state, req.params.id);
          await verifyOpportunityStillOpen(opportunity, dependencies);
          const built = buildApplicationPack(state, opportunity, req.missionFlags, now);
          const body = {
            applicationPack:publicApplicationPack(built.pack, req.missionFlags),
            created:built.created,
          };
          const status = built.created ? 201 : 200;
          state = rememberMutation(built.state, request, 'application_pack_create', status, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'application-pack-create'); }
    });

  router.post('/application-packs/:id/approve', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:20, tag:'application-pack-approve-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(
          req.body, ['confirmed', 'factLockIds', 'confirmationVersion'],
          'application_pack_approve', String(req.params.id || ''),
        );
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'application_pack_approve');
          if (replay) {
            const packId = replay.responseValue?.applicationPack?.id;
            const pack = state.applicationPacks.find((item) => item.id === packId);
            return { save:false, value:{ ...mutationResult(replay),
              body:{ applicationPack:publicApplicationPack(pack, req.missionFlags) } } };
          }
          state = refreshOpportunityReadiness(
            state, state.passport, now, candidateReadinessEvidence(profile, req.account, now),
          );
          const pack = state.applicationPacks.find((item) => item.id === req.params.id);
          const opportunity = pack ? findOpportunity(state, pack.opportunityId) : null;
          if (opportunity) await verifyOpportunityStillOpen(opportunity, dependencies);
          const approved = approveApplicationPack(
            state, req.params.id,
            { ...request.payload, idempotencyKey:request.idempotencyKey }, now,
          );
          const body = { applicationPack:publicApplicationPack(approved.pack, req.missionFlags) };
          state = rememberMutation(approved.state, request, 'application_pack_approve', 200, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'application-pack-approve'); }
    });

  router.post('/application-packs/:id/mark-submitted', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:20, tag:'application-mark-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(
          req.body, ['confirmed', 'receiptHash'], 'application_mark_submitted', String(req.params.id || ''),
        );
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'application_mark_submitted');
          if (replay) {
            const packId = replay.responseValue?.applicationPack?.id;
            const pack = state.applicationPacks.find((item) => item.id === packId);
            return { save:false, value:{ ...mutationResult(replay),
              body:{ applicationPack:publicApplicationPack(pack, req.missionFlags) } } };
          }
          const submitted = markApplicationSubmitted(
            state, req.params.id,
            { ...request.payload, idempotencyKey:request.idempotencyKey }, now,
          );
          const body = { applicationPack:publicApplicationPack(submitted.pack, req.missionFlags) };
          state = rememberMutation(submitted.state, request, 'application_mark_submitted', 200, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'application-mark-submitted'); }
    });

  router.post('/opportunities/:id/response', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:30, tag:'response-classify-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(
          req.body, ['responseText'], 'opportunity_response', String(req.params.id || ''),
        );
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'opportunity_response');
          if (replay) return { save:false, value:mutationResult(replay) };
          const classification = classifyResponseText(request.payload.responseText);
          const recorded = recordResponseClassification(
            state, req.params.id, classification, now,
          );
          const body = {
            classification,
            opportunity:publicOpportunity(recorded.opportunity, recorded.state),
          };
          state = rememberMutation(recorded.state, request, 'opportunity_response', 200, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        // The raw response and normalized draft are deliberately not persisted.
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'response-classify'); }
    });

  router.post('/opportunities/:id/confirm-interview', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:20, tag:'interview-confirm-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const now = asNow(dependencies.now);
        const request = parseMutationBody(
          req.body,
          ['interviewDate', 'interviewTime', 'timezone', 'confirmed'],
          'opportunity_confirm_interview', String(req.params.id || ''),
        );
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'opportunity_confirm_interview');
          if (replay) return { save:false, value:mutationResult(replay) };
          const confirmation = normalizeConfirmInterview(request.payload, now);
          const recorded = recordInterviewConfirmation(state, req.params.id, confirmation, now);
          const opportunity = findOpportunity(recorded.state, req.params.id);
          const targetId = `vac_${sha256(`${opportunity.id}:${confirmation.interviewDate}`).slice(0, 24)}`;
          state = setActiveVacancyBridge(recorded.state, {
            opportunityId:opportunity.id,
            targetId,
            interviewDate:confirmation.interviewDate,
            activatedAt:now,
          });
          const body = {
            interview:recorded.interview,
            confirmed:recorded.changed,
            vacancyTargetId:targetId,
          };
          state = rememberMutation(
            state, request, 'opportunity_confirm_interview', 200, body, now,
          );
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'interview-confirm'); }
    });

  router.post('/opportunities/:id/verify-official-page', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:30, tag:'official-page-verify-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(
          req.body, [], 'official_page_verify', String(req.params.id || ''),
        );
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'official_page_verify');
          if (replay) return { save:false, value:mutationResult(replay) };
          const opportunity = findOpportunity(state, req.params.id);
          const verified = await verifyOpportunityStillOpen(opportunity, dependencies);
          const body = {
            opportunityId:opportunity.id,
            officialApplyUrl:verified.officialApplyUrl,
            verifiedAt:now,
          };
          state = rememberMutation(state, request, 'official_page_verify', 200, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'official-page-verify'); }
    });

  router.patch('/opportunities/:id/outcome', requireAuth, copilotAction,
    rateLimit({ windowMs:60 * 60 * 1000, max:20, tag:'opportunity-outcome-account',
      keyExtra:(req) => req.account.id, accountOnly:true }),
    async (req, res) => {
      res.set('Cache-Control', 'no-store');
      try {
        const request = parseMutationBody(
          req.body, ['outcome'], 'opportunity_outcome', String(req.params.id || ''),
        );
        const now = asNow(dependencies.now);
        const result = await mutateUser(req.account.id, async (profile) => {
          let state = readState(profile, dependencies);
          const replay = replayMutation(state, request, 'opportunity_outcome');
          if (replay) return { save:false, value:mutationResult(replay) };
          const recorded = recordOpportunityOutcome(state, req.params.id, request.payload, now);
          const body = publicOpportunity(recorded.opportunity, recorded.state);
          state = rememberMutation(recorded.state, request, 'opportunity_outcome', 200, body, now);
          writeState(profile, state, dependencies);
          return { value:{ replayed:false, status:200, body } };
        });
        return res.status(result.status).json(result.body);
      } catch (error) { return errorResponse(res, error, 'opportunity-outcome'); }
    });

  return router;
}

export const missionControlRouter = createMissionControlRouter();
export default missionControlRouter;
