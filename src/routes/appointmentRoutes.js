const express = require("express");

const router = express.Router();

const authMiddleware = require("../middleware/authMiddleware");

const {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
} = require("../controllers/appointmentController");

// Book Appointment
router.post(
  "/book",
  authMiddleware,
  bookAppointment
);

// Patient Appointments
router.get(
  "/my-appointments",
  authMiddleware,
  getPatientAppointments
);

// Doctor Appointments
router.get(
  "/doctor-appointments",
  authMiddleware,
  getDoctorAppointments
);

router.put(
  "/update-status/:appointmentId",
  authMiddleware,
  updateAppointmentStatus
);

module.exports = router;