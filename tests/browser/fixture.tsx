import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { VoiceOverlay } from '../../src/ui/index';

// Synthetic host only. No real microphone, account, agent or business data.
const fixture = window as any;
fixture.voiceEvents = [];
fixture.captureTracks = [];
window.addEventListener('paperclip-companion:voice-state:v1', (event: any) => fixture.voiceEvents.push(event.detail));
Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const destination = ctx.createMediaStreamDestination();
  oscillator.connect(gain); gain.connect(destination); oscillator.start();
  await ctx.resume();
  fixture.inputEnergy = (value: number) => { gain.gain.value = value; };
  const track = destination.stream.getAudioTracks()[0];
  const originalStop = track.stop.bind(track);
  track.stop = () => { originalStop(); oscillator.stop(); void ctx.close(); };
  fixture.captureTracks.push(track);
  return destination.stream;
} });

function App() {
  const [companyId, setCompanyId] = useState('company-a');
  useEffect(() => {
    fixture.navigateVoiceFixture = (pathname: string, company = 'company-a') => {
      history.pushState({}, '', pathname);
      setCompanyId(company);
      window.dispatchEvent(new Event('fixture-navigation'));
    };
  }, []);
  return <VoiceOverlay context={{ companyId } as any} />;
}
createRoot(document.getElementById('root')!).render(<App />);
