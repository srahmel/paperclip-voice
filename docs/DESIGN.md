# Architektur und bewusste Grenzen

## Eine Datenquelle

- Paperclip `GET/POST /api/companies/:companyId/chats/:agentRef` öffnet/erstellt eine **normale** Agentenchat-Issue nur beim ersten Senden.
- Paperclip `POST /api/issues/:issueId/comments` schreibt die Spracheingabe als normalen menschlich authentifizierten Kommentar, inklusive idempotency `clientRequestId`.
- Paperclip `GET /api/issues/:issueId/comments` bzw. die SDK `ctx.issues.listComments` lesen die **gleichen** originalen Agentenantworten.
- Kein `ctx.agents.sessions.create`, kein separates History-Backend. Der Agentenchat bleibt im Haupt-UI sichtbar.

## Audio nur auf dem Host

```text
Smartphone/PC -- Tailscale HTTPS --> Paperclip-UI (Plugin-Slot)
  MediaRecorder + Audio-RMS-Silence-Detection
         | base64 JSON, max 2 MiB, signed-in user
         v
  Paperclip Plugin Worker (validates company, audio, issue)
         | HTTP localhost:8790
         v
    Voicebox (faster-whisper multilingual, Piper German)
         | transcription TEXT
         v
  Native Paperclip issues/comments API <-- auth browser cookie
         | durable normal issue, normal agent reply
         v
  Plugin reads verified agent comment --> local Voicebox TTS
         | WAV base64 via authenticated bridge
         v
  Browser WebAudio playback
```

## Sprache kurz, Arbeit vollständig

Die optionale knappe Antwortanweisung steht **sichtbar am Ende des Nutzerkommentars**. Es gibt keine globale Prompt-Änderung, keine versteckte Agent-Message. Die Sprachausgabe kürzt den gesprochenen Text deterministisch (ohne zusätzliches LLM), behält das volle Paperclip-Ergebnis im Chat. Dies ist bewusst nicht dieselbe Semantik wie ein kurz gefasster Systemprompt.

## Windows/Linux

Der Plugin-Code verwendet keine OS-Pfade oder Shellaufrufe. Voicebox läuft isoliert als Linux-Container sowohl unter Docker Desktop (Windows) als auch Docker Engine (Linux). Keine CUDA-/NVIDIA-Abhängigkeit. Erstes Docker-Image benötigt Internet für Modelle; spätere Nutzung ist offline-fähig.

## Bekannte Risiken

1. **SDK-Alpha:** `appShellOverlay` und Bridge-Version müssen bei Paperclip-Updates erneut validiert werden.
2. **Provider-Modell:** Upstream-Voicebox-Image ist englischsprachig; unser Dockerfile bäckt deutsche/multilinguale Modelle nach. Build noch nicht live verifiziert.
3. **Audio-Bandbreite:** WAV base64 über Paperclip-JSON-Bridge für kurze Antworten. Lange Podcasts nicht vorgesehen.
4. **Browser-Hintergrund:** Bildschirm-Sperre kann AudioContext und MediaRecorder unterbrechen.
5. **VAD bei Autofahrt:** einfaches RMS statt neural VAD; reale Fahrgeräusche können die Erkennung stören.
6. **Polling:** alle ~1,8–2,5 s; nach langer Sitzung oder Navigation langsamer oder unterbrochen. Vollständiger Event-Stream wäre eine Folgeoptimierung.
7. **Ablauf bei langer Aufgabe:** mehrere spätere Kommentare werden beobachtet, aber eine neue Antwort während aktiver Nutzersprache wird erst nach dem aktuellen Turn berücksichtigt.
8. **Automatisches Senden:** Transkriptionsfehler gelangen ggf. als Anweisung in Paperclip. Für risikoreiche Aufgaben Auto-Send deaktivieren; Approval-Regeln separat erzwingen.

## Öffentliche Weiterentwicklung

Zuerst Tests auf der unveränderten lokalen Paperclip-Instanz. Danach native SDK-Berechtigungen und Auth-Tests, bessere VAD, UI-Lokalisierung, optional browser-lokale Speech-TTS, gepufferte Statusantworten, Android-Hintergrundmodus (als eigenes Clientscope). Vor Release: Lizenzmatrix, Open-Source-Security-Audit, keine vertraulichen private company-Daten oder Pfade in veröffentlichtem Code.
