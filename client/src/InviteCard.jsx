/**
 * InviteCard.jsx — the in-product referral loop. Shares the user's invite link (?ref=<accountId>).
 * When the invited friend completes their FIRST interview, both get +3 free-trial days (server:
 * creditReferral). Pure client, $0. Simple safe masri only; nothing fabricated.
 */
import { useState } from 'react';

export function InviteCard({ accountId }) {
  const [copied, setCopied] = useState(false);
  if (!accountId) return null;
  const origin = (typeof window !== 'undefined' && window.location?.origin) || 'https://bpo-combat-arena.vercel.app';
  const link = `${origin}?ref=${accountId}`;
  const onShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'OMNI-PERFORM', text: 'اتدرّب معايا على إنترفيو شغل ألماني — كلنا ناخد أيام مجانية زيادة:', url: link });
        return;
      }
      await navigator.clipboard?.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800);
    } catch { /* cancelled */ }
  };
  return (
    <div style={card} dir="rtl">
      <div style={head}>🎁 ادعي صاحبك · FREUND EINLADEN</div>
      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.7 }}>
        ابعت اللينك ده لصاحبك — أول ما يعمل أول إنترفيو، انتوا الاتنين تاخدوا <b style={{ color: 'var(--action)' }}>3 أيام مجانية</b> زيادة.
      </div>
      <button onClick={onShare} style={btn}>{copied ? '✓ اتنسخ اللينك' : '📤 ابعت الدعوة'}</button>
    </div>
  );
}

const card = { marginTop: 12, padding: 14, borderRadius: 12, border: '1px solid rgba(59,130,246,0.25)', background: 'rgba(59,130,246,0.06)' };
const head = { fontSize: 10.5, letterSpacing: '0.08em', color: 'var(--accent-2)', fontWeight: 800, marginBottom: 8, fontFamily: 'var(--font-display)' };
const btn  = { width: '100%', marginTop: 10, padding: '10px 14px', borderRadius: 8, border: 'none', cursor: 'pointer', fontWeight: 800, color: '#04110b', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' };
