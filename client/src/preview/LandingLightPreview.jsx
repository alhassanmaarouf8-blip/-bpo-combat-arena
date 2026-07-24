/**
 * LandingLightPreview.jsx — PREVIEW ONLY (?preview=landing).
 * Photo hero with the headline sitting ON the image, then ONE claim, ONE action, and hard proof:
 * the correction the product actually performs. Proof beats an empty premium page (the critique:
 * "minimalism without substance looks like an unfinished MVP").
 * Honesty: no counts, no testimonials, no scarcity — only what the product provably does.
 */
import { BASE_CSS } from './previewTheme.js';
import PreviewNav from './PreviewNav.jsx';

const CSS = `
.lp-hero{position:relative;height:344px;overflow:hidden;background:#0e1b33;margin:-24px -22px 0}
.lp-hero img{width:100%;height:100%;object-fit:cover;object-position:58% 20%;display:block}
.lp-scrim{position:absolute;inset:0;background:
  linear-gradient(102deg,rgba(8,13,24,.88) 2%,rgba(8,13,24,.52) 44%,rgba(8,13,24,.10) 70%),
  linear-gradient(to bottom,rgba(8,13,24,0) 60%,#F5F3EF 100%)}
.lp-nav{position:absolute;top:18px;left:22px;display:flex;align-items:center;gap:9px;z-index:2}
.lp-mono{width:28px;height:28px;border-radius:8px;background:#0d1424;display:inline-flex;align-items:center;justify-content:center;gap:3px}
.lp-mono i{width:3px;height:12px;border-radius:2px;background:#3b82f6}
.lp-mono i:last-child{height:8px;background:#f97316}
.lp-wm{color:#fff;font-size:12px;font-weight:640;opacity:.94}
.lp-type{position:absolute;left:22px;bottom:30px;z-index:2}
.lp-type h1{color:#fff;font-size:46px;line-height:.96;letter-spacing:-.042em;font-weight:830;margin:0;
  text-shadow:0 2px 22px rgba(6,10,20,.55)}
.lp-body{padding-top:2px}
.lp-free{font-size:12.5px;color:#8A909C;text-align:center;margin:12px 0 26px}
.lp-proof{border-top:1px solid rgba(14,19,32,.10);padding-top:18px}
.lp-pk{font-size:10.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8A909C;margin-bottom:13px}
.lp-pn{font-size:13px;color:#8A909C;line-height:1.5;margin:12px 0 0}
.lp-pn i{font-style:italic}
`;

export default function LandingLightPreview() {
  return (
    <div className="pv">
      <style>{BASE_CSS}{CSS}</style>
      <div className="pv-in">
        <div className="lp-hero">
          <img src="/salma.jpg" alt="" decoding="async" />
          <div className="lp-scrim" aria-hidden="true" />
          <div className="lp-nav">
            <span className="lp-mono" aria-hidden="true"><i /><i /></span>
            <span className="lp-wm">German Interview Trainer</span>
          </div>
          {/* OWNER-AR slot */}
          <div className="lp-type"><h1>Bis die<br />Antwort<br />sitzt.</h1></div>
        </div>

        <div className="lp-body">
          {/* The job market, never nationality framing (design-system copy law #8). */}
          {/* OWNER-AR slot */}
          <p className="pv-lead">Deutsches Interview-Training für Call-Center-Jobs in Ägypten und für Remote-Stellen.</p>
          <button type="button" className="pv-act">Kostenlos anfangen</button>
          <p className="lp-free">Einstufung und dein erstes Interview — ohne Karte.</p>

          <div className="lp-proof">
            <div className="lp-pk">So klingt dein Feedback</div>
            <p className="pv-was">„Ich habe <s>den Kunde</s> geholfen."</p>
            <p className="pv-ist">„Ich habe <b>dem Kunden</b> geholfen."</p>
            <p className="lp-pn">Dativ nach <i>helfen</i>. Zweimal laut sagen — dann weiter.</p>
          </div>
        </div>
      </div>
      <PreviewNav current="landing" />
    </div>
  );
}
