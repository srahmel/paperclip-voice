# Paperclip Voice – lokale Spracheingabe und Sprachausgabe

**Open-Source-Sprachmodus für die bestehenden Paperclip-Chats und Aufgaben auf Windows und Linux.**

**Status: experimentelle Alpha-Version 0.1.1.** Automatisierte Tests ersetzen keinen Praxistest mit deiner Paperclip-Installation, einem Mikrofon und einem Lautsprecher.

Die aktive Implementierung **verändert den Paperclip-Core nicht**: Sie verwendet den offiziellen `appShellOverlay`-Slot, die authentifizierte Plugin-Bridge und die normalen Chat-/Issue-Kommentar-APIs. Whisper verarbeitet deine Spracheingabe, Piper spricht Agentenantworten. Es entstehen keine zusätzlichen Sprach-API-Gebühren; Paperclips normale LLM- und Infrastrukturkosten bleiben bestehen.

[English README](README.md) · [Architektur](docs/DESIGN.md) · [Abnahmetests](docs/ACCEPTANCE.md) · [Sicherheit](SECURITY.md)

## Funktionen

- Schwebendes Voice-Bedienfeld innerhalb von Paperclip, mit bestehendem Agentenchat oder vorhandener Aufgabe als Ziel.
- Deutsch/Englisch, automatische Pausenerkennung und optionales automatisches Absenden.
- Die gesprochene Anweisung erscheint als **normaler Paperclip-Kommentar** im selben Verlauf.
- Antworten und spätere Agentenkommentare werden aus dem **gleichen** Verlauf vorgelesen.
- Nach der Antwort optional erneut zuhören; keine zusätzlichen LLM-Sessions, keine zweite Datenbank.
- Der Agent behält seine Prompts, Tools, Budgetgrenzen und Freigaben; nur eine sichtbare Bitte um eine kurze Antwort kann an die jeweilige gesprochene Anweisung angehängt werden.
- Die vollständige Antwort bleibt im Chat; nur die vorgelesene Fassung wird lokal gekürzt.

## Voraussetzungen

- Paperclip mit unterstützter Plugin-SDK v1 und `appShellOverlay`; Agent Chat gegebenenfalls in den experimentellen Einstellungen einschalten.
- Node.js mindestens 24.11, npm, Git.
- Docker Desktop unter Windows (Linux-Container) oder Docker Engine unter Linux.
- Chrome oder Edge über `localhost` oder vertrauenswürdiges HTTPS. Bei mobilem Zugriff genügt **Tailscale Serve**; **Funnel ist nicht erforderlich**.
- Paperclip muss für die vorkonfigurierte Loopback-Anbindung **direkt auf dem Docker-Host** laufen. Eine containerisierte Paperclip-Instanz erfordert eine angepasste private Netzwerkverbindung.

## Installieren, ohne Paperclip zu patchen

**1. Plugin holen und prüfen**

```bash
git clone https://github.com/srahmel/paperclip-voice.git
cd paperclip-voice
npm install
npm run check
```

**2. Lokale Audio-Engine starten**

```bash
docker compose -f voicebox/compose.yaml up -d --build
docker compose -f voicebox/compose.yaml ps
curl http://127.0.0.1:8790/health
```

Unter Windows für den letzten Befehl `curl.exe` verwenden. Erwarte `"status":"ok"` und `"models_loaded":true`. Der erste Build lädt Modelle herunter. Voicebox bleibt ausschließlich auf `127.0.0.1:8790` erreichbar und darf nicht im LAN oder Internet veröffentlicht werden.

**3. Richtiges Paperclip-Ziel kontrollieren und Plugin installieren**

```bash
npx paperclipai plugin target
npx paperclipai plugin install --local /absoluter/pfad/zu/paperclip-voice
npx paperclipai plugin list
```

Windows PowerShell aus dem Plugin-Verzeichnis:

```powershell
npx paperclipai plugin target
npx paperclipai plugin install --local (Get-Location).Path
npx paperclipai plugin list
```

Wenn `plugin target` die falsche Instanz nennt: **abbrechen, nicht installieren**. Nach der Installation soll `paperclip-plugin-voice` als `ready` erscheinen. Falls der Windows-Plugin-Loader scheitert, zunächst Fehler und Paperclip-Version dokumentieren; **keinen Patch aus `dictation/` automatisch anwenden**.

**4. Erster Test**

Öffne einen vorhandenen Agentenchat oder eine Aufgabe, dann unten rechts **Voice**. Wähle den Agenten, starte den Sprachmodus und diktiere eine harmlose Anweisung. Prüfe, dass der Text im selben Chat erscheint und die neue Agentenantwort vorgelesen wird.

Bei aktiviertem Auto-Send führt eine fehlerhafte Transkription möglicherweise zu einer echten Agentenanweisung. Daher zuerst mit Auto-Send **aus** testen und Transkripte prüfen. Freigaben bleiben in Paperclip.

## Technische Architektur

```text
Smartphone / Browser
    ↕ (bestehende HTTPS-Paperclip-Session)
Paperclip Voice Plugin / authentifizierte Plugin-Bridge
    ↕ lokale Auftrags- und Statusabfragen
Voicebox 127.0.0.1:8790 – Whisper STT / Piper TTS
    ↕
Reguläre Paperclip-Agenten-Chats, Issues und Kommentare
```

Audio läuft über zeitlich begrenzte, asynchrone Plugin-Jobs: Eine Transkription darf länger als das 30-Sekunden-Limit einer normalen Paperclip-Plugin-Aktion dauern. Die Audio-Engine benötigt keinen zusätzlichen öffentlich erreichbaren Port.

Die ältere Implementierung unter `dictation/` enthält **optionale Legacy-Patches** für Installationen mit eigenen Core-Modifikationen. Sie gehört **nicht** zum Installationsweg dieses Plugins und wird nicht automatisch angewendet.

## Bekannte Grenzen

- Noch keine bestätigte Live-End-to-End-Installation auf deinem Paperclip-Windows-System; ein grüner CI-Build beweist das nicht.
- Android-Browser können Aufnahme und Wiedergabe bei gesperrtem Bildschirm unterbrechen. Vollautomatische Bedienung im Auto ist daher noch **nicht** garantiert.
- Einfache RMS-basierte Pausenerkennung kann bei Motor- oder Freisprechgeräuschen versagen.
- Quellcode MIT; Voicebox, Piper und Sprachmodelle haben eigene Lizenzbedingungen. Nicht ohne Lizenzprüfung als kombinierte Docker-Images weiterverbreiten.

Die konkreten Testschritte stehen unter [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).
