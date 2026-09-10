const prisma = require("../config/prisma");
const { logPrescriptionAction } = require("../services/auditService");

// Helper: validate prescription items
const validatePrescriptionItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) {
    return { valid: false, message: "At least one prescription item is required" };
  }

  const cleanItems = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (!item.medicineName || typeof item.medicineName !== "string" || !item.medicineName.trim()) {
      return { valid: false, message: `Item #${i + 1}: medicineName is required` };
    }

    if (!item.dosage || typeof item.dosage !== "string" || !item.dosage.trim()) {
      return { valid: false, message: `Item #${i + 1}: dosage is required (e.g. 1 tablet)` };
    }

    if (!item.frequency || typeof item.frequency !== "string" || !item.frequency.trim()) {
      return { valid: false, message: `Item #${i + 1}: frequency is required (e.g. Twice daily)` };
    }

    const duration = parseInt(item.duration, 10);
    if (isNaN(duration) || duration <= 0) {
      return { valid: false, message: `Item #${i + 1}: duration must be a positive integer` };
    }

    const quantity = parseInt(item.quantity, 10);
    if (isNaN(quantity) || quantity <= 0) {
      return { valid: false, message: `Item #${i + 1}: quantity must be a positive integer` };
    }

    cleanItems.push({
      medicineName: item.medicineName.trim(),
      strength: item.strength ? String(item.strength).trim() : null,
      dosage: item.dosage.trim(),
      frequency: item.frequency.trim(),
      duration,
      durationUnit: item.durationUnit ? String(item.durationUnit).trim().toUpperCase() : "DAYS",
      route: item.route ? String(item.route).trim().toUpperCase() : "ORAL",
      instructions: item.instructions ? String(item.instructions).trim() : null,
      quantity,
    });
  }

  return { valid: true, items: cleanItems };
};

// 1. CREATE PRESCRIPTION
// POST /api/prescriptions (Doctor only)
const createPrescription = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const {
      appointmentId,
      diagnosis,
      clinicalNotes,
      instructions,
      status,
      items,
    } = req.body;

    if (!appointmentId || typeof appointmentId !== "string" || !appointmentId.trim()) {
      return res.status(400).json({ message: "appointmentId is required" });
    }

    if (!diagnosis || typeof diagnosis !== "string" || !diagnosis.trim()) {
      return res.status(400).json({ message: "Diagnosis is required" });
    }

    // Validate prescription items
    const itemsValidation = validatePrescriptionItems(items);
    if (!itemsValidation.valid) {
      return res.status(400).json({ message: itemsValidation.message });
    }

    // Validate status if provided
    let initialStatus = "DRAFT";
    if (status) {
      const normStatus = String(status).trim().toUpperCase();
      if (!["DRAFT", "ISSUED"].includes(normStatus)) {
        return res.status(400).json({
          message: "Initial status must be either DRAFT or ISSUED",
        });
      }
      initialStatus = normStatus;
    }

    // Verify doctor is verified
    const doctorUser = await prisma.user.findUnique({
      where: { id: doctorId },
      include: { doctorProfile: true },
    });

    if (!doctorUser || doctorUser.role !== "DOCTOR" || !doctorUser.doctorProfile) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    if (!doctorUser.doctorProfile.verified) {
      return res.status(400).json({
        message: "Only verified doctors can create prescriptions",
      });
    }

    // Verify appointment exists and belongs to this doctor
    const appointment = await prisma.appointment.findUnique({
      where: { id: appointmentId.trim() },
    });

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.doctorId !== doctorId) {
      return res.status(403).json({
        message: "Unauthorized: You can only prescribe for your own appointments",
      });
    }

    // Appointment must be CONFIRMED or COMPLETED
    if (!["CONFIRMED", "COMPLETED"].includes(appointment.status)) {
      return res.status(400).json({
        message: `Prescriptions can only be created for CONFIRMED or COMPLETED appointments (current status: ${appointment.status})`,
      });
    }

    // Atomic creation of prescription and all items
    const prescription = await prisma.$transaction(async (tx) => {
      const created = await tx.prescription.create({
        data: {
          appointmentId: appointment.id,
          patientId: appointment.patientId,
          doctorId,
          diagnosis: diagnosis.trim(),
          clinicalNotes: clinicalNotes ? String(clinicalNotes).trim() : null,
          instructions: instructions ? String(instructions).trim() : null,
          status: initialStatus,
          items: {
            create: itemsValidation.items,
          },
        },
        include: {
          items: true,
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

      return created;
    });

    // Audit logging
    await logPrescriptionAction({
      prescriptionId: prescription.id,
      userId: doctorId,
      action: initialStatus === "ISSUED" ? "PRESCRIPTION_ISSUED" : "PRESCRIPTION_CREATED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(201).json({
      message: `Prescription created successfully as ${initialStatus}`,
      prescription,
    });
  } catch (error) {
    next(error);
  }
};

// 2. UPDATE DRAFT PRESCRIPTION
// PUT /api/prescriptions/:id (Doctor only)
const updatePrescription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doctorId = req.user.id;
    const { diagnosis, clinicalNotes, instructions, items } = req.body;

    const existing = await prisma.prescription.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    if (existing.doctorId !== doctorId) {
      return res.status(403).json({
        message: "Unauthorized: cannot edit another doctor's prescription",
      });
    }

    // Only DRAFT can be modified
    if (existing.status !== "DRAFT") {
      return res.status(400).json({
        message: `Cannot modify prescription with status "${existing.status}". Only DRAFT prescriptions can be edited.`,
      });
    }

    const updateData = {};
    if (diagnosis !== undefined) {
      if (typeof diagnosis !== "string" || !diagnosis.trim()) {
        return res.status(400).json({ message: "Diagnosis cannot be empty" });
      }
      updateData.diagnosis = diagnosis.trim();
    }

    if (clinicalNotes !== undefined) {
      updateData.clinicalNotes = clinicalNotes ? String(clinicalNotes).trim() : null;
    }

    if (instructions !== undefined) {
      updateData.instructions = instructions ? String(instructions).trim() : null;
    }

    let cleanItems = null;
    if (items !== undefined) {
      const itemsValidation = validatePrescriptionItems(items);
      if (!itemsValidation.valid) {
        return res.status(400).json({ message: itemsValidation.message });
      }
      cleanItems = itemsValidation.items;
    }

    const updated = await prisma.$transaction(async (tx) => {
      if (cleanItems) {
        // Delete old items and insert updated items
        await tx.prescriptionItem.deleteMany({
          where: { prescriptionId: id },
        });

        await tx.prescriptionItem.createMany({
          data: cleanItems.map((item) => ({
            ...item,
            prescriptionId: id,
          })),
        });
      }

      return await tx.prescription.update({
        where: { id },
        data: updateData,
        include: {
          items: true,
          doctor: { select: { id: true, name: true, email: true } },
          patient: { select: { id: true, name: true, email: true } },
        },
      });
    });

    await logPrescriptionAction({
      prescriptionId: updated.id,
      userId: doctorId,
      action: "PRESCRIPTION_UPDATED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      message: "Prescription updated successfully",
      prescription: updated,
    });
  } catch (error) {
    next(error);
  }
};

// 3. ISSUE PRESCRIPTION
// POST /api/prescriptions/:id/issue (Doctor only)
const issuePrescription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doctorId = req.user.id;

    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    if (prescription.doctorId !== doctorId) {
      return res.status(403).json({
        message: "Unauthorized: cannot issue another doctor's prescription",
      });
    }

    if (prescription.status === "ISSUED") {
      return res.status(200).json({
        message: "Prescription is already issued",
        prescription,
      });
    }

    if (prescription.status === "CANCELLED") {
      return res.status(400).json({
        message: "Cannot issue a cancelled prescription",
      });
    }

    const updated = await prisma.prescription.update({
      where: { id },
      data: { status: "ISSUED" },
      include: {
        items: true,
        doctor: { select: { id: true, name: true, email: true } },
        patient: { select: { id: true, name: true, email: true } },
      },
    });

    await logPrescriptionAction({
      prescriptionId: updated.id,
      userId: doctorId,
      action: "PRESCRIPTION_ISSUED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      message: "Prescription finalized and issued successfully",
      prescription: updated,
    });
  } catch (error) {
    next(error);
  }
};

// 4. CANCEL PRESCRIPTION
// POST /api/prescriptions/:id/cancel (Doctor only)
const cancelPrescription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const doctorId = req.user.id;

    const prescription = await prisma.prescription.findUnique({
      where: { id },
    });

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    if (prescription.doctorId !== doctorId) {
      return res.status(403).json({
        message: "Unauthorized: cannot cancel another doctor's prescription",
      });
    }

    if (prescription.status === "CANCELLED") {
      return res.status(200).json({
        message: "Prescription is already cancelled",
        prescription,
      });
    }

    const updated = await prisma.prescription.update({
      where: { id },
      data: { status: "CANCELLED" },
      include: {
        items: true,
      },
    });

    await logPrescriptionAction({
      prescriptionId: updated.id,
      userId: doctorId,
      action: "PRESCRIPTION_CANCELLED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      message: "Prescription cancelled successfully",
      prescription: updated,
    });
  } catch (error) {
    next(error);
  }
};

// 5. GET PATIENT'S OWN PRESCRIPTIONS
// GET /api/prescriptions/my-prescriptions (Patient only)
const getMyPrescriptions = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    // Patients only see finalized (ISSUED or CANCELLED) prescriptions, not unreleased DRAFTs
    const prescriptions = await prisma.prescription.findMany({
      where: {
        patientId,
        status: { not: "DRAFT" },
      },
      include: {
        items: true,
        doctor: {
          select: {
            id: true,
            name: true,
            email: true,
            doctorProfile: {
              select: {
                specialization: true,
                hospitalName: true,
                qualification: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      prescriptions,
    });
  } catch (error) {
    next(error);
  }
};

// 6. GET DOCTOR'S AUTHORED PRESCRIPTIONS
// GET /api/prescriptions/doctor (Doctor only)
const getDoctorPrescriptions = async (req, res, next) => {
  try {
    const doctorId = req.user.id;
    const { status } = req.query;

    const where = { doctorId };
    if (status && ["DRAFT", "ISSUED", "CANCELLED"].includes(status.toUpperCase())) {
      where.status = status.toUpperCase();
    }

    const prescriptions = await prisma.prescription.findMany({
      where,
      include: {
        items: true,
        patient: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({
      prescriptions,
    });
  } catch (error) {
    next(error);
  }
};

// 7. GET PRESCRIPTION BY ID
// GET /api/prescriptions/:id (Patient owner or authoring Doctor)
const getPrescriptionById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const prescription = await prisma.prescription.findUnique({
      where: { id },
      include: {
        items: true,
        doctor: {
          select: {
            id: true,
            name: true,
            email: true,
            doctorProfile: {
              select: {
                specialization: true,
                hospitalName: true,
                qualification: true,
              },
            },
          },
        },
        patient: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        appointment: {
          select: {
            id: true,
            appointmentDate: true,
            status: true,
          },
        },
      },
    });

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    const isAuthor = userRole === "DOCTOR" && prescription.doctorId === userId;
    const isPatientOwner = userRole === "PATIENT" && prescription.patientId === userId;

    if (!isAuthor && !isPatientOwner) {
      return res.status(403).json({
        message: "Access forbidden: you do not have permission to view this prescription",
      });
    }

    // Patient cannot view draft prescriptions
    if (isPatientOwner && prescription.status === "DRAFT") {
      return res.status(403).json({
        message: "Prescription is currently in draft and has not yet been released to you",
      });
    }

    await logPrescriptionAction({
      prescriptionId: prescription.id,
      userId,
      action: "PRESCRIPTION_VIEWED",
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"],
    });

    res.status(200).json({
      prescription,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createPrescription,
  updatePrescription,
  issuePrescription,
  cancelPrescription,
  getMyPrescriptions,
  getDoctorPrescriptions,
  getPrescriptionById,
};
