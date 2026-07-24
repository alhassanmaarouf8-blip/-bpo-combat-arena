/**
 * deepAnalysisClient.js — ONE poll of GET /api/analysis/:sessionId, shared by every consumer.
 *
 * Why it moved out of DeepAnalysisSection: the debrief now leads with the learner's own evidence
 * (the finding count + the named bottleneck + two of their own corrected sentences) ABOVE the
 * "ALLE DETAILS & ANALYSE ANZEIGEN" toggle, while the full analysis still renders inside it. Two
 * consumers polling the same endpoint independently would double the request rate for one payload,
 * so the poll is lifted to the debrief and the result is passed down.
 *
 * Side effect, deliberate and good: the poll now starts when the debrief OPENS rather than when
 * the user expands the details. `GET /api/analysis/:sessionId` IS the retry queue (see
 * server/analysisRoutes.js) — polling it is what kicks a stalled analysis — so starting earlier
 * means the evidence is ready sooner for the learner who never expands anything. The endpoint
 * allows 120 requests / 10 min per account; this backoff tops out at 36 tries over ~3 min.
 *
 * The polling logic below is a byte-for-byte lift of the original: same URL, same 5s interval,
 * same 36-try ceiling, same `{ status }` shape, same "transient errors keep polling" behaviour,
 * same terminal states ('ready' | 'failed'). Nothing about the contract changed.
 */
import { useState, useEffect } from 'react';

export function useDeepAnalysis(token, apiUrl, sessionId) {
  const [state, setState] = useState({ status: 'pending' });
  useEffect(() => {
    // Reset when the session changes, so a previous interview's evidence can never be shown
    // against a new one while the first tick is still in flight.
    setState({ status: 'pending' });
    if (!sessionId || !token) return undefined;
    let stopped = false, tries = 0, timer = null;
    const tick = async () => {
      try {
        const r = await fetch(`${apiUrl}/api/analysis/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } });
        const j = r.ok ? await r.json() : { status: r.status === 404 ? 'failed' : 'pending' };
        if (stopped) return;
        if (j.status === 'ready' || j.status === 'failed') { setState(j); return; }
        setState({ status: j.status });
      } catch { /* transient — keep polling */ }
      if (!stopped && ++tries < 36) timer = setTimeout(tick, 5000);
      else if (!stopped) setState((s) => (s.status === 'ready' ? s : { status: 'failed' }));
    };
    tick();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [sessionId, token, apiUrl]);
  return state;
}
