/**
 * DiagnoseLightPreview.jsx — PREVIEW ONLY (?preview=diagnose).
 * The question IS the screen — no card wrapper. Progress is five fine ticks, not boxes.
 * One action: the mic. Typing stays reachable but demoted (never a dead end).
 */
import { BASE_CSS } from './previewTheme.js';
import PreviewNav from './PreviewNav.jsx';

const CSS = `
.dg-ticks{display:flex;gap:5px;margin-bottom:28px}
.dg-ticks i{height:3px;flex:1;border-radius:2px;background:rgba(14,19,32,.12)}
.dg-ticks i.done{background:#2563EB;opacity:.38}
.dg-ticks i.now{background:#2563EB}
.dg-q{font-size:30px;line-height:1.12;letter-spacing:-.03em;font-weight:790;margin:0 0 12px;text-wrap:balance}
.dg-hint{font-size:14.5px;color:#5A6270;margin:0 0 46px}
.dg-mic{display:flex;flex-direction:column;align-items:center;gap:16px;padding:6px 0 26px}
.dg-wave{display:flex;align-items:center;gap:3px;height:34px}
.dg-wave i{width:3px;border-radius:2px;background:#2563EB;opacity:.5}
.dg-btn{width:78px;height:78px;border-radius:999px;border:0;background:#D9541A;color:#fff;display:grid;
  place-items:center;cursor:pointer;box-shadow:0 2px 12px rgba(18,22,31,.22)}
.dg-st{font-size:13.5px;color:#8A909C;font-weight:600}
`;
const BARS = [9, 19, 31, 14, 25, 34, 17, 27, 11, 22, 15, 8];

export default function DiagnoseLightPreview() {
  return (
    <div className="pv">
      <style>{BASE_CSS}{CSS}</style>
      <div className="pv-in">
        <div className="dg-ticks" aria-hidden="true">
          <i className="done" /><i className="done" /><i className="now" /><i /><i />
        </div>
        <p className="pv-kick">Frage 3 von 5</p>
        {/* OWNER-AR slot */}
        <h1 className="dg-q">Erzählen Sie von einem schwierigen Kunden.</h1>
        <p className="dg-hint">Antworte auf Deutsch. Eine Minute reicht.</p>

        <div className="dg-mic">
          <div className="dg-wave" aria-hidden="true">
            {BARS.map((h, i) => <i key={i} style={{ height: h }} />)}
          </div>
          <button type="button" className="dg-btn" aria-label="Aufnahme starten">
            <svg viewBox="0 0 24 24" width="27" height="27" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
              <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
              <path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v3" />
            </svg>
          </button>
          <div className="dg-st">Ich höre zu …</div>
        </div>

        <button type="button" className="pv-quiet">Lieber tippen</button>
      </div>
      <PreviewNav current="diagnose" />
    </div>
  );
}
