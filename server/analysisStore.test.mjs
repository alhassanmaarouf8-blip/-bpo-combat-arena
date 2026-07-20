import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadAnalysisRecord, saveAnalysisRecord, eventsFromAnalysis, appendErrorEvents, loadErrorEvents, EVENT_CAP }
  from './analysisStore.js';

const BASE = path.dirname(fileURLToPath(import.meta.url));
const UID = 'testDeepAnalysisUser';
const cleanup = async () => {
  await rm(path.join(BASE, 'data', 'analyses', `${UID}__sess-1.json`), { force: true });
  await rm(path.join(BASE, 'data', 'errorlog', `${UID}.json`), { force: true });
};

const VALIDATED = {
  answers: [
    { index: 1, frage: 'F', original: 'weil ich habe Zeit', truncated: false,
      errors: [
        { quote: 'weil ich habe Zeit', korrektur: 'weil ich Zeit habe', kategorie: 'VERB_POSITION',
          subcode: 'verb_am_ende_nach_weil', code: 'VERB_POSITION/verb_am_ende_nach_weil',
          schwere: 3, verstaendlichkeit: 2, erklaerung_de: 'x', erklaerung_ar: 'y' },
      ],
      alternativen: [], staerken: [] },
  ],
  cefr: null, dropped: 0,
};

test('analysis record roundtrip (file mode) + transcript input survives', async (t) => {
  t.after(cleanup);
  const rec = { v: 1, userId: UID, sessionId: 'sess-1', status: 'queued', attempts: 1,
    createdAt: 1, input: { dialogue: [{ role: 'candidate', text: 'weil ich habe Zeit' }], metrics: {}, level: 'b2' } };
  await saveAnalysisRecord(rec);
  const back = await loadAnalysisRecord(UID, 'sess-1');
  assert.equal(back.status, 'queued');
  assert.equal(back.input.dialogue[0].text, 'weil ich habe Zeit');   // the audit-gap fix: input persisted
  assert.ok(back.updatedAt > 0);
});

test('eventsFromAnalysis flattens one row per error with the queryable fields', () => {
  const ev = eventsFromAnalysis({ userId: UID, sessionId: 'sess-1', validated: VALIDATED, at: 123 });
  assert.equal(ev.length, 1);
  assert.deepEqual(Object.keys(ev[0]).sort(),
    ['at', 'category', 'code', 'corrected', 'impact', 'quote', 'severity', 'sessionId', 'subcode', 'turnIndex'].sort());
  assert.equal(ev[0].category, 'VERB_POSITION');
  assert.equal(ev[0].severity, 3);
});

test('appendErrorEvents accumulates and stays bounded', async (t) => {
  t.after(cleanup);
  await appendErrorEvents(UID, eventsFromAnalysis({ userId: UID, sessionId: 'sess-1', validated: VALIDATED, at: 1 }));
  await appendErrorEvents(UID, eventsFromAnalysis({ userId: UID, sessionId: 'sess-1', validated: VALIDATED, at: 2 }));
  const events = await loadErrorEvents(UID);
  assert.equal(events.length, 2);
  const many = Array.from({ length: EVENT_CAP + 50 }, (_, i) => ({ at: i, sessionId: 's', category: 'KASUS', subcode: 'x', code: 'KASUS/x', severity: 1, impact: 1, quote: 'q', corrected: 'c', turnIndex: 1 }));
  await appendErrorEvents(UID, many);
  const capped = await loadErrorEvents(UID);
  assert.equal(capped.length, EVENT_CAP);
  assert.equal(capped[capped.length - 1].at, EVENT_CAP + 49);   // newest kept
});
