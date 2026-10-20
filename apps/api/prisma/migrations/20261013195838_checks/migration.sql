-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "retentionAuditYears" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "retentionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "retentionLeaveYears" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "retentionPayrollYears" INTEGER NOT NULL DEFAULT 8,
ADD COLUMN     "retentionTimeYears" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "LeaveNotice" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "restHalfDays" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL,
    "sentById" UUID NOT NULL,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "LeaveNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveNotice_employeeId_year_idx" ON "LeaveNotice"("employeeId", "year");

-- AddForeignKey
ALTER TABLE "LeaveNotice" ADD CONSTRAINT "LeaveNotice_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 4: Aufbewahrungsfristen mindestens zwei Jahre (§ 16 Abs. 2 ArbZG, § 17 Abs. 1 MiLoG).
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_retention_minimum"
  CHECK ("retentionTimeYears" >= 2 AND "retentionPayrollYears" >= 2 AND "retentionLeaveYears" >= 2
         AND "retentionAuditYears" >= 2 AND "retentionTimeYears" <= 30 AND "retentionPayrollYears" <= 30
         AND "retentionLeaveYears" <= 30 AND "retentionAuditYears" <= 30);

ALTER TABLE "LeaveNotice" ADD CONSTRAINT "LeaveNotice_values"
  CHECK (length(trim("text")) > 0 AND "restHalfDays" >= 0);

-- Löschen geschützter Daten nur durch den Löschjob: Er setzt in seiner Transaktion
-- `SET LOCAL asos.purge = 'on'` (Phase 4, Entscheidung 6). Ändern bleibt immer verboten.
CREATE FUNCTION asos_purge_allowed() RETURNS boolean AS $$
  SELECT coalesce(current_setting('asos.purge', true), '') = 'on';
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION reject_append_only_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND asos_purge_allowed() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION '% ist unveränderlich', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION audit_log_reject_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND asos_purge_allowed() THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AuditLog ist unveränderlich';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION guard_leave_request_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF asos_purge_allowed() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LeaveRequest darf nicht gelöscht werden' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."decidedById" = NEW."employeeId" OR NEW."cancelledById" = NEW."employeeId")
     AND NOT EXISTS (SELECT 1 FROM "Employee" e WHERE e.id = NEW."employeeId" AND e.role = 'ADMIN') THEN
    RAISE EXCEPTION 'Über eigene Anträge entscheidet nur der Admin' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."status" = 'CANCELLED' AND NEW."cancelRequestedAt" IS NULL THEN
    RAISE EXCEPTION 'Stornierung nur mit Einverständnis' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;
  IF (NEW."employeeId", NEW."type", NEW."from", NEW."to", NEW."startHalf", NEW."endHalf", NEW."halfDays",
      NEW."note", NEW."requestedAt", NEW."requestedById")
     IS DISTINCT FROM
     (OLD."employeeId", OLD."type", OLD."from", OLD."to", OLD."startHalf", OLD."endHalf", OLD."halfDays",
      OLD."note", OLD."requestedAt", OLD."requestedById") THEN
    RAISE EXCEPTION 'Kernfelder eines Antrags sind unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('REJECTED', 'WITHDRAWN', 'CANCELLED') THEN
    RAISE EXCEPTION 'Abgeschlossener Antrag ist unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'PENDING' AND NEW."status" NOT IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'Unzulässiger Statuswechsel' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'APPROVED' AND (
       NEW."status" NOT IN ('APPROVED', 'CANCELLED')
       OR (NEW."decidedAt", NEW."decidedById", NEW."decisionReason")
          IS DISTINCT FROM (OLD."decidedAt", OLD."decidedById", OLD."decisionReason")) THEN
    RAISE EXCEPTION 'Unzulässiger Statuswechsel' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Urlaubshinweis: nur die einmalige Lesebestätigung ist eine erlaubte Änderung.
CREATE FUNCTION guard_leave_notice_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF asos_purge_allowed() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LeaveNotice ist unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."readAt" IS NOT NULL OR NEW."readAt" IS NULL
     OR (NEW."employeeId", NEW."year", NEW."restHalfDays", NEW."text", NEW."sentAt", NEW."sentById")
        IS DISTINCT FROM
        (OLD."employeeId", OLD."year", OLD."restHalfDays", OLD."text", OLD."sentAt", OLD."sentById") THEN
    RAISE EXCEPTION 'LeaveNotice ist unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LeaveNotice_guard" BEFORE UPDATE OR DELETE ON "LeaveNotice"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_notice_change();
CREATE TRIGGER "LeaveNotice_no_truncate" BEFORE TRUNCATE ON "LeaveNotice"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
