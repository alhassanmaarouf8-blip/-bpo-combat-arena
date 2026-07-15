export async function reportDrillEvent({ apiUrl, token, event }) {
  if (!apiUrl || !token || !event?.drill || !event?.evidenceReceipt) return null;
  try {
    const response = await fetch(`${apiUrl}/api/drill-event`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ drill: event.drill, evidenceReceipt: event.evidenceReceipt }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('omni:coach-state-changed', { detail: { source: 'drill', drill: event.drill } }));
      // A successful attempt often has no correction. Broadcast that absence as well so a cue from
      // the previous failed attempt cannot remain visible after the learner fixes the error.
      window.dispatchEvent(new CustomEvent('omni:salma-coach-cue', {
        detail: { drill: event.drill, cue: body.coachCue || null },
      }));
    }
    if (!body.coachCue) return null;
    return body.coachCue;
  } catch { return null; }
}
