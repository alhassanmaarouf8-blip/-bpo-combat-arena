/**
 * InterviewStagePreview.jsx — PREVIEW ONLY (?preview=interview).
 *
 * Deliberately DARK. Everything else in the redesign goes light; the live interview is the stage,
 * where nothing may compete with the conversation. Choosing to keep one screen dark is a decision,
 * not a missed migration.
 *
 * Reference: ChatGPT Advanced Voice Mode — its 2025 change was putting voice AND the live
 * transcript on ONE screen, with a living orb showing who currently holds the turn. The old screen
 * was arcade (a letter in a glowing circle, stat badges); the first light attempt was dead (text
 * with nobody there). This has presence + transcript together.
 *
 * The orb is a state indicator, never decoration: it says who is speaking. Motion is a single
 * breath tied to that state and is disabled under prefers-reduced-motion.
 */
import PreviewNav from './PreviewNav.jsx';

const CSS = `
.iv{position:fixed;inset:0;overflow-y:auto;background:#0A0E1A;color:#E9EFF7;
  font-family:'Inter','system-ui',sans-serif;-webkit-font-smoothing:antialiased}
.iv *{box-sizing:border-box}
.iv-in{max-width:440px;margin:0 auto;padding:18px 20px 92px;min-height:100%;display:flex;flex-direction:column}
.iv-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.iv-back{background:none;border:0;color:#7F94B2;font-size:20px;cursor:pointer;padding:4px 8px 4px 0;min-height:44px}
.iv-who{font-size:12.5px;font-weight:640;color:#B9C8DC}
.iv-live{font-size:10.5px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;color:#E8814A;
  display:flex;align-items:center;gap:6px}
.iv-live i{width:6px;height:6px;border-radius:999px;background:#E8814A}
.iv-orbw{display:flex;flex-direction:column;align-items:center;gap:12px;padding:24px 0 20px}
.iv-orb{position:relative;width:104px;height:104px}
.iv-orb span{position:absolute;border-radius:999px;display:block}
.iv-o3{inset:0;background:radial-gradient(circle at 34% 30%,rgba(96,165,250,.30),rgba(37,99,235,.08) 62%,transparent 72%)}
.iv-o2{inset:17px;background:radial-gradient(circle at 36% 30%,rgba(120,180,255,.55),rgba(37,99,235,.24) 64%,transparent 76%)}
.iv-o1{inset:34px;background:radial-gradient(circle at 38% 28%,#CFE2FE,#3B82F6 74%);box-shadow:0 0 26px rgba(59,130,246,.45);
  animation:iv-breath 3.6s ease-in-out infinite}
@keyframes iv-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}
.iv-state{font-size:12.5px;font-weight:620;color:#8FA6C4}
.iv-tr{flex:1;display:flex;flex-direction:column;gap:18px;padding-top:4px}
.iv-t span{display:block;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;margin-bottom:5px}
.iv-t p{margin:0;font-size:15px;line-height:1.55}
.iv-t.past span{color:#5F7A9C}.iv-t.past p{color:#7D90A8}
.iv-t.now span{color:#7FA8E4}.iv-t.now p{color:#EEF4FB}
.iv-t.now b{color:#fff;font-weight:680}
.iv-foot{display:flex;flex-direction:column;align-items:center;gap:10px;padding-top:22px}
.iv-mtr{display:flex;align-items:center;gap:3px;height:20px}
.iv-mtr i{width:3px;border-radius:2px;background:#3B82F6;opacity:.75;display:block}
.iv-hint{font-size:12.5px;color:#7F94B2}
.iv-type{background:none;border:0;color:#5F7A9C;font-family:inherit;font-size:12.5px;font-weight:600;
  padding:10px;cursor:pointer;text-decoration:underline;text-underline-offset:3px;min-height:44px}
@media (prefers-reduced-motion:reduce){.iv-o1{animation:none}}
`;
const MTR = [13, 7, 20, 9, 15, 8, 17, 11, 19, 7, 14, 9, 12];

export default function InterviewStagePreview() {
  return (
    <div className="iv">
      <style>{CSS}</style>
      <div className="iv-in">
        <div className="iv-top">
          <button type="button" className="iv-back" aria-label="Zurück">‹</button>
          <span className="iv-who">Yasmin · Personalabteilung</span>
          <span className="iv-live"><i aria-hidden="true" />Live</span>
        </div>

        {/* Presence: who holds the turn right now. */}
        <div className="iv-orbw">
          <div className="iv-orb" role="img" aria-label="Yasmin spricht">
            <span className="iv-o3" /><span className="iv-o2" /><span className="iv-o1" />
          </div>
          <div className="iv-state">Yasmin spricht</div>
        </div>

        {/* Live transcript on the same screen as the voice. */}
        <div className="iv-tr">
          <div className="iv-t past">
            <span>Du</span>
            <p>Guten Tag. Mein Name ist Karim und ich komme aus Kairo.</p>
          </div>
          <div className="iv-t now">
            <span>Yasmin</span>
            {/* OWNER-AR slot */}
            <p>Schön, Herr Karim. Erzählen Sie mir — <b>warum möchten Sie im Kundenservice arbeiten?</b></p>
          </div>
        </div>

        <div className="iv-foot">
          <div className="iv-mtr" aria-hidden="true">
            {MTR.map((h, i) => <i key={i} style={{ height: h }} />)}
          </div>
          {/* OWNER-AR slot */}
          <div className="iv-hint">Sprich einfach — ich sende automatisch</div>
          <button type="button" className="iv-type">Lieber tippen</button>
        </div>
      </div>
      <PreviewNav current="interview" dark />
    </div>
  );
}
