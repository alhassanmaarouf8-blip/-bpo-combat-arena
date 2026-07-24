/**
 * PreviewNav.jsx — PREVIEW ONLY. A tap-through switcher so the seven redesigned screens can be
 * walked on a real phone instead of judged as seven separate screenshots. Never ships.
 */
import { NAV_CSS, SCREENS } from './previewTheme.js';

export default function PreviewNav({ current, dark = false }) {
  return (
    <>
      <style>{NAV_CSS}</style>
      <nav className={`pv-nav${dark ? ' dark' : ''}`} aria-label="Preview-Screens">
        {SCREENS.map(([slug, label]) => (
          <a key={slug} href={`?preview=${slug}`} className={slug === current ? 'on' : ''}>{label}</a>
        ))}
      </nav>
    </>
  );
}
