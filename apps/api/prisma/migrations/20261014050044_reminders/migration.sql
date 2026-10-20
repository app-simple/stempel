-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('CLOCK_IN', 'CLOCK_OUT', 'MINIJOB_RECORDING');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('PUSH', 'EMAIL');

-- AlterTable
ALTER TABLE "CompanySettings" ADD COLUMN     "lateFlagMinCount" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "lateFlagMinPercent" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "lateFlagWeeks" INTEGER NOT NULL DEFAULT 6,
ADD COLUMN     "reminderDefaultStart" TEXT NOT NULL DEFAULT '08:00';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "reminderEmailFallback" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSuccessAt" TIMESTAMPTZ(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReminderLog" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "stage" INTEGER NOT NULL,
    "channel" "ReminderChannel",
    "sentAt" TIMESTAMPTZ(3),
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_employeeId_idx" ON "PushSubscription"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ReminderLog_employeeId_date_kind_stage_key" ON "ReminderLog"("employeeId", "date", "kind", "stage");

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 5: Plausibilität der Einstellungen und Erinnerungen.
ALTER TABLE "CompanySettings" ADD CONSTRAINT "CompanySettings_reminder_values"
  CHECK ("reminderDefaultStart" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         AND "lateFlagMinCount" BETWEEN 1 AND 100
         AND "lateFlagMinPercent" BETWEEN 1 AND 100
         AND "lateFlagWeeks" BETWEEN 1 AND 52);
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_stage" CHECK ("stage" BETWEEN 0 AND 10);
ALTER TABLE "ReminderLog" ADD CONSTRAINT "ReminderLog_muted" CHECK (NOT "muted" OR ("stage" = 0 AND "channel" IS NULL));
