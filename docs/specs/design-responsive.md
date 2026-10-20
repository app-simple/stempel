# Spezifikation: Design und Bedienung auf dem Handy

Stand: 14.10.2026 · Status: **freigegeben am 14.10.2026**
Grundlage: Rückmeldung des Auftraggebers („Top-Menü nicht schön bedienbar“, „muss funktionieren wie eine native App, darf nicht nach links/rechts scrollen“), Bestandsaufnahme mit Screenshots auf 390 px und 1280 px, Entscheidungen in Abschnitt 9, `CLAUDE.md`, `prototype/index.html`
Branch: `design-responsive`, aufbauend auf `main`

## 1. Ziel

Die Anwendung fühlt sich auf dem Handy an wie eine native App: Navigation mit dem Daumen erreichbar, nichts abgeschnitten, keine Seite scrollt seitlich, kein ungewolltes Zoomen. Am Desktop bleibt der Aufbau mit Seitenleiste, aufgeräumt. Optisch ein Feinschliff mit Symbolen; Farben, Schrift und Texte aus dem Prototyp bleiben.

Nicht Teil: neue Funktionen, neue Farben oder Schriften, Änderungen an API oder Rechteprüfung, native Apps aus dem Store.

## 2. Befunde der Bestandsaufnahme

| Nr. | Befund | Wo |
| --- | --- | --- |
| B1 | Kopfzeile belegt auf dem Handy fast ein Viertel der Höhe (Titel, Name, Rolle, „Darstellung: wie System“, „Abmelden“ umbrechend) | alle Seiten |
| B2 | Menü ist ein seitlich wischbarer Streifen, der mitten im Wort abgeschnitten ist; weitere Punkte sind nicht erkennbar | alle Seiten |
| B3 | Urlaubsübersicht macht die ganze Seite 965 px breit | Urlaubsübersicht, Kalender |
| B4 | Tabellen scrollen in der Karte seitlich, Spalten abgeschnitten | Zeiten, Mitarbeiter, Prüfungen u. a. |
| B5 | Eingabefelder mit 15 px Schrift: iOS zoomt beim Antippen hinein, danach ist die Seite seitlich verschiebbar | alle Formulare |
| B6 | Karten auf „Heute“ stoßen ohne Abstand aneinander | Heute |
| B7 | Keine Abstände für Notch und Home-Leiste (Safe Areas) | alle Seiten |

## 3. App-Rahmen und Navigation

**Umschaltpunkt 1024 px.** Darunter Menü-Schublade, ab 1024 px feste Seitenleiste (bisher 821 px; ein iPad hochkant bekommt damit das Handy-Layout).

**Kopfleiste unter 1024 px:** 56 px hoch zuzüglich Safe Area oben, bleibt beim Scrollen stehen. Links Knopf ☰ („Menü öffnen“, `aria-expanded`, `aria-controls`), daneben der Name der aktuellen Seite aus den Routendaten. Gibt es offene Freigaben, zeigt der Knopf einen Zähler (Zahl im Namen des Knopfs für Screenreader). Die bisherige Kopfzeile entfällt.

**Schublade:** natives `<dialog>` mit `showModal()`, fährt von links herein, Breite `min(300px, 85vw)`, abgedunkelter Hintergrund. Schließt bei Tipp auf einen Menüpunkt, auf den Hintergrund und mit Escape; der Fokus kehrt zum Knopf ☰ zurück. Fokusfalle und gesperrter Hintergrund kommen vom Browser. Bei `prefers-reduced-motion` ohne Animation.

**Seitenleiste** (dieselbe Komponente in Schublade und am Desktop):
- oben „Zeit & Urlaub“ mit „Company OS“;
- Bereiche nach Rolle wie bisher (`navFor`), je mit Symbol; Zähler an „Freigaben“ wie bisher (auch der Fehlerfall „!“);
- unten der Kontobereich: Name, Rolle, Darstellung als Umschalter mit drei Optionen (System, Hell, Dunkel; Radiogruppe), „Abmelden“.

Am Desktop ist die Leiste 240 px breit, steht fest über die volle Höhe und scrollt bei Bedarf für sich. Der Inhalt hat höchstens 1100 px Breite.

**Native-App-Gefühl:**
- `viewport-fit=cover`, Innenabstände mit `env(safe-area-inset-*)`;
- Tippflächen für Knöpfe, Menüpunkte und Aufklapper mindestens 44 × 44 px;
- Eingabefelder unter 1024 px mit 16 px Schrift (kein Zoom unter iOS);
- `-webkit-tap-highlight-color: transparent`, `text-size-adjust: 100%`, `overscroll-behavior-x: none`;
- installierte App (Manifest aus Phase 5) läuft ohne Browserleiste; `theme-color` passt zu hell und dunkel.

Kein `overflow-x: hidden` auf `html` oder `body` als Pflaster: Überstand wird an der Ursache behoben und durch den Abnahmetest (Abschnitt 7) erkannt.

**Symbole:** `@lucide/angular`, als npm-Paket gebündelt, nichts zur Laufzeit von außen (CLAUDE.md). Nur einzeln importierte Symbole. Symbole sind dekorativ (`aria-hidden`), der Text bleibt immer sichtbar oder steht im zugänglichen Namen.

## 4. Tabellen

Unter 640 px zeigt jede Tabelle nur die wichtigsten Spalten. Jede Zeile bekommt am Ende einen Aufklapper (Knopf mit Pfeil-Symbol, `aria-expanded`, Name „Details zu …“); ein Tipp auf die Zeile oder den Knopf öffnet darunter eine Detailzeile über die volle Breite mit den übrigen Werten als Beschriftung und Wert sowie den Aktionen. Ab 640 px sieht alles aus wie bisher, ohne Aufklapper und Detailzeile.

Umsetzung als gemeinsamer Baustein (CSS-Klassen für Nebenspalten und Detailzeile, Zustand je Zeile mit Signals), damit alle Tabellen gleich funktionieren. Markierungen mit Bedeutung (Nachtrag, Hinweis, Status) bleiben sichtbar.

| Seite / Tabelle | Sichtbar unter 640 px | In der Detailzeile |
| --- | --- | --- |
| Zeiten: Woche | Tag, Kommen–Gehen, Arbeitszeit, Markierung Nachtrag | Pause, Soll, Saldo, Hinweise, Aktionen |
| Zeiten: Abwesenheiten | Tag, Art, Status | Entscheidung |
| Mein Urlaub | Zeitraum, Tage, Status | Art, Entscheidung, Aktionen |
| Urlaubsübersicht: Liste | Mitarbeiter, Von–Bis, Status | Art, Tage, Entschieden von |
| Urlaubsübersicht: Konten | Mitarbeiter, Rest | Anspruch, Übertrag, Korrekturen, Genehmigt, Beantragt |
| Mitarbeiter | Name, Rest, Status | Art, Std./Woche, Arbeitstage, Urlaub/Jahr, Vorgesetzte/r, Hinweise, Aktion |
| Mitarbeiter: Vertragsstände | Gültig ab, Art, Std./Woche | Arbeitstage, Urlaub, Stundenlohn, Soll/Tag, Aktion |
| Mitarbeiter: Urlaubskonto, Überstunden | Jahr bzw. Stichtag, Tage bzw. Stunden | Vermerk/Begründung, Zeitpunkt, Person |
| Prüfungen: Feststellungen | Datum mit Mitarbeiter (zweizeilig), Feststellung | Aktion |
| Prüfungen: Minijob | Mitarbeiter, Status | Zeitraum, Werktage, Ø je Werktag |
| Prüfungen: Urlaubshinweise | Mitarbeiter, Rest, Status | Wortlaut, Aktionen |
| Prüfungen: Verfall | Mitarbeiter, Tage, Status | Jahr, Verfallstag |
| Prüfungen: Nachträge | Mitarbeiter, Anteil, Status | Buchungen, Nachgetragen, Ø später erfasst |
| Feiertage | Datum, Name | Art, Aktion |
| Profil: Passkeys, Geräte | Gerät | Angelegt/Angemeldet, Zuletzt benutzt/erreicht, Aktion |

Die Spalten der Tabelle in „Heute“ (Team heute) passen bereits; sie werden nur geprüft.

## 5. Kalender (Urlaubsübersicht)

Unter 640 px Wochenansicht: Montag bis Sonntag der gewählten Woche, Namen links, Knöpfe „← Woche“, „Heute“, „Woche →“ und seitliches Wischen über dem Kalender zum Blättern (Schwelle 50 px, nur waagerechte Gesten; senkrechtes Scrollen bleibt unberührt). Überschrift „Oktober 2026 · KW 42“; über Monatsgrenzen hinweg werden die Daten des Nachbarmonats nachgeladen. Ab 640 px Monatsansicht wie bisher. Legende, Farben und der Grundsatz „kein Abwesenheitsgrund im Kalender“ bleiben.

## 6. Optik (Feinschliff)

- Symbole in der Navigation und an den wichtigsten Knöpfen: Kommen, Pause, Gehen, Export PDF/CSV, Wochen- und Monatswechsel, Aufklapper, Abmelden, Darstellung.
- Einheitliche Abstände zwischen Karten (auch die Banner in „Heute“), einheitlicher Seitenkopf (Überschrift, Einleitung, Aktionen rechts bzw. unter 640 px darunter).
- Formulare unter 640 px einspaltig, Knöpfe mindestens 44 px hoch; Knopfgruppen brechen sauber um.
- Farben, Schrift, Texte und Fachlogik bleiben unverändert.

## 7. Tests und Abnahme

- **Neuer Abnahmetest (Playwright):** jede Seite für jede Rolle (Mitarbeiter, Vorgesetzte, Admin, Minijob) auf 360 px Breite und auf 768 px: `scrollWidth` des Dokuments gleich der Breite des Fensters; Schublade öffnen, Menüpunkt wählen, Schublade geschlossen, Fokus zurück; Escape schließt.
- **Komponententests:** Seitenleiste (Rollen, Zähler, Darstellungsumschalter, Abmelden), Schublade (öffnen, schließen, Fokus), Tabellen-Baustein (Aufklappen per Tipp und Tastatur, `aria-expanded`), Wochenansicht des Kalenders (Blättern, Monatsgrenze, Wischen).
- **Bestehende Tests** laufen weiter; Abnahmetests verwenden Desktop-Breite und die Navigation über `getByRole('navigation')` bleibt erhalten.
- **Sichtprüfung:** Screenshots aller Seiten auf 390 px und 1280 px, hell und dunkel, vor dem Codex-Review.

## 8. Arbeitspakete

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Grund-CSS (Safe Areas, 16 px, Tippflächen, Abstände), `@lucide/angular`, App-Rahmen mit Kopfleiste, Schublade, Seitenleiste, Kontobereich | Claude | Komponententests, Screenshots |
| 2 | Tabellen-Baustein, umgesetzt an „Zeiten“ als Muster | Claude | Komponententests |
| 3 | Übrige Tabellen nach dem Muster aus AP 2 gemäß Abschnitt 4 | Codex (Worktree), Prüfung Claude | Komponententests je Seite |
| 4 | Wochenansicht des Kalenders | Codex (Worktree), Prüfung Claude | Komponententests |
| 5 | Feinschliff Abschnitt 6, Abnahmetest Abschnitt 7, Sichtprüfung | Claude | Abnahmetest grün |
| 6 | Codex-Review, Befunde unter `docs/reviews/design-responsive.md` | Codex, Claude | alle Befunde bewertet |

## 9. Entscheidungen

| Nr. | Frage | Entscheidung (14.10.2026) |
| --- | --- | --- |
| 1 | Navigation auf dem Handy | Menü-Schublade mit ☰ |
| 2 | Desktop | feste Seitenleiste, Konto unten darin, keine Kopfzeile |
| 3 | Tabellen auf dem Handy | weniger Spalten, Details per Tipp auf die Zeile |
| 4 | Kalender auf dem Handy | Wochenansicht |
| 5 | Umfang der Optik | Feinschliff mit Symbolen (lokal gebündelt), Farben und Schrift bleiben |
