const prisma = require("../config/prisma");

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

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

const minutesToTime = (min) => {
  const h = String(Math.floor(min / 60)).padStart(2, "0");
  const m = String(min % 60).padStart(2, "0");
  return `${h}:${m}`;
};

// CREATE DOCTOR PROFILE
const createDoctorProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const {
      specialization,
      experience,
      consultationFee,
      qualification,
      hospitalName,
      bio,
      languages,
      timezone,
    } = req.body;

    if (!specialization || typeof specialization !== "string" || !specialization.trim()) {
      return res.status(400).json({
        message: "Specialization is required",
      });
    }

    if (!qualification || typeof qualification !== "string" || !qualification.trim()) {
      return res.status(400).json({
        message: "Qualification is required",
      });
    }

    const parsedExp = parseInt(experience, 10);
    if (isNaN(parsedExp) || parsedExp < 0) {
      return res.status(400).json({
        message: "Valid experience in years is required",
      });
    }

    const parsedFee = parseInt(consultationFee, 10);
    if (isNaN(parsedFee) || parsedFee < 0) {
      return res.status(400).json({
        message: "Valid consultation fee is required",
      });
    }

    // Check existing profile
    const existingProfile = await prisma.doctorProfile.findUnique({
      where: {
        userId,
      },
    });

    if (existingProfile) {
      return res.status(400).json({
        message: "Doctor profile already exists",
      });
    }

    // Create profile (verified defaults to false, awaiting admin approval)
    const doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId,
        specialization: specialization.trim(),
        experience: parsedExp,
        consultationFee: parsedFee,
        qualification: qualification.trim(),
        hospitalName: hospitalName ? hospitalName.trim() : null,
        bio: bio ? bio.trim() : null,
        languages: languages ? languages.trim() : null,
        timezone: timezone ? timezone.trim() : "UTC",
        verified: false,
      },
    });

    res.status(201).json({
      message: "Doctor profile created successfully",
      doctorProfile,
    });
  } catch (error) {
    next(error);
  }
};

// GET ALL DOCTORS (Public - Only returns verified doctors with pagination and search)
const getAllDoctors = async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const skip = (page - 1) * limit;

    const { specialization, name } = req.query;

    const where = {
      verified: true,
    };

    if (specialization && typeof specialization === "string" && specialization.trim()) {
      where.specialization = {
        contains: specialization.trim(),
        mode: "insensitive",
      };
    }

    if (name && typeof name === "string" && name.trim()) {
      where.user = {
        name: {
          contains: name.trim(),
          mode: "insensitive",
        },
      };
    }

    const [total, doctors] = await Promise.all([
      prisma.doctorProfile.count({ where }),
      prisma.doctorProfile.findMany({
        where,
        skip,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              phone: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    res.status(200).json({
      doctors,
      pagination: {
        total,
        page,
        limit,
        totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

// GET AVAILABLE SLOTS (Public)
// GET /api/doctor/:doctorId/available-slots?date=YYYY-MM-DD
const getAvailableSlots = async (req, res, next) => {
  try {
    const { doctorId } = req.params;
    const { date } = req.query;

    if (!date || !DATE_REGEX.test(date)) {
      return res.status(400).json({
        message: "Valid date query parameter in YYYY-MM-DD format is required",
      });
    }

    // Validate date components
    const [year, month, day] = date.split("-").map(Number);
    const targetDate = new Date(Date.UTC(year, month - 1, day));
    if (
      isNaN(targetDate.getTime()) ||
      targetDate.getUTCFullYear() !== year ||
      targetDate.getUTCMonth() !== month - 1 ||
      targetDate.getUTCDate() !== day
    ) {
      return res.status(400).json({
        message: "Invalid calendar date specified",
      });
    }

    // Check doctor profile and verification
    const doctorUser = await prisma.user.findUnique({
      where: { id: doctorId },
      include: { doctorProfile: true },
    });

    if (!doctorUser || doctorUser.role !== "DOCTOR" || !doctorUser.doctorProfile) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    if (!doctorUser.doctorProfile.verified) {
      return res.status(400).json({
        message: "Doctor is not verified for public bookings",
      });
    }

    // Compare date to current date (in UTC)
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (date < todayStr) {
      return res.status(400).json({
        message: "Cannot retrieve slots for past dates",
      });
    }

    const dayOfWeek = DAYS_OF_WEEK[targetDate.getUTCDay()];

    // Query active schedule for this day of week
    const schedule = await prisma.doctorSchedule.findUnique({
      where: {
        doctorId_dayOfWeek: {
          doctorId,
          dayOfWeek,
        },
      },
    });

    if (!schedule || !schedule.active) {
      return res.status(200).json({
        doctorId,
        date,
        dayOfWeek,
        timezone: doctorUser.doctorProfile.timezone,
        slots: [],
      });
    }

    // Query all existing non-cancelled appointments for this doctor on this day
    const dayStart = new Date(`${date}T00:00:00.000Z`);
    const dayEnd = new Date(`${date}T23:59:59.999Z`);

    const bookedAppointments = await prisma.appointment.findMany({
      where: {
        doctorId,
        appointmentDate: {
          gte: dayStart,
          lte: dayEnd,
        },
        status: {
          not: "CANCELLED",
        },
      },
      select: {
        appointmentDate: true,
      },
    });

    const bookedTimes = new Set(
      bookedAppointments.map((apt) => apt.appointmentDate.toISOString().slice(11, 16))
    );

    const startMinutes = timeToMinutes(schedule.startTime);
    const endMinutes = timeToMinutes(schedule.endTime);
    const slotDuration = schedule.slotDuration;

    const isToday = date === todayStr;
    const currentUtcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();

    const slots = [];
    for (let cur = startMinutes; cur + slotDuration <= endMinutes; cur += slotDuration) {
      const slotStart = minutesToTime(cur);
      const slotEnd = minutesToTime(cur + slotDuration);

      let available = true;
      if (bookedTimes.has(slotStart)) {
        available = false;
      }
      if (isToday && cur <= currentUtcMinutes) {
        available = false;
      }

      slots.push({
        start: slotStart,
        end: slotEnd,
        available,
      });
    }

    res.status(200).json({
      doctorId,
      date,
      dayOfWeek,
      timezone: doctorUser.doctorProfile.timezone,
      slots,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createDoctorProfile,
  getAllDoctors,
  getAvailableSlots,
};