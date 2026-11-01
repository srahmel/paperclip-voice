# Paperclip Voice — lokaler Sprachmodus für bestehende Paperclip-Chats

**Status: funktionaler Quellcode-Prototyp, nicht produktiv end-to-end verifiziert.**

Paperclip Voice ist eine separat installierbare **Paperclip-Plugin-Extension** für **Windows und Linux**. Sie verwendet die normalen Paperclip-Agenten-Chats und Aufgabenkommentare, statt eine zweite Chatdatenbank oder eigene LLM-Sessions anzulegen. Spracheingabe wird lokal mit multilingualem Whisper transkribiert; Piper erzeugt lokal Sprache aus den regulären Agentenantworten.

**Kein Speko, keine kostenpflichtige STT-/TTS-API, keine zusätzlichen LLM-Aufrufe für Audio.** Paperclips normale Agenten-/LLM-Nutzung und Systemressourcen kosten weiterhin Geld. „Lokal“ heißt: Audio wird auf dem Paperclip-Server verarbeitet; ein Smartphone übermittelt Audio über die bestehende HTTPS/Tailscale-Verbindung dorthin. Es erfolgt keine STT/TTS-Verarbeitung beim Sprachprovider im Internet.

## Was der Prototyp bietet

- Permanentes Voice-Overlay (`appShellOverlay`) in Paperclip, ohne Core-Fork.
- Automatische Pausenerkennung (Audio-RMS-VAD, **keine Sprecheridentifikation**) und wiederholte Aufnahmen.
- Transkription per `faster-whisper`/Voicebox, Deutsch und Englisch konfigurierbar.
- Anweisung im **bestehenden** Paperclip-Issue oder offiziellen Agenten-Chat, durch denselben authentifizierten Benutzer.
- Antworten stammen aus **denselben** Paperclip-Issue-Kommentaren. Fortschritts- und spätere Antworten werden weiterhin beobachtet und können vorgelesen werden.
- Lokale Piper-TTS über eine vorhandene OpenAI-kompatible Voicebox-API.
- Kurze mündliche Ausgabe: lange Agentenantworten werden nur **für TTS** gekürzt; die vollständige Antwort bleibt im Paperclip-Chat erhalten.
- Optionale sichtbare Anweisung für kurze Agentenantworten, nur an die jeweils per Sprache versendete Nachricht angehängt. **Keine** dauerhafte Änderung von `AGENTS.md` oder der Systemprompts.
- Auto-Send, manuelle Transkriptprüfung, weitere Anweisung während Wartezeiten, Stopp und konfigurierbare Geräuschschwelle.
- Docker-Audiodienst läuft auf Windows Docker Desktop und Linux Docker Engine, CPU-Standard; keine NVIDIA-GPU notwendig.

## Was noch nicht belegt ist

- Keine Live-End-to-End-Verifikation mit einer tatsächlichen Paperclip-Instanz, einem Mikrofon, einem Browser und dem deutschen Voicebox-Modell in dieser Entwicklungsumgebung.
- Paperclip-Version und Plugin-SDK müssen **gegen deine installierte Version** abgeglichen werden. Das Projekt orientiert sich an der 2026.1023.0-Plugin-SDK.
- Der aktuelle Sprachmodus ist turn-basiert. Er ist keine echtzeitfähige Full-Duplex-Telefonie mit unterbrechungsfreier Barge-in-Erkennung.
- Mobile Browser pausieren Mikrofon und WebAudio unter Umständen, wenn das Display gesperrt ist. Ein echtes Android-Hintergrund-/Android-Auto-Erlebnis ist damit nicht garantiert.
- Die RMS-basierte Pausenerkennung kann bei hohem Fahrgeräusch falsch auslösen. Für Produktivbetrieb im Auto sollten reale Mobil-/Fahrgeräuschtests und ggf. Silero-VAD folgen.
- Die voreingestellte Sprachdatei `de_DE-thorsten-medium` und das Whisper-Modell werden beim ersten Image-Build heruntergeladen. Model-Lizenz und Qualität vor öffentlicher Distribution separat prüfen.

## Voraussetzungen

- **Paperclip** selbst betrieben, lokale Plugin-Installation freigeschaltet, Agent Chat ggf. in *Experimental settings* aktiviert.
- Node.js **24.11+** und npm auf dem Paperclip-Host.
- Docker Engine (Linux) oder Docker Desktop im Linux-Container-Modus (Windows).
- Ein Browser mit `MediaRecorder`, `getUserMedia` und `AudioContext`, z. B. aktuelle Versionen von Edge/Chrome.
- Browserzugriff über `https://` oder `localhost` (Mikrofon-Zugriff benötigt einen sicheren Kontext).
- Wenn mobil: bestehendes Tailscale **Serve** HTTPS reicht. **Funnel ist nicht notwendig**. Voicebox selbst **nicht öffentlich** erreichbar machen.

## 1. Voicebox auf dem Paperclip-Host starten

Windows **PowerShell** (in einem Terminal mit Docker Desktop und Git):

```powershell
cd C:\Pfad\zu\paperclip-voice
# Bildet ein Docker-Image mit multilingualem Whisper-Small und deutscher Piper-Stimme.
docker compose -f voicebox/compose.yaml up -d --build
curl.exe http://127.0.0.1:8790/health
```

Linux:

```bash
cd /pfad/zu/paperclip-voice
docker compose -f voicebox/compose.yaml up -d --build
curl -f http://127.0.0.1:8790/health
```

Erwartet: JSON mit `status: "ok"` und `models_loaded: true`. Die Build-Phase benötigt einmalig Internetzugriff und lädt zusätzlich zu den Standardmodellen ein mehrsprachiges STT-Modell und eine deutsche Stimme. **Nicht** einfach das unveränderte Upstream-Image starten: Sein Whisper-Standardmodell ist nur englischsprachig.

Verfügbarkeit: `127.0.0.1:8790` **auf dem Paperclip-Host**. Die Compose-Datei veröffentlicht den Docker-Port ausschließlich auf der Loopback-Schnittstelle. Falls Paperclip selbst als Container läuft, muss die Loopback-Topologie angepasst werden, ohne den Audiodienst öffentlich zu exponieren; die aktuelle Konfiguration ist für Paperclip direkt auf dem Host ausgelegt.

## 2. Plugin installieren

```bash
npm install
npm run check
npx paperclipai plugin install --local /ABSOLUTER/PFAD/paperclip-voice
npx paperclipai plugin list
```

Unter Windows z. B.:

```powershell
cd C:\Projects\paperclip-voice
npm install
npm run check
npx paperclipai plugin install --local "C:\Projects\paperclip-voice"
npx paperclipai plugin list
```

Bei einer lokal angepassten Paperclip-Quellinstallation **vorher** `paperclipai plugin target` prüfen. Den installierten Paperclip-Quellstand nicht ungeprüft aktualisieren. Das Plugin enthält **keine** Anpassung am Core, an Agentenpromptdateien oder am bestehenden Windows-Watchdog.

Unternehmens-/Instanzeinstellungen → Plugins → **Paperclip Voice (Local)**. Standard: `http://127.0.0.1:8790`, `de`, `de_DE-thorsten-medium`, TTS-Limit 380 Zeichen. Falls `Voicebox nicht erreichbar`, zuerst Docker-Health prüfen.

## 3. Bedienung

1. In Paperclip den bestehenden Alex-Chat oder eine konkrete Aufgabe öffnen (oder im Overlay den gewünschten Agenten auswählen).
2. Unten rechts **Voice** öffnen und **Sprachmodus starten** wählen. Mikrofonzugriff erlauben.
3. Sprechen und eine kurze Pause machen. Nach ca. 1,25 s Stille wird die Äußerung transkribiert und (mit Auto-Send) als normaler Paperclip-Kommentar verschickt.
4. Die lokale Sprachausgabe bestätigt die Übermittlung und liest die nächste neue Agentenantwort vor.
5. Der Agent kann seine normale Arbeit fortsetzen. Das Voice-Overlay beobachtet später eintreffende Kommentare im **selben** Issue und spricht diese vor, solange der Voice-Modus läuft und der Browser die Audio-/Mikrofonsitzung nicht suspendiert.
6. **Stoppen** schließt Mikrofon- und Audiogeräte und beendet das Polling.

Bei aktivierter Option „Knappe Antworten anfordern“ hängt das Plugin einen kurzen, **sichtbaren** Zusatz an die jeweilige Sprachnachricht an. Das ist keine versteckte Systemanweisung. Die normalen Aufgaben bleiben unverändert. Wer den Zusatz nicht im Chat sehen möchte, deaktiviert die Option; die TTS-Ausgabe wird trotzdem lokal gekürzt.

## Sicherheit und Transparenz

- **Keine öffentliche Audio-API.** Der Browser redet ausschließlich mit Paperclips authentifizierter HTTPS-Origin. Der Plugin-Worker redet mit Voicebox über `127.0.0.1`.
- Das Plugin erlaubt keine frei wählbaren externen Audio-URLs: SSRF-Schutz erzwingt Loopback und einen unprivilegierten Port.
- Audioschnipsel sind auf 2 MiB begrenzt und werden nicht absichtlich gespeichert. Das Plugin protokolliert weder Audio noch Transkript.
- Paperclip speichert gesprochene Anweisungen als **normale Textkommentare** wie alle anderen Chatnachrichten. TTS-Text wird nur temporär im Speicher verarbeitet.
- Die endgültigen Entscheidungen über Änderungen, Zahlungen, Freigaben usw. liegen weiter bei Paperclip, dessen Agenten und den bestehenden Approval-Regeln. Eine Transkription darf keine Freigabekontrolle umgehen.
- Ein unbestätigtes `5xx` nach dem Senden wird **nicht automatisch erneut geschickt**: Paperclip kann die Nachricht bereits gespeichert haben.
- Bei öffentlichen Releases müssen die `piper-tts`-GPL-Lizenz und die Modelllizenzen geprüft werden. Unser MIT-Code bündelt die Audiobibliotheken nicht; die Docker-Datei baut ein getrenntes Image, für das gesonderte Pflichten gelten.

## Entwicklung

```bash
npm test                  # isolierte Node-Testfälle ohne Paperclip oder Modelle
npm run typecheck         # benötigt die exakte SDK-/React-Umgebung
npm run build             # Paperclip-kompatible manifest/worker/ui-Bundles
npm run check
```

CI enthält Windows-/Linux-Matrix unter `.github/workflows/ci.yml`. Für den echten Acceptance-Test siehe [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## Verwandte bestehende Open-Source-Projekte

- [denour/paperclip-plugin-tts](https://github.com/denour/paperclip-plugin-tts): Bestehende Paperclip-Kommentare manuell vorlesen. In dieser Lösung *nicht* eingebaut oder vendored.
- [agjs/voicebox](https://github.com/agjs/voicebox): Vorhandener lokaler STT-/TTS-Dienst (MIT; benutzt separat lizenzierte Abhängigkeiten).
- [mvanhorn/paperclip-plugin-slack](https://github.com/mvanhorn/paperclip-plugin-slack): Externe Slack-Audio-zu-Task-Workflows; keine native vollautomatische Paperclip-UI-Sprachsteuerung.
- [paperclipai/paperclip](https://github.com/paperclipai/paperclip): offizieller Paperclip-Core und Alpha-SDK.

## Lizenz

MIT für dieses Plugin. Whisper/Piper/Voicebox haben eigenständige Lizenzen. Keine Sprachmodelle, Audio-Dateien oder Secrets gehören ins Git-Repository.
