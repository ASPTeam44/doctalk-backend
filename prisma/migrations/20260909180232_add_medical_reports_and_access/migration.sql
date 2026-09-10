-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'UPLOADED', 'FAILED');

-- CreateTable
CREATE TABLE "MedicalReport" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "s3Key" TEXT NOT NULL,
    "reportDate" TIMESTAMP(3) NOT NULL,
    "uploadStatus" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAccess" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "grantedByPatientId" TEXT NOT NULL,
    "appointmentId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ReportAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAuditLog" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MedicalReport_s3Key_key" ON "MedicalReport"("s3Key");

-- CreateIndex
CREATE INDEX "MedicalReport_patientId_idx" ON "MedicalReport"("patientId");

-- CreateIndex
CREATE INDEX "MedicalReport_reportDate_idx" ON "MedicalReport"("reportDate");

-- CreateIndex
CREATE INDEX "ReportAccess_doctorId_reportId_idx" ON "ReportAccess"("doctorId", "reportId");

-- CreateIndex
CREATE INDEX "ReportAccess_reportId_idx" ON "ReportAccess"("reportId");

-- CreateIndex
CREATE INDEX "ReportAccess_grantedByPatientId_idx" ON "ReportAccess"("grantedByPatientId");

-- CreateIndex
CREATE INDEX "ReportAuditLog_reportId_idx" ON "ReportAuditLog"("reportId");

-- CreateIndex
CREATE INDEX "ReportAuditLog_userId_idx" ON "ReportAuditLog"("userId");

-- AddForeignKey
ALTER TABLE "MedicalReport" ADD CONSTRAINT "MedicalReport_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAccess" ADD CONSTRAINT "ReportAccess_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "MedicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAccess" ADD CONSTRAINT "ReportAccess_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAccess" ADD CONSTRAINT "ReportAccess_grantedByPatientId_fkey" FOREIGN KEY ("grantedByPatientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAccess" ADD CONSTRAINT "ReportAccess_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAuditLog" ADD CONSTRAINT "ReportAuditLog_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "MedicalReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAuditLog" ADD CONSTRAINT "ReportAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
