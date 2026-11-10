# Kochplaner – Angebote & Rezepte

Web-App: https://my-project-26.github.io/Nahrungsmittel/

Die App holt die Wochenangebote deiner Märkte (Raum Villingen-Schwenningen) und schlägt passende Rezepte vor. Dabei berücksichtigt sie Küchengeräte, Haushalt, Bio, Ernährungsform, Jahreszeit, Kochzeit, deinen Vorrat (mit MHD) und deine Ausschlussliste.

## Einrichtung n8n (einmalig)

1. In n8n: **Workflows → Import from File** → `n8n/kochplaner-workflow.json` wählen.
2. Den Node **Konfiguration** öffnen und deinen Gemini-Schlüssel eintragen (aistudio.google.com → „Get API key“). Alternativ `anbieter: 'anthropic'` mit Anthropic-Schlüssel.
   Optional: für EDEKA, REWE und Kaufland die Angebotsseite deines Markts eintragen.
3. Den Workflow speichern und oben rechts auf **Active** schalten.
4. In der App unter **Profil → Verbindung zu n8n** die Adresse `http://localhost:5678/webhook/koch` eintragen und auf „Verbindung testen“ tippen.
   Am besten Chrome nutzen und die Abfrage „Zugriff auf lokales Netzwerk“ erlauben.

Tipp: Bricht das Aktualisieren nach 5 Minuten ab, n8n mit `N8N_RUNNERS_TASK_TIMEOUT=900` starten.

## Preissicherheit

| Quelle | Prüfung | In Rezepten |
|---|---|---|
| Text von der Händlerseite (ALDI, NORMA, EDEKA, ggf. REWE/Kaufland) | Preis muss wörtlich auf der Seite neben dem Produkt stehen, dazu Rechenprobe mit dem Grundpreis. Sonst wird das Angebot verworfen. | automatisch ✅ |
| Prospekt-/Flyer-Foto (Lidl, Netto, Penny, denn's, Biowelt, Wochenmarkt) | Zwei unabhängige Lesedurchgänge und Rechenprobe mit dem Grundpreis, unsichere Angebote werden rot markiert | erst nach deiner Bestätigung („Preis stimmt“) ⚠️ |

## Zeitplan

n8n ruft die Angebote **sonntags und mittwochs um 18 Uhr** ab, wenn der Laptop an ist. Ist ein Abruf ausgefallen, holt die App ihn beim Öffnen nach.
