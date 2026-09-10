const path = require("path");
const prisma = require("../config/prisma");
const {
  generateS3Key,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteS3Object,
} = require("../services/s3Service");
const { logReportAction } = require("../services/auditService");

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB in bytes

const ALLOWED_MIME_TYPES = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

// Helper: validate and sanitize file input
const validateFileInput = (fileName, mimeType, fileSize) => {
  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    return { valid: false, message: "Valid fileName is required" };
  }

  if (!mimeType || !ALLOWED_MIME_TYPES[mimeType]) {
    return {
      valid: false,
      message: `Invalid mimeType. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`,
    };
  }

  const parsedSize = parseInt(fileSize, 10);
  if (isNaN(parsedSize) || parsedSize <= 0 || parsedSize > MAX_FILE_SIZE) {
    return {
      valid: false,
      message: "fileSize must be greater than 0 and less than or equal to 10 MB",
    };
  }

  const cleanBaseName = path.basename(fileName.trim());
  const ext = path.extname(cleanBaseName).toLowerCase();
  const allowedExts = ALLOWED_MIME_TYPES[mimeType];

  if (!allowedExts.includes(ext)) {
    return {
      valid: false,
      message: `File extension "${ext}" does not match declared MIME type "${mimeType}"`,
    };
  }

  return {
    valid: true,
    cleanFileName: cleanBaseName,
    extension: ext,
    fileSize: parsedSize,
  };
};

// Format safe report object (never leaks raw S3 credentials)
const toSafeReport = (report) => ({
  id: report.id,
  patientId: report.patientId,
  title: report.title,
  reportType: report.reportType,
  fileName: report.fileName,
  mimeType: report.mimeType,
  fileSize: report.fileSize,
  reportDate: report.reportDate,
  uploadStatus: report.uploadStatus,
  createdAt: report.createdAt,
  updatedAt: report.updatedAt,
});

// 1. REQUEST PRESIGNED UPLOAD URL
// POST /api/reports/upload-url (Patient only)
const requestUploadUrl = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const { title, reportType, reportDate, fileName, mimeType, fileSize } = req.body;

    if (!title || typeof title !== "string" || !title.trim()) {
      return res.status(400).json({ message: "Title is required" });
    }

    if (!reportType || typeof reportType !== "string" || !reportType.trim()) {
      return res.status(400).json({ message: "Report type is required (e.g. Lab Report, Scan)" });
    }

    if (!reportDate || isNaN(new Date(reportDate).getTime())) {
      return res.status(400).json({ message: "A valid reportDate is required" });
    }

    const fileValidation = validateFileInput(fileName, mimeType, fileSize);
    if (!fileValidation.valid) {
      return res.status(400).json({ message: fileValidation.message });
    }

    // Step 1: Create report record with PENDING status and temporary S3 key placeholder
    const tempKey = `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const report = await prisma.medicalReport.create({
      data: {
        patientId,
        title: title.trim(),
        reportType: reportType.trim(),
        fileName: fileValidation.cleanFileName,
        mimeType,
        fileSize: fileValidation.fileSize,
        s3Key: tempKey,
        reportDate: new Date(reportDate),
        uploadStatus: "PENDING",
      },
    });

    // Step 2: Generate server-controlled deterministic S3 key
    const s3Key = generateS3Key(patientId, report.id, fileValidation.extension);

    // Step 3: Update report with final deterministic S3 key
    await prisma.medicalReport.update({
      where: { id: report.id },
      data: { s3Key },
    });

    // Step 4: Generate presigned PUT URL
    const uploadUrl = await getPresignedUploadUrl(s3Key, mimeType, 900);

    // Audit log
    await logReportAction({
      reportId: report.id,
      userId: patientId,
      action: "UPLOAD_REQUESTED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      message: "Presigned upload URL generated successfully",
      reportId: report.id,
      uploadUrl,
      expiresIn: 900,
      s3Key,
    });
  } catch (error) {
    next(error);
  }
};

// 2. COMPLETE UPLOAD
// POST /api/reports/:reportId/complete-upload (Patient only)
const completeUpload = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const patientId = req.user.id;

    const report = await prisma.medicalReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({ message: "Medical report not found" });
    }

    if (report.patientId !== patientId) {
      return res.status(403).json({ message: "Unauthorized: you do not own this medical report" });
    }

    const updated = await prisma.medicalReport.update({
      where: { id: reportId },
      data: { uploadStatus: "UPLOADED" },
    });

    await logReportAction({
      reportId: report.id,
      userId: patientId,
      action: "UPLOAD_COMPLETED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      message: "Medical report upload marked as completed",
      report: toSafeReport(updated),
    });
  } catch (error) {
    next(error);
  }
};

// 3. GET PATIENT'S OWN REPORTS
// GET /api/reports/my-reports (Patient only)
const getMyReports = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    const reports = await prisma.medicalReport.findMany({
      where: { patientId },
      orderBy: { reportDate: "desc" },
    });

    res.status(200).json({
      reports: reports.map(toSafeReport),
    });
  } catch (error) {
    next(error);
  }
};

// 4. GET PRESIGNED DOWNLOAD URL
// GET /api/reports/:reportId/download-url (Authenticated - Owner Patient or Authorized Doctor)
const getDownloadUrl = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const report = await prisma.medicalReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({ message: "Medical report not found" });
    }

    // Access control check
    let isAuthorized = false;

    if (userRole === "PATIENT" && report.patientId === userId) {
      isAuthorized = true;
    } else if (userRole === "DOCTOR") {
      const activeAccess = await prisma.reportAccess.findFirst({
        where: {
          reportId: report.id,
          doctorId: userId,
          revokedAt: null,
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      });

      if (activeAccess) {
        isAuthorized = true;
      }
    }

    if (!isAuthorized) {
      return res.status(403).json({
        message: "Access forbidden: you do not have permission to view or download this medical report",
      });
    }

    const downloadUrl = await getPresignedDownloadUrl(report.s3Key, report.fileName, 900);

    await logReportAction({
      reportId: report.id,
      userId,
      action: "VIEW_DOWNLOAD_URL",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      reportId: report.id,
      downloadUrl,
      expiresIn: 900,
    });
  } catch (error) {
    next(error);
  }
};

// 5. DELETE MEDICAL REPORT
// DELETE /api/reports/:reportId (Patient only)
const deleteReport = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const patientId = req.user.id;

    const report = await prisma.medicalReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({ message: "Medical report not found" });
    }

    if (report.patientId !== patientId) {
      return res.status(403).json({ message: "Unauthorized: you do not own this medical report" });
    }

    // Log deletion action before record is removed
    await logReportAction({
      reportId,
      userId: patientId,
      action: "DELETED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Delete S3 object safely
    await deleteS3Object(report.s3Key);

    // Delete database metadata
    await prisma.medicalReport.delete({
      where: { id: reportId },
    });

    res.status(200).json({
      message: "Medical report deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// 6. GRANT REPORT ACCESS TO DOCTOR
// POST /api/reports/:reportId/access (Patient only)
const grantReportAccess = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const patientId = req.user.id;
    const { doctorId, appointmentId, expiresAt } = req.body;

    if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
      return res.status(400).json({ message: "doctorId is required" });
    }

    const report = await prisma.medicalReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({ message: "Medical report not found" });
    }

    if (report.patientId !== patientId) {
      return res.status(403).json({ message: "Unauthorized: you do not own this medical report" });
    }

    // Check doctor existence and role
    const doctorUser = await prisma.user.findUnique({
      where: { id: doctorId.trim() },
    });

    if (!doctorUser || doctorUser.role !== "DOCTOR") {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // Validate appointment if provided
    let cleanAppointmentId = null;
    if (appointmentId) {
      const appointment = await prisma.appointment.findUnique({
        where: { id: appointmentId },
      });
      if (
        !appointment ||
        appointment.patientId !== patientId ||
        appointment.doctorId !== doctorId.trim()
      ) {
        return res.status(400).json({
          message: "appointmentId does not correspond to a valid appointment between you and this doctor",
        });
      }
      cleanAppointmentId = appointment.id;
    }

    // Validate expiresAt if provided
    let parsedExpiry = null;
    if (expiresAt) {
      parsedExpiry = new Date(expiresAt);
      if (isNaN(parsedExpiry.getTime()) || parsedExpiry <= new Date()) {
        return res.status(400).json({
          message: "expiresAt must be a valid date in the future",
        });
      }
    }

    const access = await prisma.reportAccess.create({
      data: {
        reportId: report.id,
        doctorId: doctorUser.id,
        grantedByPatientId: patientId,
        appointmentId: cleanAppointmentId,
        expiresAt: parsedExpiry,
      },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    await logReportAction({
      reportId: report.id,
      userId: patientId,
      action: "ACCESS_GRANTED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      message: "Access granted to doctor successfully",
      access,
    });
  } catch (error) {
    next(error);
  }
};

// 7. GET ACCESS LIST FOR A REPORT
// GET /api/reports/:reportId/access (Patient only)
const getReportAccessList = async (req, res, next) => {
  try {
    const { reportId } = req.params;
    const patientId = req.user.id;

    const report = await prisma.medicalReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({ message: "Medical report not found" });
    }

    if (report.patientId !== patientId) {
      return res.status(403).json({ message: "Unauthorized: you do not own this medical report" });
    }

    const accessList = await prisma.reportAccess.findMany({
      where: { reportId },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            email: true,
            doctorProfile: {
              select: {
                specialization: true,
                hospitalName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      accessList,
    });
  } catch (error) {
    next(error);
  }
};

// 8. REVOKE DOCTOR ACCESS
// DELETE /api/reports/:reportId/access/:accessId (Patient only)
const revokeReportAccess = async (req, res, next) => {
  try {
    const { reportId, accessId } = req.params;
    const patientId = req.user.id;

    const report = await prisma.medicalReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      return res.status(404).json({ message: "Medical report not found" });
    }

    if (report.patientId !== patientId) {
      return res.status(403).json({ message: "Unauthorized: you do not own this medical report" });
    }

    const access = await prisma.reportAccess.findUnique({
      where: { id: accessId },
    });

    if (!access || access.reportId !== reportId) {
      return res.status(404).json({ message: "Access record not found for this report" });
    }

    const updatedAccess = await prisma.reportAccess.update({
      where: { id: accessId },
      data: { revokedAt: new Date() },
    });

    await logReportAction({
      reportId: report.id,
      userId: patientId,
      action: "ACCESS_REVOKED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      message: "Doctor access to medical report revoked successfully",
      access: updatedAccess,
    });
  } catch (error) {
    next(error);
  }
};

// 9. GET AUTHORIZED PATIENT REPORTS FOR DOCTOR
// GET /api/reports/patient/:patientId (Doctor only)
const getPatientReportsForDoctor = async (req, res, next) => {
  try {
    const { patientId } = req.params;
    const doctorId = req.user.id;

    // Doctor can only see reports with active, non-revoked, non-expired access
    const activeAccesses = await prisma.reportAccess.findMany({
      where: {
        doctorId,
        revokedAt: null,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
        report: {
          patientId,
          uploadStatus: "UPLOADED",
        },
      },
      include: {
        report: true,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (activeAccesses.length === 0) {
      return res.status(403).json({
        message: "Access forbidden: you do not have permission to view this patient's medical reports",
      });
    }

    const authorizedReports = activeAccesses.map((a) => toSafeReport(a.report));

    res.status(200).json({
      reports: authorizedReports,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  requestUploadUrl,
  completeUpload,
  getMyReports,
  getDownloadUrl,
  deleteReport,
  grantReportAccess,
  getReportAccessList,
  revokeReportAccess,
  getPatientReportsForDoctor,
};
