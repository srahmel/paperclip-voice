# Paperclip Voice

Lokales Diktieren und Vorlesen für bestehende Paperclip-Aufgaben und Agentenchats.
Version 0.2 benötigt keine Änderungen am Paperclip-Kern. Der Einstieg erfolgt
über die offizielle globale oder Aufgaben-Werkzeugleiste, die Bedienung in einem
eigenen Plugin-Panel. Der native Chat-Editor bleibt unverändert.

Das Transkript wird zunächst zur Prüfung angezeigt. Automatisches Senden ist
optional; importierte Aufnahmen bleiben immer in der Textvorschau. Stoppen,
Schließen oder ein Seitenwechsel beendet Aufnahme und Wiedergabe.

Der Python-Backend verwendet eine vorhandene lokale Whisper-/Piper-Installation.
Python- und Modellpfade sind in den Plugin-Einstellungen konfigurierbar;
bestehende PAPERCLIP_VOICE_*- und PAPERCLIP_TTS_*-Einstellungen dienen als Vorgabe.
Audioverarbeitung läuft im Plugin-Worker mit begrenzten Unterprozessen, ohne
zusätzlichen Port. Die ausführliche [englische Anleitung](README.md) beschreibt
Installation und die getrennte Abnahme von Mikrofon und Mobilgeräten.
