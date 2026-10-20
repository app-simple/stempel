-- Befunde Codex-Review AP5 (docs/reviews/ap5-anmeldung.md), Nr. 3 und 7.

-- CHECK akzeptiert NULL als erfüllt: Arbeitstage daher NOT NULL.
ALTER TABLE "EmploymentTerms" ALTER COLUMN "workDays" SET NOT NULL;

-- Minijob verlangt ausdrücklich einen Stundenlohn.
ALTER TABLE "EmploymentTerms" DROP CONSTRAINT "EmploymentTerms_wage_only_minijob";
ALTER TABLE "EmploymentTerms" ADD CONSTRAINT "EmploymentTerms_wage_only_minijob"
  CHECK (("type" = 'MINIJOB' AND "hourlyWageCents" IS NOT NULL AND "hourlyWageCents" > 0)
      OR ("type" <> 'MINIJOB' AND "hourlyWageCents" IS NULL));

-- Höchstens ein offener Anmeldecode je Person, auch bei parallelen Anforderungen.
CREATE UNIQUE INDEX "LoginCode_one_open_per_employee" ON "LoginCode" ("employeeId") WHERE "usedAt" IS NULL;
