export default function Trainingsnachweis({ email, sessions, rank, daily, totals, onClose }) {
  const today = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
  const stats = [
    { label: 'Interview-Sitzungen', value: sessions ?? 0, ar: 'جلسات الإنترفيو' },
    { label: 'Beste Trainingsserie', value: `${daily?.best ?? 0} Tage`, ar: 'أفضل سلسلة تدريب' },
    { label: 'Gesprächsniveau', value: rank?.label ?? '—', ar: 'مستوى الإنترفيو' },
    { label: 'Ø Flüssigkeit', value: rank?.score ? `${rank.score}/100` : '—', ar: 'معدل الطلاقة' },
    { label: 'Vokabeln gelernt', value: totals?.vocabLearned ?? 0, ar: 'مفردات تعلمتها' },
    { label: 'Grammatik-Regeln', value: totals?.rulesMastered ?? 0, ar: 'قواعد نحوية' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 400, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(2,4,9,0.97)', backdropFilter: 'blur(8px)', padding: 20, boxSizing: 'border-box' }}>
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body > *:not(#nachweis-root) { display: none !important; }
          #nachweis-root { position: static !important; background: #fff !important; color: #000 !important; padding: 32px !important; }
          .nachweis-noprint { display: none !important; }
          .nachweis-cert { box-shadow: none !important; border: 2px solid #000 !important; background: #fff !important; color: #000 !important; }
          .nachweis-stat-label { color: #444 !important; }
          .nachweis-stat-val { color: #000 !important; }
          .nachweis-disclaimer { color: #666 !important; }
        }
      ` }} />

      <div id="nachweis-root" className="nachweis-cert" style={{
        width: '100%', maxWidth: 480, borderRadius: 16, padding: '32px 28px',
        background: 'linear-gradient(160deg, #06101e 0%, #030810 60%, #050d18 100%)',
        border: '1px solid rgba(0,229,255,0.4)', boxShadow: '0 0 60px rgba(0,229,255,0.15), inset 0 0 40px rgba(0,0,0,0.5)',
        position: 'relative', textAlign: 'center' }}>

        {/* Close */}
        <button className="nachweis-noprint" onClick={onClose}
          style={{ position: 'absolute', top: 14, right: 14, background: 'transparent', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 6, color: '#64748b', cursor: 'pointer', fontSize: 14, padding: '3px 9px', fontFamily: 'Orbitron, monospace' }}>✕</button>

        {/* Logo */}
        <div style={{ fontSize: 32, marginBottom: 4 }}>🥊</div>
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 18, fontWeight: 900, letterSpacing: 3,
          color: '#00e5ff', textShadow: '0 0 20px rgba(0,229,255,0.6)', marginBottom: 4 }}>OMNI-PERFORM</div>

        {/* Title */}
        <div style={{ fontFamily: 'Orbitron, monospace', fontWeight: 700, fontSize: 13, letterSpacing: '0.2em',
          color: '#a78bfa', textShadow: '0 0 12px rgba(167,139,250,0.5)', marginBottom: 16 }}>
          TRAININGSNACHWEIS
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(0,229,255,0.4), transparent)', marginBottom: 18 }} />

        {/* Student */}
        <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.1em', marginBottom: 4 }}>TEILNEHMER · المتدرب</div>
        <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 14, fontWeight: 700, color: '#e2e8f0', marginBottom: 4, wordBreak: 'break-all' }}>{email}</div>
        <div style={{ fontSize: 11, color: '#475569', marginBottom: 20 }}>{today}</div>

        {/* Stats grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20, textAlign: 'left' }}>
          {stats.map((s) => (
            <div key={s.label} style={{ padding: '10px 12px', borderRadius: 8,
              background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="nachweis-stat-label" style={{ fontSize: 9, color: '#475569', letterSpacing: '0.1em', marginBottom: 4 }}>{s.label.toUpperCase()}</div>
              <div dir="rtl" style={{ fontSize: 9, color: '#374151', marginBottom: 4 }}>{s.ar}</div>
              <div className="nachweis-stat-val" style={{ fontFamily: 'Orbitron, monospace', fontWeight: 700, fontSize: 15, color: '#f8fafc' }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(167,139,250,0.3), transparent)', marginBottom: 14 }} />

        {/* Disclaimer */}
        <div className="nachweis-disclaimer" style={{ fontSize: 9.5, color: '#374151', lineHeight: 1.6, marginBottom: 16 }}>
          Kein offiziell anerkannter Abschluss — internes Trainingsprotokoll.
          <br /><span dir="rtl">ملاحظة: ده سجل تدريب داخلي، مش شهادة رسمية.</span>
        </div>

        {/* Print button */}
        <button className="nachweis-noprint" onClick={() => window.print()}
          style={{ fontFamily: 'Orbitron, monospace', fontWeight: 700, fontSize: 11, letterSpacing: '0.1em',
            padding: '11px 22px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid #a78bfa', color: '#a78bfa', background: 'rgba(167,139,250,0.1)',
            boxShadow: '0 0 16px rgba(167,139,250,0.2)' }}>
          🖨 DRUCKEN / PRINT
        </button>
      </div>
    </div>
  );
}
