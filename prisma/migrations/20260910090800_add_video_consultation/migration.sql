-- CreateEnum
CREATE TYPE "VideoSessionStatus" AS ENUM ('CREATED', 'ACTIVE', 'ENDED', 'EXPIRED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ConsultationSession" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roomToken" TEXT NOT NULL,
    "status" "VideoSessionStatus" NOT NULL DEFAULT 'CREATED',
    "scheduledStartAt" TIMESTAMP(3) NOT NULL,
    "scheduledEndAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoAuditLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT,
    "appointmentId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_appointmentId_key" ON "ConsultationSession"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_roomId_key" ON "ConsultationSession"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationSession_roomToken_key" ON "ConsultationSession"("roomToken");

-- CreateIndex
CREATE INDEX "ConsultationSession_appointmentId_idx" ON "ConsultationSession"("appointmentId");

-- CreateIndex
CREATE INDEX "ConsultationSession_patientId_idx" ON "ConsultationSession"("patientId");

-- CreateIndex
CREATE INDEX "ConsultationSession_doctorId_idx" ON "ConsultationSession"("doctorId");

-- CreateIndex
CREATE INDEX "ConsultationSession_roomId_idx" ON "ConsultationSession"("roomId");

-- CreateIndex
CREATE INDEX "ConsultationSession_status_idx" ON "ConsultationSession"("status");

-- CreateIndex
CREATE INDEX "ConsultationSession_scheduledStartAt_idx" ON "ConsultationSession"("scheduledStartAt");

-- CreateIndex
CREATE INDEX "VideoAuditLog_sessionId_idx" ON "VideoAuditLog"("sessionId");

-- CreateIndex
CREATE INDEX "VideoAuditLog_appointmentId_idx" ON "VideoAuditLog"("appointmentId");

-- CreateIndex
CREATE INDEX "VideoAuditLog_userId_idx" ON "VideoAuditLog"("userId");

-- CreateIndex
CREATE INDEX "VideoAuditLog_action_idx" ON "VideoAuditLog"("action");

-- CreateIndex
CREATE INDEX "VideoAuditLog_createdAt_idx" ON "VideoAuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationSession" ADD CONSTRAINT "ConsultationSession_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAuditLog" ADD CONSTRAINT "VideoAuditLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ConsultationSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoAuditLog" ADD CONSTRAINT "VideoAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
