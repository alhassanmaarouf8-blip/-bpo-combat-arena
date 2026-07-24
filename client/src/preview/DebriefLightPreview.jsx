/**
 * DebriefLightPreview.jsx — PREVIEW ONLY (?preview=debrief). Not shipped to users.
 *
 * The debrief rebuilt in the ICONIC light language. Reference: Yoodli — its core idea is showing
 * WHERE something happened, not just that it happened. Yoodli marks moments on a time axis; this
 * app has no timestamps in its debrief payload, so the honest equivalent is the QUESTION axis:
 * server/coach.js emits interviewReview[] in question order, so "Frage 3 von 5" is real, derived
 * data — a wall-clock timestamp would have been invented. (An earlier mockup showed "2:04"; that
 * was fabricated and is deliberately not built.)
 *
 * Real payload fields consumed (server/coach.js "interviewReview" + App.jsx Debrief at ~1824):
 *   interviewReview[]: { frage, deinSatz, stark, luecke, fixDerEinstellt }
 * Only fields the server actually produces are rendered. Nothing is scored or counted that the
 * server did not send. New German lines carry OWNER-AR slots; Arabic is never authored here.
 */

// Representative payload in the REAL schema (server/coach.js). Shapes and wording match what the
// coach model is instructed to return — no invented fields, no fabricated metrics.
const DATA = {
  bossName: 'Yasmin',
  round: 2,
  interviewReview: [
    {
      frage: 'Stellen Sie sich kurz vor',
      deinSatz: 'Guten Tag, mein Name ist Karim und ich arbeite drei Jahre im Kundenservice.',
      stark: 'Klarer Einstieg, du nennst Rolle und Dauer sofort.',
      luecke: '',
      fixDerEinstellt: '',
    },
    {
      frage: 'Warum Kundenservice?',
      deinSatz: 'Ich arbeite gern mit der Kunde, weil ich helfen kann.',
      stark: 'Die Motivation kommt ehrlich rüber.',
      luecke: 'Nach „mit" fehlt der Dativ — das fällt einem Personaler sofort auf.',
      fixDerEinstellt: 'Ich arbeite gern mit dem Kunden, weil ich Probleme schnell löse.',
    },
    {
      frage: 'Schwieriger Kunde?',
      deinSatz: 'Einmal war ein Kunde sehr wütend, aber ich bin ruhig geblieben.',
      stark: 'Du bleibst konkret und nennst eine echte Situation.',
      luecke: 'Das Ergebnis fehlt — was kam am Ende dabei heraus?',
      fixDerEinstellt: '… und am Ende hatte der Kunde eine Lösung und hat sich bedankt.',
    },
  ],
};

const CSS = `
.dbf{position:fixed;inset:0;overflow-y:auto;background:#F5F3EF;color:#0E1320;
  font-family:'Inter','system-ui',sans-serif;-webkit-font-smoothing:antialiased}
.dbf *{box-sizing:border-box}
.dbf-in{max-width:440px;margin:0 auto;padding:24px 22px 40px}
.dbf-k{font-size:12px;font-weight:640;color:#8A909C;margin:0 0 10px}
.dbf-h{font-size:34px;line-height:1.04;letter-spacing:-.035em;font-weight:820;margin:0 0 12px;text-wrap:balance}
.dbf-s{font-size:14.5px;line-height:1.55;color:#5A6270;margin:0 0 28px}
/* the question axis — the honest "where" */
.ax-k{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8A909C;margin-bottom:13px}
.ax{display:flex;gap:6px;margin-bottom:10px}
.ax i{flex:1;height:5px;border-radius:3px;background:rgba(14,19,32,.10)}
.ax i.hit{background:#D9541A}
.ax-l{font-size:11.5px;color:#8A909C;margin:0 0 26px}
/* per-question entries */
.qz{border-top:1px solid rgba(14,19,32,.10);padding:18px 0}
.qz-n{font-size:11px;font-weight:700;color:#2563EB;letter-spacing:.06em;margin-bottom:7px}
.qz-q{font-size:13px;font-weight:640;color:#5A6270;margin:0 0 10px}
.qz-said{font-size:15px;line-height:1.5;color:#0E1320;margin:0 0 12px}
.qz-said.miss{color:#8A909C}
.qz-good{font-size:13.5px;line-height:1.5;color:#5A6270;margin:0;padding-left:13px;border-left:2px solid #2563EB}
.qz-gap{font-size:13.5px;line-height:1.5;color:#5A6270;margin:0 0 12px;padding-left:13px;border-left:2px solid #D9541A}
.qz-fix-k{font-size:10.5px;font-weight:700;letter-spacing:.13em;text-transform:uppercase;color:#8A909C;margin-bottom:5px}
.qz-fix{font-size:15.5px;line-height:1.5;font-weight:640;color:#0E1320;margin:0}
.dbf-act{display:block;width:100%;border:0;border-radius:11px;padding:16px;margin-top:28px;cursor:pointer;
  font-family:inherit;font-size:16px;font-weight:640;color:#fff;background:#D9541A;box-shadow:0 1px 2px rgba(18,22,31,.2)}
.dbf-q2{display:block;width:100%;background:none;border:0;color:#8A909C;font-family:inherit;font-size:14px;
  font-weight:600;padding:14px;margin-top:2px;cursor:pointer}
.dbf-d{font-size:11.5px;color:#8A909C;text-align:center;margin:16px 0 0;line-height:1.5}
`;

export default function DebriefLightPreview() {
  const rows = DATA.interviewReview;
  const gaps = rows.filter((r) => r.luecke);
  // The ONE thing to carry away — taken from the first real gap, never invented.
  const focus = gaps[0] || null;

  return (
    <div className="dbf">
      <style>{CSS}</style>
      <div className="dbf-in">

        <p className="dbf-k">Interview {DATA.round} · {DATA.bossName} · {rows.length} Fragen</p>
        {/* The hero states an honest, derived fact: how much of it already works. */}
        {/* OWNER-AR slot */}
        <h1 className="dbf-h">
          {rows.length - gaps.length} von {rows.length} Antworten
          {rows.length - gaps.length === 1 ? ' sitzt' : ' sitzen'}.
        </h1>
        <p className="dbf-s">
          {gaps.length === 1
            ? 'Eine Antwort braucht noch einen Zusatz. Die steht unten.'
            : `${gaps.length} Antworten brauchen noch einen Zusatz. Die stehen unten.`}
        </p>

        {/* WHERE it happened — by question, because that is what the data really knows. */}
        <p className="ax-k">Wo es hakte</p>
        <div className="ax" aria-hidden="true">
          {rows.map((r, i) => <i key={i} className={r.luecke ? 'hit' : ''} />)}
        </div>
        <p className="ax-l">
          Frage {rows.map((r, i) => (r.luecke ? i + 1 : null)).filter(Boolean).join(' und ')} von {rows.length}
        </p>

        {rows.map((r, i) => (
          <div className="qz" key={i}>
            <div className="qz-n">Frage {i + 1}</div>
            <p className="qz-q">{r.frage}</p>
            <p className={`qz-said${r.luecke ? ' miss' : ''}`}>„{r.deinSatz}"</p>
            {r.luecke ? <p className="qz-gap">{r.luecke}</p> : null}
            {r.fixDerEinstellt ? (
              <>
                <div className="qz-fix-k">So sitzt sie</div>
                <p className="qz-fix">„{r.fixDerEinstellt}"</p>
              </>
            ) : null}
            {!r.luecke && r.stark ? <p className="qz-good">{r.stark}</p> : null}
          </div>
        ))}

        {/* One action, derived from the first real gap. */}
        {/* OWNER-AR slot */}
        <button type="button" className="dbf-act">
          {focus ? 'Diese eine Sache üben' : 'Weiter'}
        </button>
        <button type="button" className="dbf-q2">Interview wiederholen</button>

        <p className="dbf-d">Trainings-Feedback zur Übung — kein offizielles Sprachzertifikat.</p>

      </div>
    </div>
  );
}
