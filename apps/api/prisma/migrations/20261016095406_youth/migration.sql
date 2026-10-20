-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "birthDate" DATE,
ADD COLUMN     "fullTimeSchoolUntil" DATE;

-- CreateTable
CREATE TABLE "SchoolHoliday" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SchoolHoliday_from_idx" ON "SchoolHoliday"("from");

-- Personen unter 15 beim Eintritt sind nicht beschäftigbar (§ 5 Abs. 1 JArbSchG, Phase 7).
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_min_age_15"
  CHECK ("birthDate" IS NULL OR "birthDate" <= ("entryDate" - interval '15 years')::date);

-- Schulferien: gültiger Zeitraum.
ALTER TABLE "SchoolHoliday" ADD CONSTRAINT "SchoolHoliday_range" CHECK ("to" >= "from");
