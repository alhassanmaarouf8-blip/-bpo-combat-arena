import { useState } from 'react';
import { currentVoiceLabFixture, loadVoiceLabFixtureUrl, setVoiceLabFixture, voiceLabEnabled } from './voiceLabFixture.js';

export function VoiceLabOverlay() {
  const [fixture, setFixture] = useState(() => currentVoiceLabFixture());
  const [error, setError] = useState('');
  const [fixtureUrl, setFixtureUrl] = useState('http://127.0.0.1:8787/voice-fixtures/learner.wav');
  if (!voiceLabEnabled()) return null;
  return <aside aria-label="Voice Reality Lab" style={{ position: 'fixed', right: 12, top: 12, zIndex: 2147483646,
    width: 300, padding: 12, borderRadius: 12, background: 'var(--surface)', color: 'var(--text)',
    border: '2px solid var(--action)', boxShadow: 'var(--e2)', font: '12px/1.45 system-ui' }}>
    <strong style={{ display: 'block', color: 'var(--action)', marginBottom: 5 }}>VOICE REALITY LAB · LOCAL ONLY</strong>
    <div style={{ color: 'var(--text-dim)', marginBottom: 8 }}>
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
    <label style={{ display: 'block', marginTop: 8 }}>
      <span style={{ display: 'block', marginBottom: 4 }}>Local fixture URL</span>
      <input aria-label="Local fixture URL" value={fixtureUrl} onChange={(event) => setFixtureUrl(event.target.value)}
        style={{ width: '100%', minHeight: 44 }} />
    </label>
    <button type="button" onClick={async () => {
      setError('');
      try { setFixture(await loadVoiceLabFixtureUrl(fixtureUrl)); }
      catch { setFixture(null); setError('Use a WAV from http://127.0.0.1:8787/voice-fixtures/.'); }
    }} style={{ minHeight: 44, width: '100%', marginTop: 6 }}>Load local WAV</button>
    {fixture && <div role="status" style={{ color: '#86efac', overflowWrap: 'anywhere' }}>Armed: {fixture.name}</div>}
    {error && <div role="alert" style={{ color: 'var(--bad)' }}>{error}</div>}
  </aside>;
}

