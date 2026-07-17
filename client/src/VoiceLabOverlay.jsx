import { useState } from 'react';
import { currentVoiceLabFixture, setVoiceLabFixture, voiceLabEnabled } from './voiceLabFixture.js';

export function VoiceLabOverlay() {
  const [fixture, setFixture] = useState(() => currentVoiceLabFixture());
  const [error, setError] = useState('');
  if (!voiceLabEnabled()) return null;
  return <aside aria-label="Voice Reality Lab" style={{ position: 'fixed', right: 12, top: 12, zIndex: 2147483646,
    width: 300, padding: 12, borderRadius: 12, background: '#07101e', color: '#e2e8f0',
    border: '2px solid #f97316', boxShadow: '0 12px 40px rgba(0,0,0,.5)', font: '12px/1.45 system-ui' }}>
    <strong style={{ display: 'block', color: '#fb923c', marginBottom: 5 }}>VOICE REALITY LAB · LOCAL ONLY</strong>
    <div style={{ color: '#cbd5e1', marginBottom: 8 }}>
      Select a generated WAV. The next microphone action consumes that exact audio and also plays it aloud.
    </div>
    <label style={{ display: 'block', minHeight: 44 }}>
      <span style={{ display: 'block', marginBottom: 4 }}>Exact learner fixture</span>
      <input type="file" accept="audio/wav,.wav" onChange={async (event) => {
        setError('');
        try { setFixture(await setVoiceLabFixture(event.target.files?.[0])); }
        catch { setFixture(null); setError('Choose a valid RIFF/WAVE file under 4 MB.'); }
      }} />
    </label>
    {fixture && <div role="status" style={{ color: '#86efac', overflowWrap: 'anywhere' }}>Armed: {fixture.name}</div>}
    {error && <div role="alert" style={{ color: '#fca5a5' }}>{error}</div>}
  </aside>;
}

