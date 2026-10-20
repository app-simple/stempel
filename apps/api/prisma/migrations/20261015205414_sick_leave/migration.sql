-- CreateEnum
CREATE TYPE "SickKind" AS ENUM ('SICK', 'CHILD_SICK', 'NEUTRAL');

-- AlterEnum
ALTER TYPE "LeaveLedgerKind" ADD VALUE 'SICK_CREDIT';

-- AlterEnum
ALTER TYPE "ReminderKind" ADD VALUE 'CERTIFICATE';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "certificateFromDay1" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "LeaveLedgerEntry" ADD COLUMN     "sickLeaveId" UUID;

-- CreateTable
CREATE TABLE "SickLeave" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "SickKind" NOT NULL,
    "from" DATE NOT NULL,
    "to" DATE NOT NULL,
    "sinceMinute" INTEGER,
    "reportedAt" TIMESTAMPTZ(3) NOT NULL,
    "reportedById" UUID,
    "certificateUntil" DATE,
    "certificateAt" TIMESTAMPTZ(3),
    "certificateById" UUID,
    "endedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SickLeave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SickLeave_employeeId_from_idx" ON "SickLeave"("employeeId", "from");

-- CreateIndex
CREATE INDEX "LeaveLedgerEntry_sickLeaveId_idx" ON "LeaveLedgerEntry"("sickLeaveId");

-- AddForeignKey
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Zeitraum gültig, Uhrzeit des Heimgehens innerhalb des Tages (Spezifikation Phase 6, Abschnitt 3).
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_range" CHECK ("to" >= "from");
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_since_minute"
  CHECK ("sinceMinute" IS NULL OR "sinceMinute" BETWEEN 0 AND 1439);

-- Keine zwei Krankmeldungen derselben Person mit überlappendem Zeitraum, auch bei parallelen Meldungen.
-- Überschneidungen mit Urlaub sind erlaubt (krank im Urlaub, § 9 BUrlG).
ALTER TABLE "SickLeave" ADD CONSTRAINT "SickLeave_no_overlap"
  EXCLUDE USING gist ("employeeId" WITH =, daterange("from", "to", '[]') WITH &&);
