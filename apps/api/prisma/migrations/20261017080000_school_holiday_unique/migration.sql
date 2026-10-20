-- Derselbe Ferienzeitraum nur einmal (Review Web Phase 7, Befund 2). Vorher angelegte Doppelungen
-- (keine personenbezogenen Daten) entfallen; der älteste Eintrag bleibt.
DELETE FROM "SchoolHoliday" a
  USING "SchoolHoliday" b
  WHERE a."from" = b."from"
    AND a."to" = b."to"
    AND (a."createdAt", a.id) > (b."createdAt", b.id);

CREATE UNIQUE INDEX "SchoolHoliday_from_to_key" ON "SchoolHoliday"("from", "to");
