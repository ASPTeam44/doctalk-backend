const prisma = require("../config/prisma");

const VALID_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Convert "HH:mm" to total minutes from midnight
const timeToMinutes = (timeStr) => {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
};

// CREATE DOCTOR SCHEDULE
const createSchedule = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { dayOfWeek, startTime, endTime, slotDuration, active } = req.body;

    if (!dayOfWeek || typeof dayOfWeek !== "string") {
      return res.status(400).json({
        message: "dayOfWeek is required (e.g. MONDAY, TUESDAY)",
      });
    }

    const normDay = dayOfWeek.trim().toUpperCase();
    if (!VALID_DAYS.includes(normDay)) {
      return res.status(400).json({
        message: `Invalid dayOfWeek. Must be one of: ${VALID_DAYS.join(", ")}`,
      });
    }

    if (!startTime || !TIME_REGEX.test(startTime)) {
      return res.status(400).json({
        message: "Valid startTime in 24-hour HH:mm format is required (e.g. 09:00)",
      });
    }

    if (!endTime || !TIME_REGEX.test(endTime)) {
      return res.status(400).json({
        message: "Valid endTime in 24-hour HH:mm format is required (e.g. 17:00)",
      });
    }

    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);

    if (startMinutes >= endMinutes) {
      return res.status(400).json({
        message: "startTime must be earlier than endTime",
      });
    }

    const parsedDuration = slotDuration ? parseInt(slotDuration, 10) : 30;
    if (isNaN(parsedDuration) || parsedDuration < 10 || parsedDuration > 120) {
      return res.status(400).json({
        message: "slotDuration must be an integer between 10 and 120 minutes",
      });
    }

    if (endMinutes - startMinutes < parsedDuration) {
      return res.status(400).json({
        message: "Working hours range must accommodate at least one full slot duration",
      });
    }

    // Check if schedule already exists for this doctor on this day
    const existing = await prisma.doctorSchedule.findUnique({
      where: {
        doctorId_dayOfWeek: {
          doctorId,
          dayOfWeek: normDay,
        },
      },
    });

    if (existing) {
      return res.status(400).json({
        message: `Schedule for ${normDay} already exists. Use PUT to update it.`,
      });
    }

    const schedule = await prisma.doctorSchedule.create({
      data: {
        doctorId,
        dayOfWeek: normDay,
        startTime,
        endTime,
        slotDuration: parsedDuration,
        active: active !== false,
      },
    });

    res.status(201).json({
      message: "Doctor schedule created successfully",
      schedule,
    });
  } catch (error) {
    next(error);
  }
};

// GET DOCTOR'S OWN SCHEDULE
const getMySchedule = async (req, res, next) => {
  try {
    const doctorId = req.user.id;

    const schedules = await prisma.doctorSchedule.findMany({
      where: {
        doctorId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    res.status(200).json({
      schedules,
    });
  } catch (error) {
    next(error);
  }
};

// UPDATE DOCTOR SCHEDULE
const updateSchedule = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { scheduleId } = req.params;
    const { dayOfWeek, startTime, endTime, slotDuration, active } = req.body;

    const existingSchedule = await prisma.doctorSchedule.findUnique({
      where: { id: scheduleId },
    });

    if (!existingSchedule) {
      return res.status(404).json({
        message: "Schedule not found",
      });
    }

    if (existingSchedule.doctorId !== doctorId) {
      return res.status(403).json({
        message: "Unauthorized: cannot modify another doctor's schedule",
      });
    }

    const updateData = {};

    let normDay = existingSchedule.dayOfWeek;
    if (dayOfWeek) {
      normDay = dayOfWeek.trim().toUpperCase();
      if (!VALID_DAYS.includes(normDay)) {
        return res.status(400).json({
          message: `Invalid dayOfWeek. Must be one of: ${VALID_DAYS.join(", ")}`,
        });
      }
      // Check collision if day is changed
      if (normDay !== existingSchedule.dayOfWeek) {
        const collision = await prisma.doctorSchedule.findUnique({
          where: {
            doctorId_dayOfWeek: {
              doctorId,
              dayOfWeek: normDay,
            },
          },
        });
        if (collision) {
          return res.status(400).json({
            message: `A schedule for ${normDay} already exists`,
          });
        }
      }
      updateData.dayOfWeek = normDay;
    }

    const finalStart = startTime || existingSchedule.startTime;
    const finalEnd = endTime || existingSchedule.endTime;

    if (startTime) {
      if (!TIME_REGEX.test(startTime)) {
        return res.status(400).json({
          message: "Valid startTime in 24-hour HH:mm format is required",
        });
      }
      updateData.startTime = startTime;
    }

    if (endTime) {
      if (!TIME_REGEX.test(endTime)) {
        return res.status(400).json({
          message: "Valid endTime in 24-hour HH:mm format is required",
        });
      }
      updateData.endTime = endTime;
    }

    const startMinutes = timeToMinutes(finalStart);
    const endMinutes = timeToMinutes(finalEnd);

    if (startMinutes >= endMinutes) {
      return res.status(400).json({
        message: "startTime must be earlier than endTime",
      });
    }

    let finalDuration = existingSchedule.slotDuration;
    if (slotDuration !== undefined) {
      const parsedDuration = parseInt(slotDuration, 10);
      if (isNaN(parsedDuration) || parsedDuration < 10 || parsedDuration > 120) {
        return res.status(400).json({
          message: "slotDuration must be an integer between 10 and 120 minutes",
        });
      }
      updateData.slotDuration = parsedDuration;
      finalDuration = parsedDuration;
    }

    if (endMinutes - startMinutes < finalDuration) {
      return res.status(400).json({
        message: "Working hours range must accommodate at least one full slot duration",
      });
    }

    if (active !== undefined) {
      updateData.active = Boolean(active);
    }

    const updated = await prisma.doctorSchedule.update({
      where: { id: scheduleId },
      data: updateData,
    });

    res.status(200).json({
      message: "Doctor schedule updated successfully",
      schedule: updated,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE DOCTOR SCHEDULE
const deleteSchedule = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { scheduleId } = req.params;

    const existingSchedule = await prisma.doctorSchedule.findUnique({
      where: { id: scheduleId },
    });

    if (!existingSchedule) {
      return res.status(404).json({
        message: "Schedule not found",
      });
    }

    if (existingSchedule.doctorId !== doctorId) {
      return res.status(403).json({
        message: "Unauthorized: cannot delete another doctor's schedule",
      });
    }

    await prisma.doctorSchedule.delete({
      where: { id: scheduleId },
    });

    res.status(200).json({
      message: "Doctor schedule deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSchedule,
  getMySchedule,
  updateSchedule,
  deleteSchedule,
};
