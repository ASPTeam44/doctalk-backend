const express = require("express");

const router = express.Router();

const {
  authMiddleware,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  createDoctorProfile,
  getAllDoctors,
  getAvailableSlots,
} = require("../controllers/doctorController");

const {
  createSchedule,
  getMySchedule,
  updateSchedule,
  deleteSchedule,
} = require("../controllers/scheduleController");

// --- PUBLIC ROUTES ---

// Get All Verified Doctors (Public with pagination and search)
router.get("/all", getAllDoctors);

// Get Available Slots for a Doctor on a Date (Public)
router.get("/:doctorId/available-slots", getAvailableSlots);

// --- DOCTOR PROTECTED ROUTES ---

// Create Doctor Profile (Requires DOCTOR role)
router.post(
  "/create-profile",
  authMiddleware,
  authorizeRoles("DOCTOR"),
  createDoctorProfile
);

// Manage Doctor Availability Schedule (Requires DOCTOR role)
router.post(
  "/schedule",
  authMiddleware,
  authorizeRoles("DOCTOR"),
  createSchedule
);

router.get(
  "/schedule",
  authMiddleware,
  authorizeRoles("DOCTOR"),
  getMySchedule
);

router.put(
  "/schedule/:scheduleId",
  authMiddleware,
  authorizeRoles("DOCTOR"),
  updateSchedule
);

router.delete(
  "/schedule/:scheduleId",
  authMiddleware,
  authorizeRoles("DOCTOR"),
  deleteSchedule
);

module.exports = router;