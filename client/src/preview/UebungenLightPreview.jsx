/**
 * UebungenLightPreview.jsx — PREVIEW ONLY (?preview=uebungen).
 * Reference: Duolingo's posture — the app PRESCRIBES today's work instead of serving a menu.
 * One prescribed drill with the reason drawn from the learner's real interviews, then the rest
 * demoted to a quiet index (never removed — Übungen is a protected feature).
 * Honesty: the reason names measured evidence; it never claims improvement that was not verified.
 */
import { BASE_CSS } from './previewTheme.js';
import PreviewNav from './PreviewNav.jsx';

const CSS = `
.ub-why{font-size:14.5px;line-height:1.55;color:#5A6270;margin:0 0 20px}
.ub-why b{color:#0E1320;font-weight:680}
.ub-rx{border-top:1px solid rgba(14,19,32,.10);border-bottom:1px solid rgba(14,19,32,.10);
  padding:15px 0;margin-bottom:22px}
.ub-meta{display:flex;gap:16px;font-size:12.5px;font-weight:640;color:#8A909C;margin-bottom:12px}
.ub-ex{font-size:15px;line-height:1.5;color:#0E1320;margin:0}
.ub-ex s{color:#8A909C;text-decoration-color:#D9541A}
.ub-ex b{font-weight:680}
.ub-more{margin-top:32px}
.ub-mk{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8A909C;margin-bottom:2px}
.ub-row{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;
  padding:15px 0;border:0;border-top:1px solid rgba(14,19,32,.10);background:none;text-align:start;
  font-family:inherit;cursor:pointer;min-height:44px}
.ub-row b{display:block;font-size:15.5px;font-weight:660;color:#5A6270}
.ub-row small{font-size:12.5px;color:#8A909C}
.ub-cv{color:#8A909C;font-size:19px;flex:0 0 auto}
`;

const OTHERS = [
  ['Hör-Check', 'Verstehen unter Tempo'],
  ['Druck-Leiter', 'Antworten, wenn es eng wird'],
  ['Wiederholung', '4 Karten fällig'],
];

export default function UebungenLightPreview() {
  return (
    <div className="pv">
      <style>{BASE_CSS}{CSS}</style>
      <div className="pv-in">
        <p className="pv-kick">Heute</p>
        {/* OWNER-AR slot */}
        <h1 className="pv-h">Sag es richtig.</h1>
        {/* The reason comes from measured evidence, never a generic nudge. */}
        <p className="ub-why">
          Weil <b>Dativ nach Präposition</b> in deinen letzten zwei Interviews dreimal gekippt ist.
        </p>

        <div className="ub-rx">
          <div className="ub-meta"><span>6 Sätze</span><span>ca. 4 Min</span></div>
          <p className="ub-ex">„mit <s>der Kunde</s>" → „mit <b>dem Kunden</b>"</p>
        </div>

        {/* OWNER-AR slot */}
        <button type="button" className="pv-act">Anfangen</button>

        <div className="ub-more">
          <div className="ub-mk">Auch verfügbar</div>
          {OTHERS.map(([name, sub]) => (
            <button type="button" className="ub-row" key={name}>
              <span><b>{name}</b><small>{sub}</small></span>
              <span className="ub-cv" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
      <PreviewNav current="uebungen" />
    </div>
  );
}
