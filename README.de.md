# Paperclip Voice

Lokales Diktieren und Vorlesen für bestehende Paperclip-Aufgaben und Agentenchats.
Version 0.2 benötigt keine Änderungen am Paperclip-Kern. Das Plugin setzt per
JavaScript ein Mikrofon und einen Vorlese-Button neben das Plus der Eingabeleiste.
Das Mikrofon öffnet Diktat für genau diese Eingabe, auch im Fenster „New Task“.
Nach der Textvorschau ergänzt „In Eingabe übernehmen“ den vorhandenen Entwurf;
es wird nichts automatisch gesendet oder angelegt. Der Lautsprecher liest die
letzte zugängliche Agentenantwort, ohne dabei einen Chat anzulegen.

Der allgemeine Sprachmodus steht links direkt unter „Chat“. Dort lässt sich
ein bestehender Task oder Agentenchat auswählen. Ein kleiner, begrenzter
DOM-Adapter sorgt für die Positionierung. Wenn Paperclip seine Struktur ändert
oder die Zuordnung nicht eindeutig ist, bleibt der offizielle Toolbar-Einstieg
als Rückfall erhalten. Es werden keine internen React-/Editor-Objekte verwendet.

Das Transkript wird zunächst zur Prüfung angezeigt. Automatisches Senden ist
optional; importierte Aufnahmen bleiben immer in der Textvorschau. Stoppen,
Schließen oder ein Seitenwechsel beendet Aufnahme und Wiedergabe.

Der Python-Backend verwendet eine vorhandene lokale Whisper-/Piper-Installation.
Python- und Modellpfade sind in den Plugin-Einstellungen konfigurierbar;
bestehende PAPERCLIP_VOICE_*- und PAPERCLIP_TTS_*-Einstellungen dienen als Vorgabe.
Audioverarbeitung läuft im Plugin-Worker mit begrenzten Unterprozessen, ohne
zusätzlichen Port. Die ausführliche [englische Anleitung](README.md) beschreibt
Installation und die getrennte Abnahme von Mikrofon und Mobilgeräten.
