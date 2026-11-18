export function VoiceIcon({ kind }: { kind: 'microphone' | 'speaker' | 'waves' }) {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind === 'microphone' ? <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8" /></> : kind === 'speaker' ? <><path d="m11 5-6 4H2v6h3l6 4V5ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" /></> : <path d="M3 10v4M7 7v10M11 4v16M15 7v10M19 9v6M22 11v2" />}
  </svg>;
}
