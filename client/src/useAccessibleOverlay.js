import { useEffect, useRef } from 'react';

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useAccessibleOverlay(onClose, label, active = true) {
  const overlayRef = useRef(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!active) return undefined;
    const overlay = overlayRef.current;
    if (!overlay) return undefined;
    const previousFocus = document.activeElement;
    const siblings = Array.from(overlay.parentElement?.children || []).filter((node) => node !== overlay);
    const previousSiblingState = siblings.map((node) => ({ node, inert: node.inert, ariaHidden: node.getAttribute('aria-hidden') }));
    siblings.forEach((node) => { node.inert = true; node.setAttribute('aria-hidden', 'true'); });
    overlay.focus({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(overlay.querySelectorAll(FOCUSABLE))
        .filter((node) => !node.hidden && node.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) { event.preventDefault(); overlay.focus(); return; }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    overlay.addEventListener('keydown', onKeyDown);
    return () => {
      overlay.removeEventListener('keydown', onKeyDown);
      previousSiblingState.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden == null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', ariaHidden);
      });
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [label, active]);

  return { ref: overlayRef, role: 'dialog', 'aria-modal': 'true', 'aria-label': label, tabIndex: -1, 'data-app-overlay': 'true' };
}
