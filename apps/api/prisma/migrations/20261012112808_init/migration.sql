-- CreateEnum
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'LEAD', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmploymentType" AS ENUM ('FULL_TIME', 'PART_TIME', 'MINIJOB');

-- CreateEnum
CREATE TYPE "LoginMethod" AS ENUM ('EMAIL_CODE', 'PASSKEY');

-- CreateEnum
CREATE TYPE "ChallengePurpose" AS ENUM ('PASSKEY_REGISTRATION', 'PASSKEY_LOGIN');

-- CreateEnum
CREATE TYPE "LegalParameterKey" AS ENUM ('MIN_WAGE_HOURLY_CENTS', 'MINIJOB_MONTHLY_LIMIT_CENTS');

-- CreateEnum
CREATE TYPE "HolidayOrigin" AS ENUM ('STATUTORY', 'MANUAL');

-- CreateTable
CREATE TABLE "Employee" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "loginEmail" TEXT NOT NULL,
    "leadId" UUID,
    "deputyId" UUID,
    "entryDate" DATE NOT NULL,
    "exitDate" DATE,
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmploymentTerms" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "validFrom" DATE NOT NULL,
    "type" "EmploymentType" NOT NULL,
    "weeklyMinutes" INTEGER NOT NULL,
    "workDays" INTEGER[],
    "annualLeaveDays" INTEGER NOT NULL,
    "extraLeaveDays" INTEGER NOT NULL DEFAULT 0,
    "hourlyWageCents" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" UUID,

    CONSTRAINT "EmploymentTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveCarryOver" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "days" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "LeaveCarryOver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'BY',
    "municipality" TEXT,
    "origin" "HolidayOrigin" NOT NULL,
    "key" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'BY',
    "assumptionDayIsHoliday" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CompanySettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalParameter" (
    "id" UUID NOT NULL,
    "key" "LegalParameterKey" NOT NULL,
    "value" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalParameter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginCode" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Passkey" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL,
    "transports" TEXT[],
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Passkey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "method" "LoginMethod" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthChallenge" (
    "id" UUID NOT NULL,
    "challenge" TEXT NOT NULL,
    "purpose" "ChallengePurpose" NOT NULL,
    "employeeId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AuthChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitHit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" JSONB,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Employee_loginEmail_key" ON "Employee"("loginEmail");

-- CreateIndex
CREATE INDEX "Employee_leadId_idx" ON "Employee"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "EmploymentTerms_employeeId_validFrom_key" ON "EmploymentTerms"("employeeId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "LeaveCarryOver_employeeId_year_key" ON "LeaveCarryOver"("employeeId", "year");

-- CreateIndex
CREATE INDEX "Holiday_state_date_idx" ON "Holiday"("state", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_state_date_name_key" ON "Holiday"("state", "date", "name");

-- CreateIndex
CREATE UNIQUE INDEX "LegalParameter_key_validFrom_key" ON "LegalParameter"("key", "validFrom");

-- CreateIndex
CREATE INDEX "LoginCode_employeeId_createdAt_idx" ON "LoginCode"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Passkey_credentialId_key" ON "Passkey"("credentialId");

-- CreateIndex
CREATE INDEX "Passkey_employeeId_idx" ON "Passkey"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_employeeId_idx" ON "Session"("employeeId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuthChallenge_expiresAt_idx" ON "AuthChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitHit_windowStart_idx" ON "RateLimitHit"("windowStart");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_deputyId_fkey" FOREIGN KEY ("deputyId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveCarryOver" ADD CONSTRAINT "LeaveCarryOver_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginCode" ADD CONSTRAINT "LoginCode_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Passkey" ADD CONSTRAINT "Passkey_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Zusätzliche Sicherungen auf DB-Ebene (Spezifikation Phase 1, Abschnitt 4).
-- Maßgeblich bleibt die Prüfung in libs/time-rules; diese Constraints sind die zweite Linie.
-- ---------------------------------------------------------------------------

-- Anmeldeadresse nur klein geschrieben, damit die Eindeutigkeit nicht an Groß/Klein scheitert.
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_loginEmail_lowercase" CHECK ("loginEmail" = lower("loginEmail"));
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_exit_after_entry" CHECK ("exitDate" IS NULL OR "exitDate" >= "entryDate");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_lead_not_self" CHECK ("leadId" IS NULL OR "leadId" <> "id");
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_deputy_not_self" CHECK ("deputyId" IS NULL OR "deputyId" <> "id");

ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_weeklyMinutes_positive" CHECK ("weeklyMinutes" > 0);
-- Arbeitstage Montag bis Samstag, mindestens einer
ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_workDays_valid"
  CHECK (cardinality("workDays") BETWEEN 1 AND 6 AND "workDays" <@ ARRAY[1,2,3,4,5,6]);
ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_leave_nonnegative"
  CHECK ("annualLeaveDays" >= 0 AND "extraLeaveDays" >= 0);
-- § 3 BUrlG: Jahresurlaub mindestens 4 Tage je Wochenarbeitstag
ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_min_vacation"
  CHECK ("annualLeaveDays" >= 4 * cardinality("workDays"));
-- Stundenlohn nur bei Minijob, dort Pflicht
ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_wage_only_minijob"
  CHECK (("type" = 'MINIJOB' AND "hourlyWageCents" > 0) OR ("type" <> 'MINIJOB' AND "hourlyWageCents" IS NULL));

ALTER TABLE "LeaveCarryOver" ADD CONSTRAINT "LeaveCarryOver_days_range" CHECK ("days" BETWEEN 0 AND 60);
ALTER TABLE "LegalParameter" ADD CONSTRAINT "LegalParameter_value_positive" CHECK ("value" > 0);
ALTER TABLE "LoginCode" ADD CONSTRAINT "LoginCode_failedAttempts_range" CHECK ("failedAttempts" BETWEEN 0 AND 5);
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_singleton" CHECK ("id" = 1);

-- AuditLog ist append-only.
CREATE FUNCTION audit_log_reject_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog ist unveränderlich';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AuditLog_append_only"
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_reject_change();

CREATE TRIGGER "AuditLog_no_truncate"
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_change();
