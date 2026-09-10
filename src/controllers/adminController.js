const prisma = require("../config/prisma");

// GET /api/admin/doctors/pending
const getPendingDoctors = async (req, res, next) => {
  try {
    const pendingDoctors = await prisma.doctorProfile.findMany({
      where: {
        verified: false,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      doctors: pendingDoctors,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/doctors/:doctorProfileId/verify
const verifyDoctor = async (req, res, next) => {
  try {
    const { doctorProfileId } = req.params;

    const existingProfile = await prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
    });

    if (!existingProfile) {
      return res.status(404).json({
        message: "Doctor profile not found",
      });
    }

    const updatedProfile = await prisma.doctorProfile.update({
      where: { id: doctorProfileId },
      data: { verified: true },
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
    });

    res.status(200).json({
      message: "Doctor verified successfully",
      doctorProfile: updatedProfile,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/doctors/:doctorProfileId/reject
const rejectDoctor = async (req, res, next) => {
  try {
    const { doctorProfileId } = req.params;

    const existingProfile = await prisma.doctorProfile.findUnique({
      where: { id: doctorProfileId },
    });

    if (!existingProfile) {
      return res.status(404).json({
        message: "Doctor profile not found",
      });
    }

    const updatedProfile = await prisma.doctorProfile.update({
      where: { id: doctorProfileId },
      data: { verified: false },
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
    });

    res.status(200).json({
      message: "Doctor verification rejected",
      doctorProfile: updatedProfile,
    });
  } catch (error) {
    next(error);
  }
};

const { logPharmacyAction } = require("../services/auditService");

// GET /api/admin/pharmacies/pending
const getPendingPharmacies = async (req, res, next) => {
  try {
    const pendingPharmacies = await prisma.pharmacyProfile.findMany({
      where: {
        verified: false,
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    res.status(200).json({
      pharmacies: pendingPharmacies,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/pharmacies/:id/verify
const verifyPharmacy = async (req, res, next) => {
  try {
    const pharmacyId = req.params.id || req.params.pharmacyProfileId;

    const existingProfile = await prisma.pharmacyProfile.findUnique({
      where: { id: pharmacyId },
    });

    if (!existingProfile) {
      return res.status(404).json({
        message: "Pharmacy profile not found",
      });
    }

    const updatedProfile = await prisma.pharmacyProfile.update({
      where: { id: pharmacyId },
      data: { verified: true },
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
    });

    await logPharmacyAction({
      pharmacyId,
      userId: req.user.id,
      action: "PHARMACY_VERIFIED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(200).json({
      message: "Pharmacy verified successfully",
      pharmacyProfile: updatedProfile,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/pharmacies/:id/reject
const rejectPharmacy = async (req, res, next) => {
  try {
    const pharmacyId = req.params.id || req.params.pharmacyProfileId;

    const existingProfile = await prisma.pharmacyProfile.findUnique({
      where: { id: pharmacyId },
    });

    if (!existingProfile) {
      return res.status(404).json({
        message: "Pharmacy profile not found",
      });
    }

    const updatedProfile = await prisma.pharmacyProfile.update({
      where: { id: pharmacyId },
      data: { verified: false },
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
    });

    await logPharmacyAction({
      pharmacyId,
      userId: req.user.id,
      action: "PHARMACY_REJECTED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(200).json({
      message: "Pharmacy verification rejected",
      pharmacyProfile: updatedProfile,
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/admin/medicines (Admin creates master medicine record)
const createMasterMedicine = async (req, res, next) => {
  try {
    const {
      name,
      genericName,
      brandName,
      strength,
      dosageForm,
      manufacturer,
      description,
      prescriptionRequired,
      active,
    } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ message: "Medicine name is required" });
    }

    if (!dosageForm || typeof dosageForm !== "string" || !dosageForm.trim()) {
      return res.status(400).json({ message: "dosageForm is required (e.g. TABLET, CAPSULE, SYRUP)" });
    }

    const medicine = await prisma.medicine.create({
      data: {
        name: name.trim(),
        genericName: genericName ? String(genericName).trim() : null,
        brandName: brandName ? String(brandName).trim() : null,
        strength: strength ? String(strength).trim() : null,
        dosageForm: dosageForm.trim().toUpperCase(),
        manufacturer: manufacturer ? String(manufacturer).trim() : null,
        description: description ? String(description).trim() : null,
        prescriptionRequired: prescriptionRequired !== undefined ? Boolean(prescriptionRequired) : true,
        active: active !== undefined ? Boolean(active) : true,
      },
    });

    res.status(201).json({
      message: "Master medicine created successfully",
      medicine,
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/medicines/:id (Admin updates master medicine record)
const updateMasterMedicine = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingMedicine = await prisma.medicine.findUnique({
      where: { id },
    });

    if (!existingMedicine) {
      return res.status(404).json({ message: "Medicine not found" });
    }

    const {
      name,
      genericName,
      brandName,
      strength,
      dosageForm,
      manufacturer,
      description,
      prescriptionRequired,
      active,
    } = req.body;

    const updateData = {};
    if (name !== undefined) updateData.name = String(name).trim();
    if (genericName !== undefined) updateData.genericName = genericName ? String(genericName).trim() : null;
    if (brandName !== undefined) updateData.brandName = brandName ? String(brandName).trim() : null;
    if (strength !== undefined) updateData.strength = strength ? String(strength).trim() : null;
    if (dosageForm !== undefined) updateData.dosageForm = String(dosageForm).trim().toUpperCase();
    if (manufacturer !== undefined) updateData.manufacturer = manufacturer ? String(manufacturer).trim() : null;
    if (description !== undefined) updateData.description = description ? String(description).trim() : null;
    if (prescriptionRequired !== undefined) updateData.prescriptionRequired = Boolean(prescriptionRequired);
    if (active !== undefined) updateData.active = Boolean(active);

    const updated = await prisma.medicine.update({
      where: { id },
      data: updateData,
    });

    res.status(200).json({
      message: "Master medicine updated successfully",
      medicine: updated,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPendingDoctors,
  verifyDoctor,
  rejectDoctor,
  getPendingPharmacies,
  verifyPharmacy,
  rejectPharmacy,
  createMasterMedicine,
  updateMasterMedicine,
};
