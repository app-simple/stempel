-- AlterTable
ALTER TABLE "LeaveNotice" ADD COLUMN     "emailSentAt" TIMESTAMPTZ(3);

-- Codex-Review Phase 4 API, Befund 7: Die Löschfreigabe gilt nur in der Transaktion, die sie setzt.
-- Der Löschjob setzt `asos.purge` per `set_config(..., true)` auf seine Transaktions-ID; ein
-- sitzungsweites `SET` gibt in späteren Transaktionen nichts frei.
CREATE OR REPLACE FUNCTION asos_purge_allowed() RETURNS boolean AS $$
  SELECT coalesce(current_setting('asos.purge', true), '') = txid_current()::text;
$$ LANGUAGE sql VOLATILE;

-- Befund 8: E-Mail-Zustellung getrennt vom Bereitstellen; Lesebestätigung und Zustellung je einmal.
CREATE OR REPLACE FUNCTION guard_leave_notice_change() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF asos_purge_allowed() THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'LeaveNotice ist unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (NEW."employeeId", NEW."year", NEW."restHalfDays", NEW."text", NEW."sentAt", NEW."sentById")
       IS DISTINCT FROM
     (OLD."employeeId", OLD."year", OLD."restHalfDays", OLD."text", OLD."sentAt", OLD."sentById")
     OR (OLD."readAt" IS NOT NULL AND NEW."readAt" IS DISTINCT FROM OLD."readAt")
     OR (OLD."readAt" IS NULL AND NEW."readAt" IS NULL AND NEW."emailSentAt" IS NOT DISTINCT FROM OLD."emailSentAt")
     OR (OLD."emailSentAt" IS NOT NULL AND NEW."emailSentAt" IS DISTINCT FROM OLD."emailSentAt") THEN
    RAISE EXCEPTION 'LeaveNotice ist unveränderlich' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
