const express = require("express");

const router = express.Router();

const {
  authMiddleware,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  getPendingDoctors,
  verifyDoctor,
  rejectDoctor,
  getPendingPharmacies,
  verifyPharmacy,
  rejectPharmacy,
  createMasterMedicine,
  updateMasterMedicine,
} = require("../controllers/adminController");

// All admin routes require valid authentication and ADMIN role
router.use(authMiddleware);
router.use(authorizeRoles("ADMIN"));

// Doctor Verification
router.get("/doctors/pending", getPendingDoctors);
router.put("/doctors/:doctorProfileId/verify", verifyDoctor);
router.put("/doctors/:doctorProfileId/reject", rejectDoctor);

// Pharmacy Verification
router.get("/pharmacies/pending", getPendingPharmacies);
router.put("/pharmacies/:id/verify", verifyPharmacy);
router.put("/pharmacies/:id/reject", rejectPharmacy);

// Master Medicine Catalog Management
router.post("/medicines", createMasterMedicine);
router.put("/medicines/:id", updateMasterMedicine);

module.exports = router;
