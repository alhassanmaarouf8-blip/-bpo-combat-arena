/**
 * FortschrittLightPreview.jsx — PREVIEW ONLY (?preview=fortschritt).
 * Reference: Duolingo's path — momentum and state, not a settings list. Done carries a check,
 * the current station is larger with the action INSIDE it, later stations are locked.
 * Honesty: a station is only "done" when the server confirmed it; nothing here invents progress.
 */
import { BASE_CSS } from './previewTheme.js';
import PreviewNav from './PreviewNav.jsx';

const CSS = `
.ft-path{position:relative;margin-top:4px}
.ft-path::before{content:'';position:absolute;inset-inline-start:11px;top:16px;bottom:26px;width:2px;
  background:rgba(14,19,32,.10)}
.ft-n{position:relative;display:flex;gap:16px;padding-bottom:26px}
.ft-d{position:relative;z-index:1;flex:0 0 auto;width:24px;height:24px;border-radius:999px;display:grid;
  place-items:center;background:#EDEBE6;box-shadow:inset 0 0 0 2px rgba(14,19,32,.13)}
.ft-n.done .ft-d{background:#2563EB;box-shadow:none}
.ft-n.now .ft-d{background:#D9541A;box-shadow:0 0 0 5px rgba(217,84,26,.16)}
.ft-n b{display:block;font-size:16.5px;font-weight:720;letter-spacing:-.01em;color:#5A6270}
.ft-n small{font-size:13px;color:#8A909C;display:block;line-height:1.45}
.ft-n.now b{font-size:19px;color:#0E1320}
.ft-n.now small{color:#5A6270}
.ft-n.lock b{color:#A6ACB8}.ft-n.lock small{color:#B3B9C3}
.ft-mini{margin-top:12px;border:0;border-radius:10px;background:#D9541A;color:#fff;font-family:inherit;
  font-size:14px;font-weight:640;padding:12px 18px;min-height:44px;cursor:pointer}
.ft-note{font-size:13px;line-height:1.55;color:#8A909C;border-top:1px solid rgba(14,19,32,.10);
  padding-top:16px;margin:2px 0 0}
`;

const Check = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5l5.2 5.2L20 7" /></svg>
);
const Lock = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="#A6ACB8" strokeWidth="2.4"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
);

export default function FortschrittLightPreview() {
  return (
    <div className="pv">
      <style>{BASE_CSS}{CSS}</style>
      <div className="pv-in">
        <p className="pv-kick">Dein Weg</p>
        {/* The position is the headline — read it without parsing a list. */}
        <h1 className="pv-h">Station 2<br />von 4.</h1>

        <div className="ft-path">
          <div className="ft-n done">
            <span className="ft-d"><Check /></span>
            <div><b>Messen</b><small>Interview 1 und 2 ausgewertet</small></div>
          </div>
          <div className="ft-n now">
            <span className="ft-d" />
            <div>
              <b>Trainieren</b>
              <small>Dativ nach Präposition · 6 Sätze</small>
              {/* OWNER-AR slot */}
              <button type="button" className="ft-mini">Jetzt üben</button>
            </div>
          </div>
          <div className="ft-n lock">
            <span className="ft-d"><Lock /></span>
            <div><b>Beweisen</b><small>Öffnet nach dem Training</small></div>
          </div>
          <div className="ft-n lock">
            <span className="ft-d"><Lock /></span>
            <div><b>Bewerben</b><small>Echte Stellen</small></div>
          </div>
        </div>

        <p className="ft-note">Eine Station zählt erst, wenn du sie in einer neuen Situation zeigst.</p>
      </div>
      <PreviewNav current="fortschritt" />
    </div>
  );
}
