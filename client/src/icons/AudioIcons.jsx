// Shared machined stroke-SVG audio icons — one consistent set across every screen.
// Replaces emoji-as-chrome (🔊 🔈 🔇), which violates the icon law ("instrument, never arcade").
// Inherit color via currentColor; size defaults to 18. aria-hidden — label the button, not the icon.

const baseStyle = { verticalAlign: 'middle', flexShrink: 0 };

export function SpeakerIcon({ size = 18, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ ...baseStyle, ...style }}>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.4 8.6a5 5 0 0 1 0 6.8" />
      <path d="M18.3 5.7a9 9 0 0 1 0 12.6" />
    </svg>
  );
}

// Quiet speaker (idle / not currently speaking) — no sound-wave arcs.
export function SpeakerQuietIcon({ size = 18, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ ...baseStyle, ...style }}>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.4 8.6a5 5 0 0 1 0 6.8" />
    </svg>
  );
}

// Close / dismiss — a machined X (replaces the ✕ text glyph used as chrome).
export function CloseIcon({ size = 18, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ ...baseStyle, ...style }}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

// Muted speaker — crossed-out.
export function SpeakerMuteIcon({ size = 18, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ ...baseStyle, ...style }}>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M22 9l-6 6M16 9l6 6" />
    </svg>
  );
}
