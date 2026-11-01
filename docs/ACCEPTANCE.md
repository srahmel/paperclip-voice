# Akzeptanzplan (Live-Tests noch offen)

**Nicht als bestanden markieren, bevor der jeweilige Test auf einer echten Instanz durchgeführt wurde.**

## Windows und Linux (identischer Ablauf)

- [ ] Paperclip-Plugin-API-Version passt; `npm run check` läuft ohne Fehler.
- [ ] Voicebox-Image baut mit `Systran/faster-whisper-small`, `de_DE-thorsten-medium`, `/health` meldet `models_loaded:true`.
- [ ] `docker compose ... ps` zeigt Voicebox healthy; Port nur `127.0.0.1:8790`; kein Internet-/LAN-Zugriff auf Voicebox.
- [ ] Plugin wird `ready`, der globale Button bleibt beim Navigieren erhalten, normale Paperclip-Oberfläche unverändert.
- [ ] Alex-Chat in normaler UI öffnen, Voice startet nach Mikrofonberechtigung, Aufnahme stoppt nach Sprechpause.
- [ ] Gesprochene Nachricht erscheint im **gleichen** Alex-Chat als menschlicher Kommentar; kein neues isoliertes SDK-Session-Gespräch.
- [ ] Ein normales Agenten-Herzschlag-/Task-Event wird ausgelöst. Keine Doppelkommentare bei Netzfehler.
- [ ] Neue Agentenantwort erscheint normal im Chat und wird in deutscher Sprache vorgelesen; Inhalt im Chat bleibt vollständig.
- [ ] Späterer Agentenkommentar (nicht nur erste Bestätigung) wird auch im laufenden Sprachmodus vorgelesen.
- [ ] Während Agentenarbeit kann eine weitere Anweisung geschickt werden, ohne eine zweite Konversation zu erzeugen.
- [ ] Ohne Auto-Send ist das Transkript vor dem Absenden editierbar.
- [ ] Stopp entzieht den MediaStream-Tracks die Ressourcen, löscht lokale In-Memory-Puffer und stoppt TTS.
- [ ] Agentenfreigaben, Budget-/Rechte-Grenzen und Prompts bleiben unverändert.
- [ ] Plugin-Update oder Uninstall lässt sämtliche Chat-/Task-Daten unverändert und normales Chatten weiter funktionieren.

## Mobil via Tailscale HTTPS

- [ ] Android Chrome via Tailscale Serve, HTTPS vertrauenswürdig, Mikrofon erlaubt.
- [ ] Browser darf Audio nach einer Nutzerinteraktion wiedergeben. Bei gesperrtem Display testweise weiterlaufen lassen: unterstützte/unterbrochene Zustände dokumentieren.
- [ ] Test mit Fahrgeräuschen, kurzen Pausen, Unterbrechungen und Freisprecheinrichtung nur im Stand durchführen.
- [ ] Mobiles Mikrofon übersetzt keine Umgebungsstimmen unkontrolliert in Aktionen; Freigaben bleiben aktiv.

## Grenzen des jetzigen Quellstands

- HTML/React-Plugin, SDK-Build und echte Voicebox-Endpunkte wurden in der Erstellungsumgebung **nicht** mit Dependencies integriert getestet.
- Die Testfälle decken die portablen Hilfsfunktionen ab, keine Browsertestautomatisierung.
- Fehlertoleranz, Berechtigungen und eine Unterbrechungsstrategie für Barge-in brauchen vor dem öffentlichen Release reale Tests.
