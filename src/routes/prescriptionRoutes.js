const express = require("express");

const router = express.Router();

const {
  authMiddleware,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  createPrescription,
  updatePrescription,
  issuePrescription,
  cancelPrescription,
  getMyPrescriptions,
  getDoctorPrescriptions,
  getPrescriptionById,
} = require("../controllers/prescriptionController");

// All prescription routes require valid JWT authentication
router.use(authMiddleware);

// --- PATIENT ROUTES ---
// View patient's own released prescriptions
router.get(
  "/my-prescriptions",
  authorizeRoles("PATIENT"),
  getMyPrescriptions
);

// --- DOCTOR ROUTES ---
// List doctor's own authored prescriptions
router.get(
  "/doctor",
  authorizeRoles("DOCTOR"),
  getDoctorPrescriptions
);

// Create new prescription (Doctor only)
router.post(
  "/",
  authorizeRoles("DOCTOR"),
  createPrescription
);

// Update DRAFT prescription (Doctor only)
router.put(
  "/:id",
  authorizeRoles("DOCTOR"),
  updatePrescription
);

// Finalize and issue prescription (Doctor only)
router.post(
  "/:id/issue",
  authorizeRoles("DOCTOR"),
  issuePrescription
);

// Cancel prescription (Doctor only)
router.post(
  "/:id/cancel",
  authorizeRoles("DOCTOR"),
  cancelPrescription
);

// --- SHARED / AUTHORIZED ROUTE ---
// View specific prescription by ID (Patient owner or Authoring Doctor)
router.get(
  "/:id",
  getPrescriptionById
);

module.exports = router;
