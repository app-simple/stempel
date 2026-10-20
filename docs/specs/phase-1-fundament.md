# Spezifikation Phase 1: Fundament

Stand: 12.10.2026 · Status: **freigegeben am 12.10.2026** mit den Entscheidungen in Abschnitt 13
Grundlage: `docs/KONZEPT.md`, `CLAUDE.md`, `prototype/index.html`, `docs/PROMPT-PHASE-1.md`

## 1. Ziel

Lauffähiges Grundgerüst des Moduls Zeit & Urlaub: Workspace, Datenbank, Anmeldung ohne Passwort, Rollen mit Rechteprüfung im Backend, Mitarbeiterstamm mit Vertragsständen, Feiertage Bayern, gesetzliche Werte als Daten, erste Regelfunktionen, App-Shell im Web.

Nicht in Phase 1: Zeitbuchungen, Urlaubsanträge, Kalender, Prüfungen, Export, Urlaubskonten (Ledger), Deployment.

## 2. Stack und Versionen

| Bereich | Wahl |
| --- | --- |
| Workspace | Nx 23, pnpm, Node 24 LTS, TypeScript strict (zusätzlich `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`) |
| API | NestJS 11 (von Nx 23 unterstützt), Prisma 7 (stabile Linie, Treiber-Adapter `@prisma/adapter-pg`), PostgreSQL 17 |
| Web | Angular 22, Standalone Components, Signals, zoneless, Tailwind 4 (CSS-first `@theme`) |
| Anmeldung | `@simplewebauthn/server` und `@simplewebauthn/browser` 14, Nodemailer für den Code-Versand |
| Schriften | `@fontsource/ibm-plex-sans` und `@fontsource/ibm-plex-mono`, beim Build gebündelt, keine externen Server |
| Tests | Nx-Standard je Projektart (Vitest für Libs und Web, Jest für die API, falls der Nest-Generator es so anlegt), Supertest gegen echte Test-DB, Playwright für die Abnahme-Ende-zu-Ende-Tests |
| Qualität | ESLint (flat config, `@nx/enforce-module-boundaries`), Prettier |
| Lokal | Docker Compose: PostgreSQL und Mailpit |
| CI | GitHub Actions |

Modulgrenzen (Nx-Tags): `libs/time-rules` darf nichts importieren außer Typen aus `libs/shared`. `libs/shared` hat keine Abhängigkeiten. `apps/web` darf `time-rules` und `shared` nutzen, nie `apps/api`.

## 3. Arbeitspakete

Jedes Paket endet mit grünen Lint- und Testläufen, Commit und Push, danach Codex-Review (Befund unter `docs/reviews/`, Eintrag in `docs/reviews/codex-log.md`). Commits laufen auf `phase-1-fundament`, Codex arbeitet auf eigenen Branches in eigenen Worktrees (`codex/<aufgabe>`), die ich nach Prüfung einmerge.

| AP | Inhalt | Wer | Abnahme |
| --- | --- | --- | --- |
| 1 | Nx-Workspace, apps/api, apps/web, libs/time-rules, libs/shared, Strict-TS, ESLint, Prettier, Docker Compose, `.env.example`, Startskript `pnpm dev` | Claude | `pnpm dev` startet DB, Mailpit, API, Web. Lint und Tests grün. |
| 2 | CI-Workflow (Lint, Test, Build, API-Tests mit Postgres-Service) | Codex | Workflow läuft auf dem Branch grün |
| 3 | `libs/time-rules`: Typen und Signaturen (Claude), Implementierung und Tests der fünf Funktionen (Codex), Review und Übernahme (Claude) | Claude + Codex | Jede Funktion nennt ihren Paragrafen, Grenzwerttests grün |
| 4 | Prisma-Schema, erste Migration, Seed (gesetzliche Werte, Feiertage, Einstellungen, Beispielmitarbeiter) | Schema: Claude, Seed-Daten: Codex | `prisma migrate deploy` und Seed laufen auf leerer DB |
| 5 | Anmeldung: E-Mail-Code, Sitzung, Passkeys, Rate-Limit, Protokoll | Claude, Review Codex | Tests für alle Grenzfälle aus Abschnitt 6 |
| 6 | Rollen und Rechteprüfung: Guards, zentrale Abfragefilter, Zugriffsmatrix-Test über alle Routen | Claude, Review und Zusatztests Codex | Jede Route hat einen Test mit falscher Rolle |
| 7 | Mitarbeiterverwaltung, Vertragsstände, gesetzliche Werte, Feiertage und Einstellungen als API | Claude, Feiertags-API ggf. Codex | Urlaub unter Minimum wird mit 422 abgelehnt |
| 8 | Web: Theme hell/dunkel, App-Shell, Anmeldeseiten, Profil mit Passkeys, Mitarbeiterseiten, Feiertage | Claude (Anmeldung, Shell), Codex (Mitarbeiter- und Feiertagsseiten nach Vorgabe) | Formular lehnt Urlaub unter Minimum ab, Navigation nach Rolle |
| 9 | Playwright-Abnahmetest (Code über Mailpit, Passkey mit virtuellem Authenticator), Dockerfiles api/web, README, Befehle in CLAUDE.md | Claude, Dockerfiles Codex | Abnahmekriterien aus Abschnitt 10 erfüllt |

## 4. Datenmodell (Prisma-Entwurf)

Grundsätze: IDs als UUID. Zeitpunkte als `timestamptz` in UTC. Kalendertage (Eintritt, gültig ab, Feiertag) als `date`. Geldbeträge in Cent als `Int`, Wochenarbeitszeit in Minuten als `Int` (38,5 Std. = 2310), damit keine Rundungsfehler entstehen.

```prisma
enum Role { EMPLOYEE LEAD ADMIN }
enum EmploymentType { FULL_TIME PART_TIME MINIJOB }
enum LoginMethod { EMAIL_CODE PASSKEY }
enum ChallengePurpose { PASSKEY_REGISTRATION PASSKEY_LOGIN }
enum LegalParameterKey { MIN_WAGE_HOURLY_CENTS MINIJOB_MONTHLY_LIMIT_CENTS }

model Employee {
  id            String    @id @default(uuid()) @db.Uuid
  name          String
  jobTitle      String?                       // „Funktion“ im Prototyp
  role          Role      @default(EMPLOYEE)
  loginEmail    String    @unique             // klein geschrieben gespeichert, nur Admin sieht und ändert sie
  leadId        String?   @db.Uuid            // Vorgesetzte/r
  deputyId      String?   @db.Uuid            // Vertretung des Vorgesetzten (Konzept Abschnitt 3)
  entryDate     DateTime  @db.Date
  exitDate      DateTime? @db.Date              // ab dem Folgetag automatisch gesperrt
  lockedAt      DateTime?                     // manuelle Sperre durch den Admin, unabhängig vom Austritt
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  lead          Employee?  @relation("Lead", fields: [leadId], references: [id])
  reports       Employee[] @relation("Lead")
  deputy        Employee?  @relation("Deputy", fields: [deputyId], references: [id])
  deputyFor     Employee[] @relation("Deputy")
  terms         EmploymentTerms[]
  carryOvers    LeaveCarryOver[]
  loginCodes    LoginCode[]
  passkeys      Passkey[]
  sessions      Session[]
}

model EmploymentTerms {
  id              String         @id @default(uuid()) @db.Uuid
  employeeId      String         @db.Uuid
  validFrom       DateTime       @db.Date
  type            EmploymentType
  weeklyMinutes   Int
  workDays        Int[]                         // ISO-Wochentage 1 = Mo … 6 = Sa
  annualLeaveDays Int                           // Jahresurlaub
  extraLeaveDays  Int            @default(0)    // Zusatzurlaub, nur Zahl, kein Grund
  hourlyWageCents Int?                          // nur bei Minijob, sonst null
  createdAt       DateTime       @default(now())
  createdById     String?        @db.Uuid
  employee        Employee       @relation(fields: [employeeId], references: [id])
  @@unique([employeeId, validFrom])
}

model LeaveCarryOver {                        // Übertrag aus dem Vorjahr, gepflegt im Mitarbeiterformular
  id          String   @id @default(uuid()) @db.Uuid
  employeeId  String   @db.Uuid
  year        Int                              // Jahr, in das übertragen wird
  days        Int
  updatedAt   DateTime @updatedAt
  updatedById String?  @db.Uuid
  employee    Employee @relation(fields: [employeeId], references: [id])
  @@unique([employeeId, year])
}

enum HolidayOrigin { STATUTORY MANUAL }

model Holiday {                               // bearbeitbare Feiertagsliste je Jahr
  id           String        @id @default(uuid()) @db.Uuid
  date         DateTime      @db.Date
  name         String
  state        String        @default("BY")
  municipality String?                         // für gemeindeabhängige Tage
  origin       HolidayOrigin                   // aus time-rules erzeugt oder vom Admin angelegt
  active       Boolean       @default(true)    // gesetzliche Tage werden abgeschaltet statt gelöscht
  updatedAt    DateTime      @updatedAt
  @@unique([state, date])
}

model CompanySettings {                       // genau eine Zeile (id = 1)
  id                     Int     @id @default(1)
  state                  String  @default("BY")
  assumptionDayIsHoliday Boolean @default(true) // Mariä Himmelfahrt, am Betriebssitz Feiertag
  updatedAt              DateTime @updatedAt
}

model LegalParameter {
  id         String            @id @default(uuid()) @db.Uuid
  key        LegalParameterKey
  value      Int                               // Cent
  validFrom  DateTime          @db.Date
  source     String                            // z. B. „MiLoG, Vierte Mindestlohnanpassungsverordnung“
  createdAt  DateTime          @default(now())
  @@unique([key, validFrom])
}

model LoginCode {
  id             String    @id @default(uuid()) @db.Uuid
  employeeId     String    @db.Uuid
  codeHash       String                        // HMAC-SHA256 mit Server-Pepper
  expiresAt      DateTime
  failedAttempts Int       @default(0)
  usedAt         DateTime?
  createdAt      DateTime  @default(now())
  employee       Employee  @relation(fields: [employeeId], references: [id])
}

model Passkey {
  id           String    @id @default(uuid()) @db.Uuid
  employeeId   String    @db.Uuid
  credentialId String    @unique               // base64url
  publicKey    Bytes
  counter      BigInt
  transports   String[]
  deviceType   String                          // singleDevice | multiDevice
  backedUp     Boolean
  name         String                          // Gerätename, vom Mitarbeiter änderbar
  createdAt    DateTime  @default(now())
  lastUsedAt   DateTime?
  employee     Employee  @relation(fields: [employeeId], references: [id])
}

model Session {
  id           String      @id @default(uuid()) @db.Uuid
  employeeId   String      @db.Uuid
  tokenHash    String      @unique             // SHA-256 des Cookie-Tokens
  method       LoginMethod
  createdAt    DateTime    @default(now())
  lastActiveAt DateTime    @default(now())
  expiresAt    DateTime
  employee     Employee    @relation(fields: [employeeId], references: [id])
}

model AuthChallenge {                        // WebAuthn-Challenge zwischen Optionen und Prüfung
  id         String           @id @default(uuid()) @db.Uuid
  challenge  String
  purpose    ChallengePurpose
  employeeId String?          @db.Uuid         // nur bei Registrierung
  expiresAt  DateTime
}

model RateLimitHit {                         // DB-basiert, damit es auch mit mehreren API-Instanzen gilt
  key         String                           // HMAC aus Bereich und Adresse bzw. IP, kein Klartext
  windowStart DateTime
  count       Int
  @@id([key, windowStart])
}

model AuditLog {
  id         BigInt   @id @default(autoincrement())
  at         DateTime @default(now())
  actorId    String?  @db.Uuid
  action     String                            // z. B. auth.login, employee.create, terms.create
  entityType String?
  entityId   String?
  details    Json?
}
```

Ergänzungen zum Konzept (Abschnitt 5): `CompanySettings`, `AuthChallenge` und `RateLimitHit` sind technisch nötig. `LeaveCarryOver` hält den Übertrag je Mitarbeiter und Jahr (Entscheidung 4); als Jahreswert statt als einzelnes Feld, damit der Übertrag 2026 nicht stillschweigend ins Jahr 2027 wandert. In Phase 3 liest das Urlaubskonto diesen Wert.

Anmeldesperre: Eine Person kann sich anmelden, wenn `lockedAt` leer ist und kein Austrittsdatum vor dem heutigen Tag (Europe/Berlin) liegt. Am Austrittstag selbst ist die Anmeldung noch möglich. Die Prüfung läuft bei jeder Anfrage, ein Job ist dafür nicht nötig. `AuditLog` ist append-only, abgesichert durch einen DB-Trigger, der `UPDATE` und `DELETE` ablehnt.

Abfallende Codes, Challenges, Sitzungen und Rate-Limit-Zeilen räumt ein stündlicher Job in der API auf.

## 5. Regelbibliothek `libs/time-rules` (Phase-1-Umfang)

Reine Funktionen, keine Abhängigkeit zu Framework oder DB. Gesetzliche Werte kommen als Parameter herein, nie als Konstante. Datumswerte als `LocalDate`-String `YYYY-MM-DD`.

| Funktion | Paragraf | Verhalten | Grenzwerttests |
| --- | --- | --- | --- |
| `minVacationDays(workDays)` | § 3 BUrlG | 4 Tage je Wochenarbeitstag (24 Werktage bei 6-Tage-Woche) | 1, 5, 6 Tage; leere Liste |
| `dailyTargetMinutes(terms)` | Vertrag, Konzept 4.1 | `round(weeklyMinutes / Anzahl Arbeitstage)`; Minijob `null` wie im Prototyp | 38,5 Std./5 Tage = 462 Min., Rundung, Minijob |
| `validateEmploymentTerms(terms, legal)` | § 3 BUrlG, § 3 ArbZG, § 1 MiLoG, § 8 Abs. 1a SGB IV | Liefert `errors` und `infos` mit Codes und deutschen Texten wie `empCheck` im Prototyp (Abschnitt 5.1) | Urlaub genau Minimum / Minimum − 1, genau 10 Std./Tag / darüber, genau 48 Std./Woche / darüber, Lohn genau Mindestlohn / 1 Cent darunter, Monatsplan genau an der Grenze / 1 Cent darüber |
| `bavarianHolidays(year, options)` und `isHoliday(date, holidays)` | § 9 ArbZG, Bayerisches Feiertagsgesetz (FTG) Art. 1 | Feste und bewegliche Feiertage (Ostern nach Gauß/Meeus wie im Prototyp), Mariä Himmelfahrt über Option | Ostern 2024–2030 gegen Tabelle, Fronleichnam, 15.08. an/aus, Schaltjahr |
| `countLeaveDays(from, to, workDays, holidays)` | § 3 BUrlG, Konzept 4.2 | Zählt Arbeitstage laut Vertrag ohne Feiertage, beide Grenzen inklusive (`leaveDays` im Prototyp) | gleicher Tag, Feiertag am Arbeitstag, Feiertag am freien Tag, Jahreswechsel, `from > to` |

### 5.1 Regeln aus `empCheck` (Prototyp)

Fehler (speichern nicht möglich):
- Name fehlt. Kein Arbeitstag gewählt.
- Jahresurlaub unter 4 × Arbeitstage je Woche: „Jahresurlaub liegt unter dem gesetzlichen Minimum von N Tagen.“
- Wochenstunden / Arbeitstage > 10 Std.: „Mehr als 10 Stunden je Arbeitstag sind nicht zulässig (§ 3 ArbZG).“
- Wochenstunden > 48: „Mehr als 48 Wochenstunden sind nicht zulässig.“
- Minijob ohne Stundenlohn; Stundenlohn unter Mindestlohn; geplanter Monatsverdienst (Wochenstunden × 13/3 × Lohn) über der Minijob-Grenze.

Hinweise (blockieren nicht): Soll je Arbeitstag, gesetzlicher Mindesturlaub, über 8 Std. je Tag nur mit Ausgleich, bei Minijob höchstmögliche Monatsstunden und geplanter Monatsverdienst.

Maßgeblich sind die gesetzlichen Werte, die am Stichtag `validFrom` des Vertragsstands gelten.

## 6. Anmeldung (Konzept 5.1)

### 6.1 E-Mail-Code
1. `POST /api/auth/code/request` mit Adresse. Antwort immer `202` mit demselben Text („Wenn die Adresse bei uns hinterlegt ist, ist ein Code unterwegs.“), auch für unbekannte oder gesperrte Adressen. Der Mailversand läuft entkoppelt nach der Antwort, damit die Antwortzeit nichts verrät.
2. Code: 6 Ziffern aus `crypto.randomInt`, gültig 10 Minuten, gespeichert als HMAC-SHA256 mit Pepper aus der Umgebung. Ein neuer Code entwertet ältere offene Codes derselben Person.
3. `POST /api/auth/code/verify` mit Adresse und Code. Gleicher Fehler „Code ungültig oder abgelaufen.“ für unbekannte Adresse, falschen, abgelaufenen, verbrauchten oder gesperrten Code. Vergleich zeitkonstant. Jeder Fehlversuch zählt hoch, ab 5 Fehlversuchen ist der Code gesperrt. Erfolg setzt `usedAt` und legt eine Sitzung an.
4. Rate-Limit (Vorschlag, konfigurierbar): Code anfordern höchstens 3 je Adresse und 10 je IP in 15 Minuten; Code prüfen höchstens 10 je IP in 15 Minuten. Gezählt wird unabhängig davon, ob die Adresse existiert. Überschreitung: `429` „Zu viele Versuche. Bitte in einigen Minuten erneut versuchen.“

### 6.2 Passkey
- Registrierung nur mit bestehender Sitzung: `POST /api/me/passkeys/registration/options` und `…/verify` mit Gerätename. `residentKey: required`, `userVerification: preferred`, bereits registrierte Passkeys als `excludeCredentials`.
- Anmeldung ohne E-Mail: `POST /api/auth/passkey/options` liefert Optionen ohne `allowCredentials` (Discoverable Credentials), die Challenge liegt in `AuthChallenge`, ihre ID in einem kurzlebigen httpOnly-Cookie. `POST /api/auth/passkey/verify` prüft Signatur, Zähler, Origin und RP-ID, und dass der Mitarbeiter aktiv ist.
- Verwaltung im Profil: auflisten, umbenennen, löschen. Nur eigene Passkeys.
- RP-ID und Origin aus der Umgebung (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`), lokal `localhost` und `http://localhost:4200`.

### 6.3 Sitzung
- Token: 32 Zufallsbytes, im Cookie im Klartext, in der DB nur als SHA-256.
- Cookie `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, Laufzeit 30 Tage. Rollierend: bei Aktivität wird `expiresAt` höchstens einmal pro Stunde um 30 Tage verlängert und das Cookie neu gesetzt.
- Jede Anfrage prüft Sitzung und Anmeldesperre (manuell oder nach Austritt). Manuelles Sperren löscht alle Sitzungen der Person.
- `POST /api/auth/logout` löscht die aktuelle Sitzung, `POST /api/auth/logout-all` alle eigenen.
- CSRF: `SameSite=Lax`, zustandsändernde Anfragen nur mit JSON und passendem `Origin`-Header.
- Lokal unter `http://localhost` setzen Chrome und Firefox `Secure`-Cookies. Für Safari gibt es `COOKIE_SECURE=false`, das die API nur bei `NODE_ENV=development` akzeptiert.

### 6.4 Protokoll
`AuditLog`-Einträge für: Anmeldung (Methode), fehlgeschlagene Code-Prüfung zu bekannter Person, Abmelden, alle Geräte abmelden, Passkey angelegt, umbenannt, gelöscht, Mitarbeiter angelegt, geändert, gesperrt, entsperrt, Vertragsstand angelegt, geändert, gelöscht, Übertrag geändert, Feiertag geändert, Einstellung geändert. Keine Codes, Tokens oder Adressen im Protokoll. Anwendungs-Logs enthalten keine personenbezogenen Daten (keine Adressen, Namen, IPs, Request-Bodies).

### 6.5 Erster Admin in Produktion
Es gibt keine Selbstregistrierung. Für die Ersteinrichtung legt ein Kommando (`pnpm nx run api:create-admin --name=… --email=…`) den ersten Admin an. Lokal übernimmt das der Seed.

## 7. Rollen und Rechteprüfung

- Globaler `SessionGuard`: jede Route braucht eine Sitzung, außer sie ist mit `@Public()` markiert.
- `@Roles(...)` mit `RolesGuard`: falsche Rolle ergibt `403`.
- Zentraler Abfragefilter `employeeScope(user)` für alle Abfragen auf Mitarbeiterdaten:
  - Admin: alle.
  - Vorgesetzte/r: sich selbst und die direkt zugeordneten Mitarbeiter (`leadId = eigene ID`).
  - Mitarbeiter/in: nur sich selbst.
  Datensätze außerhalb des Bereichs ergeben `404`, damit ihre Existenz nicht erkennbar ist.
- Felder je Rolle über getrennte Antwort-DTOs: `loginEmail` steht nur in Admin-Antworten.
- Zugriffsmatrix-Test: Eine Datei `access-matrix.ts` listet jede Route mit erwartetem Status je Rolle (anonym, Mitarbeiter, Vorgesetzter, Admin, Vorgesetzter eines anderen Teams). Ein Test liest alle registrierten Nest-Routen aus und schlägt fehl, wenn eine Route in der Matrix fehlt. Ein zweiter Test ruft jede Route mit jeder Rolle gegen die Test-DB auf und prüft den Status.

## 8. API-Routen

Präfix `/api`. Antworten JSON, Fehlermeldungen deutsch. „Team“ = sich selbst und direkt zugeordnete Mitarbeiter.

| Methode und Pfad | Anonym | Mitarbeiter | Vorgesetzter | Admin |
| --- | --- | --- | --- | --- |
| `GET /health` (öffentlich, für Probes) | ja | ja | ja | ja |
| `POST /auth/code/request` | ja | ja | ja | ja |
| `POST /auth/code/verify` | ja | ja | ja | ja |
| `POST /auth/passkey/options` | ja | ja | ja | ja |
| `POST /auth/passkey/verify` | ja | ja | ja | ja |
| `GET /auth/session` | 401 | eigene | eigene | eigene |
| `POST /auth/logout` | 401 | ja | ja | ja |
| `POST /auth/logout-all` | 401 | ja | ja | ja |
| `GET /me` (Profil mit aktuellem Vertragsstand) | 401 | eigene | eigene | eigene |
| `GET /me/passkeys` | 401 | eigene | eigene | eigene |
| `POST /me/passkeys/registration/options` | 401 | eigene | eigene | eigene |
| `POST /me/passkeys/registration/verify` | 401 | eigene | eigene | eigene |
| `PATCH /me/passkeys/:id` (umbenennen) | 401 | eigene, sonst 404 | eigene, sonst 404 | eigene, sonst 404 |
| `DELETE /me/passkeys/:id` | 401 | eigene, sonst 404 | eigene, sonst 404 | eigene, sonst 404 |
| `GET /employees` | 401 | 403 | Team, ohne Anmeldeadresse | alle, mit Anmeldeadresse |
| `GET /employees/:id` | 401 | 403 | Team, sonst 404 | alle |
| `POST /employees` (mit erstem Vertragsstand) | 401 | 403 | 403 | ja |
| `PATCH /employees/:id` | 401 | 403 | 403 | ja |
| `POST /employees/:id/lock` (manuell sperren) | 401 | 403 | 403 | ja |
| `POST /employees/:id/unlock` (manuelle Sperre aufheben) | 401 | 403 | 403 | ja |
| `PUT /employees/:id/carry-over/:year` | 401 | 403 | 403 | ja |
| `GET /employees/:id/terms` | 401 | 403 | Team, sonst 404 | alle |
| `POST /employees/:id/terms` (neuer Vertragsstand) | 401 | 403 | 403 | ja |
| `PATCH /employees/:id/terms/:termsId` (nur künftige Stände) | 401 | 403 | 403 | ja |
| `DELETE /employees/:id/terms/:termsId` (nur künftige Stände) | 401 | 403 | 403 | ja |
| `GET /legal-parameters` | 401 | ja | ja | ja |
| `GET /holidays?year=` | 401 | ja | ja | ja |
| `POST /holidays` (eigener Feiertag) | 401 | 403 | 403 | ja |
| `PATCH /holidays/:id` (Name, aktiv) | 401 | 403 | 403 | ja |
| `DELETE /holidays/:id` (nur eigene Feiertage) | 401 | 403 | 403 | ja |
| `GET /settings/company` | 401 | ja | ja | ja |
| `PATCH /settings/company` | 401 | 403 | 403 | ja |
| `GET /audit-log` | 401 | 403 | 403 | ja |

Mitarbeiter sehen ihre eigenen Daten über `/me`, nicht über `/employees`. Gesetzliche Werte und Feiertage enthalten keine personenbezogenen Daten und sind für alle Angemeldeten lesbar. Änderungen an gesetzlichen Werten erfolgen in Phase 1 per Migration oder Seed, eine Admin-Oberfläche dafür folgt später.

Zusätzliche Regeln in der Mitarbeiterverwaltung:
- Anmeldeadresse eindeutig, klein geschrieben, gültiges Format; Dublette ergibt `409`.
- Rollen MITARBEITER und VORGESETZTER brauchen einen Vorgesetzten mit Rolle VORGESETZTER oder ADMIN. Keine Zyklen.
- Der letzte anmeldefähige Admin kann weder gesperrt noch herabgestuft werden und bekommt kein Austrittsdatum in der Vergangenheit.
- Vertragsstand mit Fehlern aus `validateEmploymentTerms` ergibt `422` mit den Fehlertexten. Hinweise gehen in der Antwort mit.
- Erster Vertragsstand gilt ab Eintritt. Liegt der Eintritt vor dem ersten Stichtag gesetzlicher Werte (01.01.2026), gilt er ab diesem Stichtag (Rückfrage 17). Der erste Stand ist nicht löschbar, sein Stichtag nicht verschiebbar; jeder Stichtag braucht hinterlegte gesetzliche Werte.
- Alle schreibenden Admin-Operationen auf Mitarbeiter laufen nacheinander (Advisory-Lock), damit Prüfungen wie „letzter Admin“ und „keine Kreise“ auch bei gleichzeitigen Anfragen halten.
- Feiertagsliste: Fehlt ein Jahr, erzeugt die API dessen gesetzliche Feiertage einmalig aus `time-rules` (Mariä Himmelfahrt nach `CompanySettings`). Danach ist die Liste maßgeblich und für den Admin bearbeitbar: gesetzliche Tage umbenennen oder abschalten, eigene Tage anlegen, ändern und löschen. Bearbeitbar sind das laufende und künftige Jahre; vergangene Jahre bleiben unverändert, damit alte Monate richtig bleiben. Jede Änderung steht im Protokoll.
- Mariä Himmelfahrt umschalten setzt den 15.08. ab dem laufenden Jahr aktiv bzw. inaktiv und gilt für künftig erzeugte Jahre.
- `/me` enthält die eigene Anmeldeadresse nur lesend (Entscheidung 2). Ändern kann sie nur der Admin.
- Übertrag: ganze Tage, 0 bis 60 wie im Prototyp, je Jahr ein Wert.

## 9. Web

- Theme: Farben, Abstände, Radien und Schriften aus dem Prototyp als CSS-Variablen in Tailwinds `@theme`, hell und dunkel per `prefers-color-scheme` und Umschalter (`data-theme`). IBM Plex Sans und Mono lokal gebündelt. Content-Security-Policy erlaubt nur `self`.
- Aufbau wie im Prototyp: Kopfzeile mit Marke und angemeldeter Person, Navigation links (auf schmalen Bildschirmen oben), Arbeitsfläche rechts.
- Seiten:
  - `/anmelden`: Adresse eingeben, Code anfordern; Schaltfläche „Mit Passkey anmelden“.
  - `/anmelden/code`: Code eingeben, Hinweis auf erneutes Anfordern.
  - `/` Start: Begrüßung, eigener Vertragsstand (Soll je Tag, Arbeitstage, Jahresurlaub), Hinweis auf fehlenden Passkey.
  - `/profil`: eigene Daten, Passkeys anlegen, umbenennen, löschen, Abmelden, Alle Geräte abmelden.
  - `/mitarbeiter`, `/mitarbeiter/neu`, `/mitarbeiter/:id` (nur Admin): Liste mit Status (aktiv, gesperrt, ausgetreten), Anlegen, Bearbeiten, Austrittsdatum, Sperren und Entsperren, Übertrag Vorjahr, Vertragsstände mit Stichtag. Live-Prüfung im Formular mit `validateEmploymentTerms` aus `libs/time-rules`, Speichern gesperrt bei Fehlern, Server prüft erneut.
  - `/feiertage`: Feiertage des Jahres; Admin bearbeitet die Liste und schaltet Mariä Himmelfahrt.
- Navigation nach Rolle: alle sehen Start, Feiertage, Profil; Admin zusätzlich Mitarbeiter. Menüpunkte späterer Phasen erscheinen erst mit ihrer Phase.
- Frontend-Guards dienen nur der Bedienung, die Rechteprüfung liegt im Backend.
- Texte aus dem Prototyp übernommen, wo es sie gibt.

## 10. Teststrategie

| Ebene | Inhalt | Läuft in |
| --- | --- | --- |
| Unit `libs/time-rules` | Jede Funktion mit Grenzwerten, Paragraf im `describe`-Titel | lokal, CI |
| Unit API | Code-Erzeugung und Hash, Sitzungsverlängerung, Scope-Filter, DTO-Mapper | lokal, CI |
| Integration API | Supertest gegen echte PostgreSQL-Test-DB (eigene Datenbank, vor jedem Lauf migriert und geleert): Anmeldeabläufe inklusive 5 Fehlversuche, Ablauf nach 10 Minuten (gestellte Uhr), Einmalverwendung, Rate-Limit, gleiche Antwort für unbekannte Adressen, gesperrte und ausgetretene Mitarbeiter (Tag des Austritts und Folgetag), Passkey-Registrierung und -Anmeldung mit Testdaten eines Software-Authenticators, Zugriffsmatrix | lokal, CI mit Postgres-Service |
| Komponenten Web | Login-Formulare, Mitarbeiterformular (Urlaub unter Minimum zeigt Fehler und sperrt Speichern), Navigation nach Rolle | lokal, CI |
| Ende-zu-Ende | Playwright in Chromium: Code anfordern, Code aus der Mailpit-API lesen, anmelden, Passkey mit virtuellem WebAuthn-Authenticator anlegen, abmelden, mit Passkey anmelden; Admin lehnt Urlaub unter Minimum ab | lokal, CI mit Postgres- und Mailpit-Service |

Vor jedem Commit laufen `pnpm lint` und `pnpm test`.

## 11. Lokale Entwicklung

- `pnpm install`, dann `pnpm dev`: legt `.env` aus `.env.example` an, falls sie fehlt, startet Docker Compose (PostgreSQL, Mailpit), wendet Migrationen an, spielt den Seed auf eine leere DB, startet API (Port 3000) und Web (Port 4200, Proxy `/api` auf die API).
- Mailpit-Oberfläche unter `http://localhost:8025`.
- `.env.example` enthält nur Entwicklungswerte und Platzhalter, keine echten Secrets.
- Seed: Beispielmitarbeiter aus dem Prototyp mit Adressen unter `example.com` bzw. `example.org` (Minijobber mit „privater“ Adresse), gesetzliche Werte, Einstellungen, Feiertage 2025 bis 2028.

## 12. Gesetzliche Werte im Seed

| Schlüssel | Wert | gültig ab |
| --- | --- | --- |
| `MIN_WAGE_HOURLY_CENTS` | 1390 | 01.01.2026 |
| `MINIJOB_MONTHLY_LIMIT_CENTS` | 60300 | 01.01.2026 |
| `MIN_WAGE_HOURLY_CENTS` | 1460 | 01.01.2027 |
| `MINIJOB_MONTHLY_LIMIT_CENTS` | 63300 | 01.01.2027 |

## 13. Entscheidungen

Entschieden am 12.10.2026:

1. **Mariä Himmelfahrt** ist am Betriebssitz Feiertag (Seed: an). Die Feiertagsliste ist für den Admin bearbeitbar (Abschnitt 8).
2. **Anmeldeadresse**: Der Mitarbeiter sieht seine eigene Adresse im Profil, nur lesend.
3. **Mindestlohn nach dem Stichtag**: Fehler gegen die Werte am Stichtag, bekannte künftige Änderungen als Hinweis („Ab 01.01.2027 liegt der Stundenlohn unter dem Mindestlohn von 14,60 €.“). Die Mitarbeiterliste zeigt betroffene Personen.
4. **Übertrag Vorjahr** wird am Mitarbeiter gepflegt (`LeaveCarryOver` je Jahr, im Mitarbeiterformular).
5. **Vertragsstände**: geltende und vergangene Stände unveränderlich, künftige änderbar und löschbar (Punkt 7 unten).
6. **Austritt und Sperre getrennt**: automatisch gesperrt ab dem Tag nach dem Austritt, manuell jederzeit vorher sperrbar (Punkt 8 unten).

Die folgenden Vorschläge gelten wie beschrieben, solange kein Widerspruch kommt:

5. **Zusatzurlaub und Mindesturlaub**: Vorschlag: Die Prüfung gegen das gesetzliche Minimum bezieht sich nur auf den Jahresurlaub, Zusatzurlaub kommt obendrauf.
5. **Zusatzurlaub und Mindesturlaub**: Vorschlag: Die Prüfung gegen das gesetzliche Minimum bezieht sich nur auf den Jahresurlaub, Zusatzurlaub kommt obendrauf.
6. **Teiljahr (§ 5 BUrlG)**: Die Prüfung beim Speichern vergleicht den vollen Jahresanspruch mit dem Minimum. Die anteilige Berechnung im Eintritts- und Austrittsjahr kommt mit den Urlaubskonten in Phase 3. Einverstanden?
7. **Vertragsstände ändern**: entschieden: Stände, die bereits gelten oder galten, sind unveränderlich; Korrekturen erfolgen über einen neuen Stand. Künftige Stände darf der Admin ändern und löschen.
8. **Austritt und Sperre**: entschieden (siehe oben). Entsperren hebt nur die manuelle Sperre auf; wer nach dem Austritt wieder Zugriff braucht, bekommt ein späteres Austrittsdatum.
9. **Vertretung**: Vorschlag: Das Feld wird in Phase 1 gepflegt, Rechte der Vertretung (Anträge sehen und entscheiden) kommen in Phase 3. Seed ohne Vertretung, solange Konzept 7 („Wer vertritt?“) offen ist.
10. **Sicht der Vorgesetzten**: Vorschlag: Vorgesetzte sehen nur direkt zugeordnete Mitarbeiter, inklusive Vertragsdaten und Stundenlohn der Minijobber (der Prototyp zeigt ihn in den Prüfungen), ohne Anmeldeadresse.
11. **Vorgesetzte/r Pflicht**: Vorschlag: Pflicht für Mitarbeiter und Vorgesetzte, beim Admin optional (oberste Person ohne Vorgesetzten).
12. **Arbeitstage**: Wie im Prototyp nur Montag bis Samstag wählbar, Sonntag nicht (Konzept 7: Sonn- und Feiertagsarbeit offen).
13. **Tägliches Soll bei Minijob**: Prototyp kein Soll (`null`), Konzept 4.3 nennt „tägliches Soll“ allgemein. Vorschlag: wie Prototyp.
14. **Monatsumrechnung Minijob**: Prototyp rechnet Wochenstunden × 13/3. Vorschlag: übernehmen.
15. **Rate-Limit-Werte** aus 6.1: einverstanden?
16. **Stundenlohn** nur bei Minijob speichern, bei Voll- und Teilzeit nicht (Datensparsamkeit). Einverstanden?

Technische Festlegungen, die ich ohne Rückfrage so umsetze, falls kein Widerspruch kommt: Branch `phase-1-fundament` mit Pull Request nach `main` am Ende der Phase; Codex-Aufgaben auf `codex/<aufgabe>` in eigenen Worktrees; Prisma 7 statt der Vorabversion 8; IDs als UUID.

## 14. Rückfragen aus der Umsetzung (beide entschieden)

17. **Erster Vertragsstand bei Eintritt vor 2026**: entschieden am 12.10.2026, Stichtag 01.01.2026 bleibt. Ursprüngliche Frage: Für Stichtage vor dem 01.01.2026 sind keine gesetzlichen Werte hinterlegt. Umgesetzt: Der erste Stand gilt ab Eintritt, bei früherem Eintritt ab 01.01.2026 (Start der Erfassung). Alternative: historische Mindestlohn- und Minijob-Werte als `LegalParameter` nachtragen und den ersten Stand immer ab Eintritt führen.
18. **Hannelore Fuchs im Seed**: entschieden am 12.10.2026, Seed bleibt bei 9 Std./Woche. Die Beispieldaten des Prototyps hat Claude Code erfunden, die Überschreitung hatte keine fachliche Absicht. Ursprüngliche Frage: Laut Prototyp 10,5 Std./Woche bei 14 €; das ergibt 637 € im Monat und liegt über der Minijob-Grenze von 603 €. Im Seed vorläufig mit 9 Std./Woche. Soll der Datensatz so bleiben, oder ist die Überschreitung im Prototyp beabsichtigt (Beispiel für die Prüfseite in Phase 4)?
