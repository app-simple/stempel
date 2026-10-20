# Container für API und Web

## Bauen und lokal prüfen

Alle Befehle im Workspace-Root ausführen (Docker mit BuildKit). Node 24,
die pnpm-Version aus `packageManager` und `pnpm-lock.yaml` bestimmen den
Anwendungsbuild. Es werden keine Secrets oder lokalen `.env`-Dateien benötigt.
Der Build braucht Zugriff auf Image- und Paketregistries sowie Prisma-Downloads.

```sh
docker build -f apps/api/Dockerfile -t asos-api:test .
docker build -f apps/web/Dockerfile -t asos-web:test .
docker run --rm -p 18080:8080 asos-web:test
# In einem zweiten Terminal:
curl -i http://localhost:18080/
curl -i http://localhost:18080/anmelden
```

Nach dem Stoppen der Testcontainer die eigenen Test-Images entfernen:

```sh
docker rmi asos-api:test asos-web:test
```

Die Basis-Tags `node:24-slim` und `nginxinc/nginx-unprivileged:stable-alpine`
erhalten Updates. Für identische Release-Basisimages deren geprüfte Digests in
der Release-Pipeline festhalten. Es erfolgt hier kein Deployment oder Registry-Push.

Die API läuft als Benutzer `node` in `/app`, startet mit `node main.js` und
enthält nur ihre Produktionsabhängigkeiten plus Prisma-CLI für Migrationen.
Das reduzierte Lockfile wird mit [Nx](https://nx.dev/docs/guides/ci-deployment)
aus dem Workspace-Lockfile erzeugt; auch diese Installation ist eingefroren.
Der generierte Prisma-Client wird vor dem API-Build erzeugt und mitgebündelt.
Das Web-Image enthält nginx und die statischen Angular-Dateien, keinen Node-Buildstack.

## API-Konfiguration

Konfiguration und Secrets zur Laufzeit über die Infrastruktur bereitstellen;
keine `.env` ins Image einbauen. Variablennamen aus `.env.example`,
`apps/api/src/app/config/app-config.ts` und der Proxy-Konfiguration:

| Variable | Zweck / Pflicht |
| --- | --- |
| `NODE_ENV` | Produktionsmodus, bereits im API-Image gesetzt. |
| `API_PORT` | Optionaler Listen-Port; mit Service und Probes abstimmen, Image-Port ist 3000. |
| `DATABASE_URL` | Pflicht: PostgreSQL-Verbindung einschließlich Zugangsdaten und ggf. TLS-Konfiguration. |
| `APP_ORIGIN` | Pflicht: öffentliche HTTPS-Origin der Oberfläche; ohne Pfad. |
| `WEBAUTHN_RP_ID` | Pflicht: zur öffentlichen Domain passende WebAuthn-Relying-Party-ID. |
| `WEBAUTHN_RP_NAME` | Optionaler Anzeigename für Passkeys. |
| `WEBAUTHN_ORIGIN` | Optional; verwendet sonst `APP_ORIGIN`. |
| `AUTH_PEPPER` | Pflicht/Secret: mindestens 32 Zeichen; für Produktion kryptografisch zufällig erzeugen. |
| `AUTH_FAILURE_FLOOR_MS` | Optionale Mindestdauer fehlgeschlagener Code-Prüfungen. |
| `COOKIE_SECURE` | Sichere Cookies beibehalten; Abschalten ist in Produktion unzulässig. |
| `TRUST_PROXY_HOPS` | Anzahl tatsächlich vertrauenswürdiger Proxys vor der API, siehe unten. |
| `SMTP_HOST` | Pflicht: erreichbarer SMTP-Server. |
| `SMTP_PORT` | Pflicht: SMTP-Port. |
| `SMTP_SECURE` | Implizites TLS passend zum SMTP-Server konfigurieren. |
| `SMTP_USER`, `SMTP_PASSWORD` | Optional, falls der SMTP-Server Anmeldung verlangt; Passwort als Secret. |
| `MAIL_FROM` | Absenderadresse mit optionalem Anzeigenamen; für Produktion passend setzen. |

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`,
`MAILPIT_SMTP_PORT` und `MAILPIT_UI_PORT` aus `.env.example` betreffen die lokale
Compose-Umgebung. `TEST_DATABASE_URL` ist nur für Tests nötig, nicht für die API
in Produktion. Beispielwerte aus `.env.example` nicht in Produktion übernehmen.

## Migrationen vor dem Rollout

Migrationen einmalig in einem eigenen Job mit demselben API-Image **vor** dem
Rollout ausführen. Arbeitsverzeichnis ist `/app`; `prisma` liegt bereits im `PATH`.
Den Standardbefehl des Images durch folgenden Befehl ersetzen:

```sh
prisma migrate deploy --config apps/api/prisma.config.ts
```

Dem Job `DATABASE_URL` mit den erforderlichen Migrationsrechten übergeben.
Schema, Migrationen und Prisma-Konfiguration liegen unter `apps/api/` im Image.
Es gibt keine automatische Migration beim API-Start und keinen automatischen Seed.
Danach einmalig die Stammdaten ohne Beispielpersonen anlegen: `pnpm nx run api:seed-stammdaten` (gesetzliche Werte, Einstellungen, Feiertage); ohne sie lehnt die API jeden Vertragsstand ab. Den ersten Admin legt einmalig `pnpm nx run api:create-admin --args="--name='…' --email=… --entry=JJJJ-MM-TT"` an (aus einem Checkout mit Zugriff auf die Datenbank); weitere Konten legt der Admin in der Oberfläche an.
Die Migration von Phase 3 legt die PostgreSQL-Erweiterung `btree_gist` an (für den Ausschluss
überlappender Abwesenheiten). Sie gehört zum Standardumfang von PostgreSQL und gilt seit Version 13
als vertrauenswürdig; die Migrationsrolle braucht dafür das Recht `CREATE` auf der Datenbank.
Bei Fehlern den Rollout stoppen. Die Laufzeitrolle der API getrennt von der
Migrationsrolle halten: Sie braucht für `AuditLog` kein `UPDATE`, `DELETE` oder
`TRUNCATE`; die vorhandenen Datenbank-Trigger verhindern diese Operationen ohnehin.

## Ingress, Probes und Browser

- Eine gemeinsame öffentliche HTTPS-Origin verwenden. Ingress: `/api` und
  `/api/*` zum API-Service auf Port 3000; übrige Pfade zum Web-Service auf Port 8080.
  Das Präfix `/api` erhalten, nicht wegschreiben. nginx liefert dafür bewusst 404.
- TLS endet am Ingress. Dort HSTS (`Strict-Transport-Security`) konfigurieren;
  nginx enthält dafür nur einen Kommentar.
- `TRUST_PROXY_HOPS` gemäß tatsächlicher Proxy-Kette konfigurieren. Die API darf
  nicht unter Umgehung dieser Kette öffentlich erreichbar sein; der Ingress muss
  weitergereichte Client-IP-Header verlässlich setzen. Sonst ist das IP-Rate-Limit
  nicht zuverlässig.
- API-Liveness und -Readiness: `GET /api/health`, ohne Anmeldung. Die aktuelle
  Antwort prüft den laufenden HTTP-Server, nicht Datenbank oder SMTP.
  Für Web-Probes `GET /` auf Port 8080 verwenden.
- nginx liefert SPA-Routen über `index.html` ohne Cache aus. Gehashte JS-, CSS-,
  Font- und Bilddateien bleiben ein Jahr mit `immutable` cachebar; fehlende Assets
  erhalten 404. Sicherheits-Header werden auch bei Fehlerantworten gesetzt.
- Die CSP erlaubt ausschließlich lokale Skripte, Styles, Fonts und Verbindungen
  sowie `data:`-Bilder. Kamera, Mikrofon und Geolokalisierung sind deaktiviert;
  WebAuthn ist für die eigene Origin erlaubt. `inlineCritical` bleibt ausgeschaltet.
  Bei Änderungen am Angular-Build auch erzeugtes HTML und zur Laufzeit eingefügte
  Styles auf CSP-Verletzungen prüfen; die CSP nicht durch `unsafe-inline` lockern.

## Hintergrundaufgaben

Jede API-Instanz prüft alle 15 Minuten, ob Abwesenheitsanträge länger als fünf Arbeitstage offen
sind, und meldet sie ab 07:00 Uhr (Europe/Berlin) einmalig je Antrag per E-Mail an die Admins.
Mehrere Instanzen sind unkritisch: Jeder Antrag wird vor dem Versand in der Datenbank beansprucht,
gemeldet wird nur einmal. Es ist kein CronJob im Cluster nötig.

Außerdem läuft alle sechs Stunden der Löschjob: Er entfernt immer abgelaufene Sitzungen,
Anmeldecodes, WebAuthn-Challenges und Rate-Limit-Einträge. Zeit-, Urlaubs- und Protokolldaten löscht
er nur, wenn der Admin ihn unter „Prüfungen“ einschaltet, und erst nach den dort eingestellten
Fristen. Mehrere Instanzen laufen über eine Datenbanksperre nacheinander. Das Löschen geschützter
Tabellen ist nur innerhalb dieser Transaktion freigegeben (`SET LOCAL asos.purge = 'on'`); die
Schutz-Trigger verhindern Änderungen und Löschungen außerhalb davon weiterhin. Vor dem Einschalten
eine Datenbanksicherung mit ausreichender Aufbewahrung sicherstellen.

Erinnerungen ans Stempeln prüft jede API-Instanz alle fünf Minuten. Doppelte Sendungen verhindert
eine eindeutige Zeile im Erinnerungsprotokoll der Datenbank; Redis ist nicht nötig.

**Web Push** (einzige Ausnahme von „keine externen Dienste“, CLAUDE.md): Die API sendet
verschlüsselte Nachrichten mit neutralem Text an die Push-Dienste der Browserhersteller
(`fcm.googleapis.com`, `updates.push.services.mozilla.com`, `*.push.apple.com`,
`*.notify.windows.com`). Andere Ziele lehnt sie ab. Dafür braucht die API ausgehendes HTTPS zu diesen
Hosts. Schlüsselpaar einmalig erzeugen (`pnpm exec web-push generate-vapid-keys`) und als
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` und optional `VAPID_SUBJECT` (mailto: oder https-URL)
setzen; den privaten Schlüssel als Secret. Ein Schlüsselwechsel macht alle Geräte-Anmeldungen
ungültig; die Personen melden ihre Geräte dann im Profil neu an. Ohne Schlüssel gibt es nur Banner
und E-Mail.

Die Oberfläche liefert `sw.js` (Service Worker, nur Push, kein Offline-Cache) und
`manifest.webmanifest` aus; beide ohne Hash, `sw.js` mit `Cache-Control: no-cache`. Die CSP
`default-src 'self'` erlaubt beides.

PDF-Exporte erzeugt die API selbst mit `pdfkit` und den eingebauten Standardschriften; es werden
keine Schriften oder Dienste aus dem Netz geladen.

Anmeldemails und Benachrichtigungen gehen über SMTP. Zur Laufzeit benötigt die
Anwendung PostgreSQL und einen SMTP-Server, aber keine externen SaaS-Dienste,
CDNs, Fonts oder Tracker; diese Infrastruktur kann intern betrieben werden.
