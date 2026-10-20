-- CreateEnum
CREATE TYPE "AbsenceType" AS ENUM ('VACATION', 'OVERTIME_OFF', 'SPECIAL_LEAVE');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveLedgerKind" AS ENUM ('CORRECTION', 'FORFEIT');

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "type" "AbsenceType" NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "startHalf" BOOLEAN NOT NULL DEFAULT false,
    "endHalf" BOOLEAN NOT NULL DEFAULT false,
    "halfDays" INTEGER NOT NULL,
    "note" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "requestedAt" TIMESTAMPTZ(3) NOT NULL,
    "requestedById" UUID NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "decidedById" UUID,
    "decisionReason" TEXT,
    "cancelRequestedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "overdueNotifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveLedgerEntry" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" "LeaveLedgerKind" NOT NULL,
    "halfDays" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_from_idx" ON "LeaveRequest"("employeeId", "from");

-- CreateIndex
CREATE INDEX "LeaveRequest_status_idx" ON "LeaveRequest"("status");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_employeeId_year_idx" ON "LeaveLedgerEntry"("employeeId", "year");

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 3: Plausibilität der Anträge
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_range" CHECK ("to" >= "from");
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_half_single_day"
  CHECK (NOT ("from" = "to" AND "startHalf" AND "endHalf"));
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_half_days_positive" CHECK ("halfDays" > 0);
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_note_length"
  CHECK ("note" IS NULL OR length("note") <= 140);
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_decided"
  CHECK ("status" NOT IN ('APPROVED', 'REJECTED', 'CANCELLED') OR ("decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL));
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_reject_reason"
  CHECK ("status" <> 'REJECTED' OR ("decisionReason" IS NOT NULL AND length(trim("decisionReason")) > 0));
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_cancelled"
  CHECK ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL));

-- Keine zwei offenen oder genehmigten Anträge derselben Person mit überlappendem Zeitraum, auch bei parallelen Anträgen.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_no_overlap"
  EXCLUDE USING gist ("employeeId" WITH =, daterange("from", "to", '[]') WITH &&)
  WHERE ("status" IN ('PENDING', 'APPROVED'));

-- Kernfelder unveränderlich, nur erlaubte Statuswechsel, nie löschen.
CREATE FUNCTION guard_leave_request_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LeaveRequest darf nicht gelöscht werden' USING ERRCODE = 'restrict_violation';
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

CREATE TRIGGER "LeaveRequest_guard" BEFORE UPDATE OR DELETE ON "LeaveRequest"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_request_change();
CREATE TRIGGER "LeaveRequest_no_truncate" BEFORE TRUNCATE ON "LeaveRequest"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();

-- Korrekturbuchungen: append-only
ALTER TABLE "LeaveLedgerEntry" ADD CONSTRAINT "LeaveLedgerEntry_values"
  CHECK ("halfDays" <> 0 AND length(trim("note")) > 0);
CREATE TRIGGER "LeaveLedgerEntry_append_only" BEFORE UPDATE OR DELETE ON "LeaveLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_append_only_change();
CREATE TRIGGER "LeaveLedgerEntry_no_truncate" BEFORE TRUNCATE ON "LeaveLedgerEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION reject_append_only_change();
