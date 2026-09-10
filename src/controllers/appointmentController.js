const prisma = require("../config/prisma");

const ALLOWED_STATUSES = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"];

const VALID_TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const DAYS_OF_WEEK = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
];

const timeToMinutes = (timeStr) => {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
};

// BOOK APPOINTMENT
const bookAppointment = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const { doctorId, appointmentDate, symptoms } = req.body;

    if (!doctorId || typeof doctorId !== "string" || !doctorId.trim()) {
      return res.status(400).json({
        message: "doctorId is required",
      });
    }

    if (!appointmentDate) {
      return res.status(400).json({
        message: "appointmentDate is required",
      });
    }

    const requestedTime = new Date(appointmentDate);
    if (isNaN(requestedTime.getTime())) {
      return res.status(400).json({
        message: "appointmentDate must be a valid date/time format",
      });
    }

    // Appointment must be in the future
    if (requestedTime <= new Date()) {
      return res.status(400).json({
        message: "Appointment date must be in the future",
      });
    }

    // Check doctor existence & verification status
    const doctorUser = await prisma.user.findUnique({
      where: { id: doctorId.trim() },
      include: { doctorProfile: true },
    });

    if (!doctorUser || doctorUser.role !== "DOCTOR" || !doctorUser.doctorProfile) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    if (!doctorUser.doctorProfile.verified) {
      return res.status(400).json({
        message: "Doctor is not verified for appointment bookings",
      });
    }

    // Check availability against doctor's schedule
    const dayOfWeek = DAYS_OF_WEEK[requestedTime.getUTCDay()];

    const schedule = await prisma.doctorSchedule.findUnique({
      where: {
        doctorId_dayOfWeek: {
          doctorId: doctorUser.id,
          dayOfWeek,
        },
      },
    });

    if (!schedule || !schedule.active) {
      return res.status(400).json({
        message: `Doctor is not available on ${dayOfWeek}s`,
      });
    }

    const reqMinutes = requestedTime.getUTCHours() * 60 + requestedTime.getUTCMinutes();
    const startMinutes = timeToMinutes(schedule.startTime);
    const endMinutes = timeToMinutes(schedule.endTime);

    if (reqMinutes < startMinutes || reqMinutes >= endMinutes) {
      return res.status(400).json({
        message: `Appointment time is outside doctor's working hours (${schedule.startTime} - ${schedule.endTime})`,
      });
    }

    const minutesFromStart = reqMinutes - startMinutes;
    if (minutesFromStart % schedule.slotDuration !== 0) {
      return res.status(400).json({
        message: `Appointment time must align with the doctor's ${schedule.slotDuration}-minute slot intervals starting at ${schedule.startTime}`,
      });
    }

    // Transactional creation with conflict check to prevent double-booking
    const appointment = await prisma.$transaction(async (tx) => {
      const existingConflict = await tx.appointment.findFirst({
        where: {
          doctorId: doctorUser.id,
          appointmentDate: requestedTime,
          status: {
            not: "CANCELLED",
          },
        },
      });

      if (existingConflict) {
        const error = new Error(
          "This appointment slot is already booked. Please choose another time slot."
        );
        error.statusCode = 409;
        throw error;
      }

      return await tx.appointment.create({
        data: {
          patientId,
          doctorId: doctorUser.id,
          appointmentDate: requestedTime,
          symptoms: symptoms ? symptoms.trim() : null,
          status: "PENDING",
        },
        include: {
          doctor: {
            select: {
              id: true,
              name: true,
              email: true,
              doctorProfile: {
                select: {
                  specialization: true,
                  consultationFee: true,
                  hospitalName: true,
                  timezone: true,
                },
              },
            },
          },
        },
      });
    });

    res.status(201).json({
      message: "Appointment booked successfully",
      appointment,
    });
  } catch (error) {
    next(error);
  }
};

// GET PATIENT APPOINTMENTS
const getPatientAppointments = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    const appointments = await prisma.appointment.findMany({
      where: {
        patientId,
      },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            email: true,
            doctorProfile: {
              select: {
                specialization: true,
                consultationFee: true,
                hospitalName: true,
                profileImage: true,
                timezone: true,
              },
            },
          },
        },
      },
      orderBy: {
        appointmentDate: "desc",
      },
    });

    res.status(200).json({
      appointments,
    });
  } catch (error) {
    next(error);
  }
};

// GET DOCTOR APPOINTMENTS
const getDoctorAppointments = async (req, res, next) => {
  try {
    const doctorId = req.user.id;

    const appointments = await prisma.appointment.findMany({
      where: {
        doctorId,
      },
      include: {
        patient: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        appointmentDate: "desc",
      },
    });

    res.status(200).json({
      appointments,
    });
  } catch (error) {
    next(error);
  }
};

// UPDATE APPOINTMENT STATUS (State Transitions & Ownership)
const updateAppointmentStatus = async (req, res, next) => {
  try {
    const { appointmentId } = req.params;
    const { status } = req.body;
    const currentUserId = req.user.id;
    const currentUserRole = req.user.role;

    if (!status || !ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({
        message: `Valid status required (${ALLOWED_STATUSES.join(", ")})`,
      });
    }

    const existingAppointment = await prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!existingAppointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    // Role-based ownership and permission check
    const isDoctor = currentUserRole === "DOCTOR" && existingAppointment.doctorId === currentUserId;
    const isPatient = currentUserRole === "PATIENT" && existingAppointment.patientId === currentUserId;
    const isAdmin = currentUserRole === "ADMIN";

    if (!isDoctor && !isPatient && !isAdmin) {
      return res.status(403).json({
        message: "Unauthorized: You do not have permission to manage this appointment",
      });
    }

    // Patient can only cancel
    if (isPatient && status !== "CANCELLED") {
      return res.status(403).json({
        message: "Patients are only permitted to cancel their appointments",
      });
    }

    // State machine check
    const currentStatus = existingAppointment.status;
    const allowedNextStatuses = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowedNextStatuses.includes(status)) {
      return res.status(400).json({
        message: `Invalid appointment status transition from ${currentStatus} to ${status}`,
      });
    }

    const updated = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status },
      include: {
        doctor: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        patient: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    res.status(200).json({
      message: "Appointment status updated",
      appointment: updated,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  bookAppointment,
  getPatientAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
};