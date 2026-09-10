const express = require("express");

const router = express.Router();

const {
  authMiddleware,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  requestUploadUrl,
  completeUpload,
  getMyReports,
  getDownloadUrl,
  deleteReport,
  grantReportAccess,
  getReportAccessList,
  revokeReportAccess,
  getPatientReportsForDoctor,
} = require("../controllers/reportController");

// All medical report routes require authentication
router.use(authMiddleware);

// --- PATIENT ROUTES ---

// 1. Request presigned upload URL
router.post(
  "/upload-url",
  authorizeRoles("PATIENT"),
  requestUploadUrl
);

// 2. Complete upload
router.post(
  "/:reportId/complete-upload",
  authorizeRoles("PATIENT"),
  completeUpload
);

// 3. View my own reports
router.get(
  "/my-reports",
  authorizeRoles("PATIENT"),
  getMyReports
);

// 4. Delete my report
router.delete(
  "/:reportId",
  authorizeRoles("PATIENT"),
  deleteReport
);

// 5. Grant access to a doctor
router.post(
  "/:reportId/access",
  authorizeRoles("PATIENT"),
  grantReportAccess
);

// 6. View access list for a report
router.get(
  "/:reportId/access",
  authorizeRoles("PATIENT"),
  getReportAccessList
);

// 7. Revoke access from a doctor
router.delete(
  "/:reportId/access/:accessId",
  authorizeRoles("PATIENT"),
  revokeReportAccess
);

// --- DOCTOR ROUTES ---

// 8. View authorized patient reports
router.get(
  "/patient/:patientId",
  authorizeRoles("DOCTOR"),
  getPatientReportsForDoctor
);

// --- SHARED / AUTHORIZED ACCESS ---

// 9. Request presigned download URL (Patient owner or authorized Doctor)
router.get(
  "/:reportId/download-url",
  getDownloadUrl
);

module.exports = router;
