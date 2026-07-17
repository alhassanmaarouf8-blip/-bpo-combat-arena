// Shared loading spinner — one source for every "working…" state (drill data fetches on a cold
// backend, Suspense chunk loads). Language-neutral by design: a spinner needs no text, so it never
// shows German to an Arabic user and never requires masri we're not allowed to author. Self-contained
// keyframe so it works without any global CSS. Replaces the bare "…" that read as frozen.

export function Spinner({ size = 30 }) {
  return (
    <span role="status" aria-label="Lädt…" style={{ display: 'inline-block', width: size, height: size,
      borderRadius: '50%', border: '2.5px solid rgba(59,130,246,0.22)', borderTopColor: '#3b82f6',
      animation: 'omni-spin 0.8s linear infinite' }}>
      <style>{`@keyframes omni-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[role=status]{animation:none!important;border-color:rgba(59,130,246,0.5)!important}}`}</style>
    </span>
  );
}

// Centered spinner pane — drop-in for a drill's loading phase (keeps the drill's own container).
export function LoadingPane() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      <Spinner />
    </div>
  );
}
