-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('CLOCK', 'MANUAL');

-- CreateEnum
CREATE TYPE "CorrectionKind" AS ENUM ('CORRECT', 'VOID');

-- CreateEnum
CREATE TYPE "CorrectionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "overtimeAccountSince" DATE;

-- CreateTable
CREATE TABLE "TimeEntry" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "workDate" DATE NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3),
    "source" "TimeEntrySource" NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL,
    "recordedById" UUID NOT NULL,
    "reason" TEXT,
    "voidedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntryBreak" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "startAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3),

    CONSTRAINT "TimeEntryBreak_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeEntryRevision" (
    "id" BIGSERIAL NOT NULL,
    "entryId" UUID NOT NULL,
    "changedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,

    CONSTRAINT "TimeEntryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeCorrectionRequest" (
    "id" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "kind" "CorrectionKind" NOT NULL,
    "proposed" JSONB,
    "reason" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "CorrectionStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(3),
    "decisionReason" TEXT,

    CONSTRAINT "TimeCorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthClosing" (
    "employeeId" UUID NOT NULL,
    "month" TEXT NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL,
    "reopenedAt" TIMESTAMPTZ(3),
    "reopenedById" UUID,

    CONSTRAINT "MonthClosing_pkey" PRIMARY KEY ("employeeId","month")
);

-- CreateTable
CREATE TABLE "OvertimeAdjustment" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "minutes" INTEGER NOT NULL,
    "effectiveOn" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OvertimeAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimeEntry_employeeId_workDate_idx" ON "TimeEntry"("employeeId", "workDate");

-- CreateIndex
CREATE INDEX "TimeEntryBreak_entryId_idx" ON "TimeEntryBreak"("entryId");

-- CreateIndex
CREATE INDEX "TimeEntryRevision_entryId_idx" ON "TimeEntryRevision"("entryId");

-- CreateIndex
CREATE INDEX "TimeCorrectionRequest_status_idx" ON "TimeCorrectionRequest"("status");

-- CreateIndex
CREATE INDEX "OvertimeAdjustment_employeeId_idx" ON "OvertimeAdjustment"("employeeId");

-- AddForeignKey
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntryBreak" ADD CONSTRAINT "TimeEntryBreak_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeEntryRevision" ADD CONSTRAINT "TimeEntryRevision_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "TimeEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthClosing" ADD CONSTRAINT "MonthClosing_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeAdjustment" ADD CONSTRAINT "OvertimeAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Sicherungen Phase 2 (docs/specs/phase-2-zeiterfassung.md, Abschnitte 4 und 12)
-- ---------------------------------------------------------------------------

-- Ende nach Beginn, höchstens 24 Stunden (Entscheidung 3)
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_end_after_start"
  CHECK ("endAt" IS NULL OR ("endAt" > "startAt" AND "endAt" <= "startAt" + interval '24 hours'));
-- Nachtrag nur mit Begründung
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_manual_reason"
  CHECK ("source" <> 'MANUAL' OR ("reason" IS NOT NULL AND length(trim("reason")) > 0));
-- Höchstens eine laufende Buchung je Person
CREATE UNIQUE INDEX "TimeEntry_one_open_per_employee" ON "TimeEntry" ("employeeId")
  WHERE "endAt" IS NULL AND "voidedAt" IS NULL;

ALTER TABLE "TimeEntryBreak" ADD CONSTRAINT "TimeEntryBreak_end_after_start"
  CHECK ("endAt" IS NULL OR "endAt" > "startAt");
-- Höchstens eine laufende Pause je Buchung
CREATE UNIQUE INDEX "TimeEntryBreak_one_open_per_entry" ON "TimeEntryBreak" ("entryId") WHERE "endAt" IS NULL;

-- Ablehnung nur mit Begründung; höchstens ein offener Antrag je Buchung
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_reject_reason"
  CHECK ("status" <> 'REJECTED' OR ("decisionReason" IS NOT NULL AND length(trim("decisionReason")) > 0));
ALTER TABLE "TimeCorrectionRequest" ADD CONSTRAINT "TimeCorrectionRequest_proposed_for_correct"
  CHECK ("kind" <> 'CORRECT' OR "proposed" IS NOT NULL);
CREATE UNIQUE INDEX "TimeCorrectionRequest_one_pending_per_entry" ON "TimeCorrectionRequest" ("entryId")
  WHERE "status" = 'PENDING';

ALTER TABLE "MonthClosing" ADD CONSTRAINT "MonthClosing_month_format" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "OvertimeAdjustment" ADD CONSTRAINT "OvertimeAdjustment_reason"
  CHECK (length(trim("reason")) > 0 AND "minutes" <> 0);

-- Revisionen und Überstundenkorrekturen sind append-only (CLAUDE.md: Zeitbuchungen nie überschreiben).
CREATE FUNCTION reject_append_only_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% ist unveränderlich', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "TimeEntryRevision_append_only" BEFORE UPDATE OR DELETE ON "TimeEntryRevision"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "TimeEntryRevision_no_truncate" BEFORE TRUNCATE ON "TimeEntryRevision"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "OvertimeAdjustment_append_only" BEFORE UPDATE OR DELETE ON "OvertimeAdjustment"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "OvertimeAdjustment_no_truncate" BEFORE TRUNCATE ON "OvertimeAdjustment"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();

-- Buchungen werden nie gelöscht.
CREATE TRIGGER "TimeEntry_no_delete" BEFORE DELETE ON "TimeEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "TimeEntry_no_truncate" BEFORE TRUNCATE ON "TimeEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
