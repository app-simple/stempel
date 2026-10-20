-- Phase 3, Codex-Review API Befund 6: Entscheidungsregeln auch in der Datenbank.
-- Niemand außer dem Admin entscheidet über eigene Anträge (Entscheidung 8), und eine Stornierung
-- setzt das Einverständnis der Person voraus (Entscheidung 9).
CREATE OR REPLACE FUNCTION guard_leave_request_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
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

CREATE TRIGGER "LeaveRequest_guard_insert" BEFORE INSERT ON "LeaveRequest"
  FOR EACH ROW EXECUTE FUNCTION guard_leave_request_change();
