export async function reportDrillEvent({ apiUrl, token, event }) {
  if (!apiUrl || !token || !event?.drill) return null;
  try {
    const response = await fetch(`${apiUrl}/api/drill-event`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.coachCue) return null;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('omni:salma-coach-cue', { detail: { drill: event.drill, cue: body.coachCue } }));
    return body.coachCue;
  } catch { return null; }
}
