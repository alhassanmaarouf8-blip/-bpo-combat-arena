/**
 * time.js — timezone-aware "training day" helpers.
 *
 * The product targets Egyptian learners, but Render runs the server in UTC. If the daily
 * session and the streak roll over on the SERVER's clock, the day flips at ~01:00–02:00
 * Cairo time — so a learner training late at night loses their streak, or "today's"
 * session changes mid-evening. We anchor every day calculation to Cairo's calendar day.
 *
 * Override with APP_TIMEZONE if the audience changes.
 */
const TZ = process.env.APP_TIMEZONE || 'Africa/Cairo';

// en-CA renders as ISO-style YYYY-MM-DD, which is exactly the key shape we want.
const _fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});

export const APP_TZ = TZ;

// 'YYYY-MM-DD' for the given instant, in the app's timezone (default Cairo).
export function dayKey(ts = Date.now()) {
  return _fmt.format(new Date(ts));
}

// A DST-safe anchor (~noon, well away from midnight) for stepping a day key backwards:
// 09:00 UTC is ~11:00–12:00 in Cairo year-round, so subtracting 24h always lands
// squarely inside the previous calendar day regardless of DST transitions.
export function dayKeyNoonMs(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return Date.UTC(y, m - 1, d, 9, 0, 0);
}
