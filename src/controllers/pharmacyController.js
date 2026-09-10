const prisma = require("../config/prisma");
const { logPharmacyAction } = require("../services/auditService");

// 1. POST /api/pharmacy/profile (PHARMACY only)
const createProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const existing = await prisma.pharmacyProfile.findUnique({
      where: { userId },
    });

    if (existing) {
      return res.status(409).json({ message: "Pharmacy profile already exists for this user" });
    }

    const {
      pharmacyName,
      licenseNumber,
      registrationNumber,
      phone,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      country,
      postalCode,
      latitude,
      longitude,
      deliveryRadiusKm,
    } = req.body;

    if (!pharmacyName || typeof pharmacyName !== "string" || !pharmacyName.trim()) {
      return res.status(400).json({ message: "pharmacyName is required" });
    }

    if (!licenseNumber || typeof licenseNumber !== "string" || !licenseNumber.trim()) {
      return res.status(400).json({ message: "licenseNumber is required" });
    }

    if (!phone || typeof phone !== "string" || !phone.trim()) {
      return res.status(400).json({ message: "phone is required" });
    }

    if (!addressLine1 || typeof addressLine1 !== "string" || !addressLine1.trim()) {
      return res.status(400).json({ message: "addressLine1 is required" });
    }

    if (!city || typeof city !== "string" || !city.trim()) {
      return res.status(400).json({ message: "city is required" });
    }

    if (!state || typeof state !== "string" || !state.trim()) {
      return res.status(400).json({ message: "state is required" });
    }

    if (!country || typeof country !== "string" || !country.trim()) {
      return res.status(400).json({ message: "country is required" });
    }

    if (!postalCode || typeof postalCode !== "string" || !postalCode.trim()) {
      return res.status(400).json({ message: "postalCode is required" });
    }

    const licenseConflict = await prisma.pharmacyProfile.findUnique({
      where: { licenseNumber: licenseNumber.trim() },
    });

    if (licenseConflict) {
      return res.status(409).json({ message: "License number is already registered" });
    }

    const profile = await prisma.pharmacyProfile.create({
      data: {
        userId,
        pharmacyName: pharmacyName.trim(),
        licenseNumber: licenseNumber.trim(),
        registrationNumber: registrationNumber ? String(registrationNumber).trim() : null,
        phone: phone.trim(),
        email: email ? String(email).trim() : null,
        addressLine1: addressLine1.trim(),
        addressLine2: addressLine2 ? String(addressLine2).trim() : null,
        city: city.trim(),
        state: state.trim(),
        country: country.trim(),
        postalCode: postalCode.trim(),
        latitude: latitude !== undefined && latitude !== null ? parseFloat(latitude) : null,
        longitude: longitude !== undefined && longitude !== null ? parseFloat(longitude) : null,
        deliveryRadiusKm: deliveryRadiusKm !== undefined && deliveryRadiusKm !== null ? parseFloat(deliveryRadiusKm) : 10.0,
        verified: false,
        active: true,
      },
    });

    await logPharmacyAction({
      pharmacyId: profile.id,
      userId,
      action: "PHARMACY_CREATED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(201).json({
      message: "Pharmacy profile created successfully (pending verification)",
      pharmacyProfile: profile,
    });
  } catch (error) {
    next(error);
  }
};

// 2. GET /api/pharmacy/profile/me (PHARMACY only)
const getMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const profile = await prisma.pharmacyProfile.findUnique({
      where: { userId },
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

    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    res.status(200).json({ pharmacyProfile: profile });
  } catch (error) {
    next(error);
  }
};

// 3. PUT /api/pharmacy/profile/me (PHARMACY only)
const updateMyProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const profile = await prisma.pharmacyProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    const {
      pharmacyName,
      registrationNumber,
      phone,
      email,
      addressLine1,
      addressLine2,
      city,
      state,
      country,
      postalCode,
      latitude,
      longitude,
      deliveryRadiusKm,
    } = req.body;

    const updateData = {};
    if (pharmacyName !== undefined) updateData.pharmacyName = String(pharmacyName).trim();
    if (registrationNumber !== undefined) updateData.registrationNumber = registrationNumber ? String(registrationNumber).trim() : null;
    if (phone !== undefined) updateData.phone = String(phone).trim();
    if (email !== undefined) updateData.email = email ? String(email).trim() : null;
    if (addressLine1 !== undefined) updateData.addressLine1 = String(addressLine1).trim();
    if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2 ? String(addressLine2).trim() : null;
    if (city !== undefined) updateData.city = String(city).trim();
    if (state !== undefined) updateData.state = String(state).trim();
    if (country !== undefined) updateData.country = String(country).trim();
    if (postalCode !== undefined) updateData.postalCode = String(postalCode).trim();
    if (latitude !== undefined) updateData.latitude = latitude !== null ? parseFloat(latitude) : null;
    if (longitude !== undefined) updateData.longitude = longitude !== null ? parseFloat(longitude) : null;
    if (deliveryRadiusKm !== undefined) updateData.deliveryRadiusKm = deliveryRadiusKm !== null ? parseFloat(deliveryRadiusKm) : 10.0;

    const updated = await prisma.pharmacyProfile.update({
      where: { userId },
      data: updateData,
    });

    res.status(200).json({
      message: "Pharmacy profile updated successfully",
      pharmacyProfile: updated,
    });
  } catch (error) {
    next(error);
  }
};

// 4. GET /api/pharmacy/all (Public)
const getPublicPharmacies = async (req, res, next) => {
  try {
    const {
      city,
      state,
      country,
      pharmacyName,
      name,
      search,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      verified: true,
      active: true,
    };

    if (city && typeof city === "string" && city.trim()) {
      where.city = { contains: city.trim(), mode: "insensitive" };
    }

    if (state && typeof state === "string" && state.trim()) {
      where.state = { contains: state.trim(), mode: "insensitive" };
    }

    if (country && typeof country === "string" && country.trim()) {
      where.country = { contains: country.trim(), mode: "insensitive" };
    }

    const querySearch = pharmacyName || name || search;
    if (querySearch && typeof querySearch === "string" && querySearch.trim()) {
      where.pharmacyName = { contains: querySearch.trim(), mode: "insensitive" };
    }

    const [total, pharmacies] = await Promise.all([
      prisma.pharmacyProfile.count({ where }),
      prisma.pharmacyProfile.findMany({
        where,
        skip,
        take: limitNum,
        select: {
          id: true,
          pharmacyName: true,
          phone: true,
          email: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          country: true,
          postalCode: true,
          latitude: true,
          longitude: true,
          deliveryRadiusKm: true,
          verified: true,
          createdAt: true,
        },
        orderBy: { pharmacyName: "asc" },
      }),
    ]);

    res.status(200).json({
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      pharmacies,
    });
  } catch (error) {
    next(error);
  }
};

// 5. GET /api/pharmacy/:id (Public)
const getPublicPharmacyById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const pharmacy = await prisma.pharmacyProfile.findFirst({
      where: {
        id,
        verified: true,
        active: true,
      },
      select: {
        id: true,
        pharmacyName: true,
        phone: true,
        email: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        state: true,
        country: true,
        postalCode: true,
        latitude: true,
        longitude: true,
        deliveryRadiusKm: true,
        verified: true,
        createdAt: true,
      },
    });

    if (!pharmacy) {
      return res.status(404).json({ message: "Pharmacy not found or not verified" });
    }

    res.status(200).json({ pharmacy });
  } catch (error) {
    next(error);
  }
};

// ==============================
// PHARMACY INVENTORY CONTROLLERS
// ==============================

// Helper to get pharmacy profile for current user
const getPharmacyProfileForUser = async (userId) => {
  return await prisma.pharmacyProfile.findUnique({
    where: { userId },
  });
};

// 6. POST /api/pharmacy/inventory (PHARMACY only)
const addInventoryItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await getPharmacyProfileForUser(userId);

    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found. Please create a profile first." });
    }

    const { medicineId, sku, sellingPrice, stockQuantity } = req.body;

    if (!medicineId || typeof medicineId !== "string" || !medicineId.trim()) {
      return res.status(400).json({ message: "medicineId is required" });
    }

    const parsedPrice = parseFloat(sellingPrice);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ message: "sellingPrice must be a positive number (> 0)" });
    }

    const parsedStock = parseInt(stockQuantity, 10);
    if (isNaN(parsedStock) || parsedStock < 0) {
      return res.status(400).json({ message: "stockQuantity must be a non-negative integer (>= 0)" });
    }

    // Verify medicine exists and is active
    const medicine = await prisma.medicine.findUnique({
      where: { id: medicineId.trim() },
    });

    if (!medicine || !medicine.active) {
      return res.status(400).json({ message: "Medicine not found or is currently inactive" });
    }

    // Prevent duplicate inventory record for pharmacy + medicine
    const existingInventory = await prisma.inventory.findUnique({
      where: {
        pharmacyId_medicineId: {
          pharmacyId: profile.id,
          medicineId: medicine.id,
        },
      },
    });

    if (existingInventory) {
      return res.status(409).json({ message: "Inventory record already exists for this medicine in your pharmacy" });
    }

    const item = await prisma.inventory.create({
      data: {
        pharmacyId: profile.id,
        medicineId: medicine.id,
        sku: sku ? String(sku).trim() : null,
        sellingPrice: parsedPrice,
        stockQuantity: parsedStock,
        reservedQuantity: 0,
        active: true,
      },
      include: {
        medicine: true,
      },
    });

    await logPharmacyAction({
      pharmacyId: profile.id,
      userId,
      action: "INVENTORY_CREATED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(201).json({
      message: "Inventory item added successfully",
      inventory: {
        ...item,
        availableQuantity: item.stockQuantity - item.reservedQuantity,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 7. GET /api/pharmacy/inventory (PHARMACY only)
const getMyInventory = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await getPharmacyProfileForUser(userId);

    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    const items = await prisma.inventory.findMany({
      where: {
        pharmacyId: profile.id,
      },
      include: {
        medicine: {
          select: {
            id: true,
            name: true,
            genericName: true,
            brandName: true,
            strength: true,
            dosageForm: true,
            prescriptionRequired: true,
            active: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const inventoryWithAvailable = items.map((item) => ({
      ...item,
      availableQuantity: Math.max(0, item.stockQuantity - item.reservedQuantity),
    }));

    res.status(200).json({
      pharmacyId: profile.id,
      inventory: inventoryWithAvailable,
    });
  } catch (error) {
    next(error);
  }
};

// 8. PUT /api/pharmacy/inventory/:id (PHARMACY only)
const updateInventoryItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const profile = await getPharmacyProfileForUser(userId);
    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    const item = await prisma.inventory.findUnique({
      where: { id },
    });

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    // Ownership check: pharmacy can only modify own inventory
    if (item.pharmacyId !== profile.id) {
      return res.status(403).json({ message: "Access forbidden: cannot modify another pharmacy's inventory" });
    }

    const { sku, sellingPrice, stockQuantity, active } = req.body;
    const updateData = {};

    if (sku !== undefined) updateData.sku = sku ? String(sku).trim() : null;

    if (sellingPrice !== undefined) {
      const parsedPrice = parseFloat(sellingPrice);
      if (isNaN(parsedPrice) || parsedPrice <= 0) {
        return res.status(400).json({ message: "sellingPrice must be a positive number (> 0)" });
      }
      updateData.sellingPrice = parsedPrice;
    }

    if (stockQuantity !== undefined) {
      const parsedStock = parseInt(stockQuantity, 10);
      if (isNaN(parsedStock) || parsedStock < 0) {
        return res.status(400).json({ message: "stockQuantity must be a non-negative integer (>= 0)" });
      }
      // Stock quantity cannot be less than currently reserved quantity
      if (parsedStock < item.reservedQuantity) {
        return res.status(400).json({
          message: `stockQuantity cannot be reduced below active reserved quantity (${item.reservedQuantity})`,
        });
      }
      updateData.stockQuantity = parsedStock;
    }

    if (active !== undefined) {
      updateData.active = Boolean(active);
    }

    const updated = await prisma.inventory.update({
      where: { id },
      data: updateData,
      include: {
        medicine: true,
      },
    });

    await logPharmacyAction({
      pharmacyId: profile.id,
      userId,
      action: "INVENTORY_UPDATED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(200).json({
      message: "Inventory item updated successfully",
      inventory: {
        ...updated,
        availableQuantity: updated.stockQuantity - updated.reservedQuantity,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 9. DELETE /api/pharmacy/inventory/:id (PHARMACY only)
const deleteInventoryItem = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const profile = await getPharmacyProfileForUser(userId);
    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    const item = await prisma.inventory.findUnique({
      where: { id },
    });

    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }

    if (item.pharmacyId !== profile.id) {
      return res.status(403).json({ message: "Access forbidden: cannot delete another pharmacy's inventory" });
    }

    if (item.reservedQuantity > 0) {
      return res.status(400).json({
        message: `Cannot delete inventory item with active reservations (${item.reservedQuantity} reserved)`,
      });
    }

    await prisma.inventory.delete({
      where: { id },
    });

    res.status(200).json({
      message: "Inventory item deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createProfile,
  getMyProfile,
  updateMyProfile,
  getPublicPharmacies,
  getPublicPharmacyById,
  addInventoryItem,
  getMyInventory,
  updateInventoryItem,
  deleteInventoryItem,
};
