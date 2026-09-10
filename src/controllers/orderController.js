const prisma = require("../config/prisma");
const { logOrderAction } = require("../services/auditService");

// Allowed status transitions for pharmacy fulfillment
const PHARMACY_STATUS_TRANSITIONS = {
  PENDING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["PACKED"],
  PACKED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
};

// 1. POST /api/orders (PATIENT only)
const createOrder = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const {
      prescriptionId,
      pharmacyId,
      items,
      delivery,
    } = req.body;

    // 1. Validate prescriptionId
    if (!prescriptionId || typeof prescriptionId !== "string" || !prescriptionId.trim()) {
      return res.status(400).json({ message: "prescriptionId is required" });
    }

    // 2. Validate pharmacyId
    if (!pharmacyId || typeof pharmacyId !== "string" || !pharmacyId.trim()) {
      return res.status(400).json({ message: "pharmacyId is required" });
    }

    // 3. Validate items array
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "At least one order item is required" });
    }

    // 4. Validate delivery address
    if (!delivery || typeof delivery !== "object") {
      return res.status(400).json({ message: "Delivery information is required" });
    }

    const {
      name: deliveryName,
      phone: deliveryPhone,
      addressLine1,
      addressLine2,
      city,
      state,
      country,
      postalCode,
    } = delivery;

    if (!deliveryName || typeof deliveryName !== "string" || !deliveryName.trim()) {
      return res.status(400).json({ message: "delivery.name is required" });
    }
    if (!deliveryPhone || typeof deliveryPhone !== "string" || !deliveryPhone.trim()) {
      return res.status(400).json({ message: "delivery.phone is required" });
    }
    if (!addressLine1 || typeof addressLine1 !== "string" || !addressLine1.trim()) {
      return res.status(400).json({ message: "delivery.addressLine1 is required" });
    }
    if (!city || typeof city !== "string" || !city.trim()) {
      return res.status(400).json({ message: "delivery.city is required" });
    }
    if (!state || typeof state !== "string" || !state.trim()) {
      return res.status(400).json({ message: "delivery.state is required" });
    }
    if (!country || typeof country !== "string" || !country.trim()) {
      return res.status(400).json({ message: "delivery.country is required" });
    }
    if (!postalCode || typeof postalCode !== "string" || !postalCode.trim()) {
      return res.status(400).json({ message: "delivery.postalCode is required" });
    }

    // 5. Look up prescription and verify ownership + status
    const prescription = await prisma.prescription.findUnique({
      where: { id: prescriptionId.trim() },
      include: {
        items: true,
      },
    });

    if (!prescription) {
      return res.status(404).json({ message: "Prescription not found" });
    }

    if (prescription.patientId !== patientId) {
      return res.status(403).json({ message: "Access forbidden: cannot order using another patient's prescription" });
    }

    if (prescription.status !== "ISSUED") {
      return res.status(400).json({
        message: `Prescription must be in ISSUED status to place an order (current status: ${prescription.status})`,
      });
    }

    // 6. Look up pharmacy profile and verify verified + active
    const pharmacy = await prisma.pharmacyProfile.findUnique({
      where: { id: pharmacyId.trim() },
    });

    if (!pharmacy) {
      return res.status(404).json({ message: "Pharmacy not found" });
    }

    if (!pharmacy.verified || !pharmacy.active) {
      return res.status(400).json({ message: "Selected pharmacy is not verified or currently inactive" });
    }

    // 7. Validate each requested item and prevent duplicate medicineId
    const medicineIdSet = new Set();
    const validatedItems = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      if (!item.medicineId || typeof item.medicineId !== "string" || !item.medicineId.trim()) {
        return res.status(400).json({ message: `Item #${i + 1}: medicineId is required` });
      }

      const medId = item.medicineId.trim();
      if (medicineIdSet.has(medId)) {
        return res.status(400).json({ message: `Item #${i + 1}: duplicate medicineId in order` });
      }
      medicineIdSet.add(medId);

      const quantity = parseInt(item.quantity, 10);
      if (isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ message: `Item #${i + 1}: quantity must be a positive integer (> 0)` });
      }

      // Check medicine in DB
      const medicine = await prisma.medicine.findUnique({
        where: { id: medId },
      });

      if (!medicine || !medicine.active) {
        return res.status(400).json({ message: `Medicine not found or inactive: ${medId}` });
      }

      // If prescription is required, verify match against prescription items
      if (medicine.prescriptionRequired) {
        const matchingRxItem = prescription.items.find((rxItem) => {
          const rxName = rxItem.medicineName.toLowerCase().trim();
          return (
            rxName === medicine.name.toLowerCase().trim() ||
            (medicine.brandName && rxName === medicine.brandName.toLowerCase().trim()) ||
            (medicine.genericName && rxName === medicine.genericName.toLowerCase().trim())
          );
        });

        if (!matchingRxItem) {
          return res.status(400).json({
            message: `Medicine '${medicine.name}' requires a prescription and was not found in prescription ${prescriptionId}`,
          });
        }

        // Validate quantity does not exceed prescribed limit
        if (quantity > matchingRxItem.quantity) {
          return res.status(400).json({
            message: `Requested quantity (${quantity}) exceeds prescribed limit (${matchingRxItem.quantity}) for '${medicine.name}'`,
          });
        }
      }

      // Check inventory at the selected pharmacy
      const inventory = await prisma.inventory.findUnique({
        where: {
          pharmacyId_medicineId: {
            pharmacyId: pharmacy.id,
            medicineId: medicine.id,
          },
        },
      });

      if (!inventory || !inventory.active) {
        return res.status(400).json({
          message: `Medicine '${medicine.name}' is not in stock at pharmacy '${pharmacy.pharmacyName}'`,
        });
      }

      const availableQuantity = inventory.stockQuantity - inventory.reservedQuantity;
      if (availableQuantity < quantity) {
        return res.status(409).json({
          message: `Insufficient stock for '${medicine.name}'. Requested: ${quantity}, Available: ${availableQuantity}`,
        });
      }

      const unitPrice = inventory.sellingPrice;
      const totalPrice = Math.round(unitPrice * quantity * 100) / 100;

      validatedItems.push({
        medicine,
        inventory,
        quantity,
        unitPrice,
        totalPrice,
      });
    }

    // 8. Calculate order totals server-side
    const subtotal = validatedItems.reduce((acc, it) => acc + it.totalPrice, 0);
    const roundedSubtotal = Math.round(subtotal * 100) / 100;
    const deliveryFee = 50.0; // Standard flat delivery fee
    const totalAmount = Math.round((roundedSubtotal + deliveryFee) * 100) / 100;

    // 9. Atomic transaction: reserve stock, create order, create order items, audit log
    const newOrder = await prisma.$transaction(async (tx) => {
      // Concurrency-safe atomic reservation
      for (const item of validatedItems) {
        const updatedCount = await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedQuantity" = "reservedQuantity" + ${item.quantity},
              "updatedAt" = NOW()
          WHERE "id" = ${item.inventory.id}
            AND ("stockQuantity" - "reservedQuantity") >= ${item.quantity}
        `;

        if (updatedCount === 0) {
          throw new Error(`OVERSOLD_CONFLICT:${item.medicine.name}`);
        }
      }

      // Create order
      const order = await tx.medicineOrder.create({
        data: {
          patientId,
          pharmacyId: pharmacy.id,
          prescriptionId: prescription.id,
          status: "PENDING",
          subtotal: roundedSubtotal,
          deliveryFee,
          totalAmount,
          deliveryName: deliveryName.trim(),
          deliveryPhone: deliveryPhone.trim(),
          deliveryAddressLine1: addressLine1.trim(),
          deliveryAddressLine2: addressLine2 ? String(addressLine2).trim() : null,
          deliveryCity: city.trim(),
          deliveryState: state.trim(),
          deliveryCountry: country.trim(),
          deliveryPostalCode: postalCode.trim(),
          items: {
            create: validatedItems.map((it) => ({
              medicineId: it.medicine.id,
              medicineNameSnapshot: it.medicine.name,
              strengthSnapshot: it.medicine.strength,
              dosageFormSnapshot: it.medicine.dosageForm,
              quantity: it.quantity,
              unitPrice: it.unitPrice,
              totalPrice: it.totalPrice,
            })),
          },
        },
        include: {
          items: true,
          pharmacy: {
            select: {
              id: true,
              pharmacyName: true,
              phone: true,
              addressLine1: true,
              city: true,
              state: true,
              country: true,
            },
          },
        },
      });

      return order;
    });

    await logOrderAction({
      orderId: newOrder.id,
      userId: patientId,
      action: "ORDER_CREATED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(201).json({
      message: "Order placed successfully and stock reserved",
      order: newOrder,
    });
  } catch (error) {
    if (error.message && error.message.startsWith("OVERSOLD_CONFLICT:")) {
      const medName = error.message.split(":")[1];
      return res.status(409).json({
        message: `Inventory stock conflict: concurrent order reserved remaining stock for '${medName}'`,
      });
    }
    next(error);
  }
};

// 2. GET /api/orders/my-orders (PATIENT only)
const getMyOrders = async (req, res, next) => {
  try {
    const patientId = req.user.id;

    const orders = await prisma.medicineOrder.findMany({
      where: { patientId },
      include: {
        items: true,
        pharmacy: {
          select: {
            id: true,
            pharmacyName: true,
            phone: true,
            addressLine1: true,
            city: true,
            state: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ orders });
  } catch (error) {
    next(error);
  }
};

// 3. GET /api/orders/pharmacy (PHARMACY only)
const getPharmacyOrders = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const profile = await prisma.pharmacyProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    const orders = await prisma.medicineOrder.findMany({
      where: { pharmacyId: profile.id },
      include: {
        items: true,
        prescription: {
          select: {
            id: true,
            createdAt: true,
            doctor: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    res.status(200).json({ orders });
  } catch (error) {
    next(error);
  }
};

// 4. GET /api/orders/:id (PATIENT or PHARMACY only)
const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const role = req.user.role;

    const order = await prisma.medicineOrder.findUnique({
      where: { id },
      include: {
        items: true,
        pharmacy: {
          select: {
            id: true,
            userId: true,
            pharmacyName: true,
            phone: true,
            addressLine1: true,
            city: true,
            state: true,
          },
        },
        prescription: {
          select: {
            id: true,
            createdAt: true,
            doctor: {
              select: {
                name: true,
                doctorProfile: {
                  select: {
                    specialization: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Access authorization check
    let authorized = false;
    if (role === "PATIENT" && order.patientId === userId) {
      authorized = true;
    } else if (role === "PHARMACY" && order.pharmacy.userId === userId) {
      authorized = true;
    }

    if (!authorized) {
      return res.status(403).json({ message: "Access forbidden: you do not have permission to view this order" });
    }

    // Strip sensitive internal fields from pharmacy profile
    const { userId: _, ...safePharmacy } = order.pharmacy;

    res.status(200).json({
      order: {
        ...order,
        pharmacy: safePharmacy,
      },
    });
  } catch (error) {
    next(error);
  }
};

// 5. PUT /api/orders/:id/status (PHARMACY only)
const updateOrderStatus = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;
    const { status: targetStatus } = req.body;

    if (!targetStatus || typeof targetStatus !== "string") {
      return res.status(400).json({ message: "Target status is required" });
    }

    const normTargetStatus = targetStatus.trim().toUpperCase();

    const profile = await prisma.pharmacyProfile.findUnique({
      where: { userId },
    });

    if (!profile) {
      return res.status(404).json({ message: "Pharmacy profile not found" });
    }

    const order = await prisma.medicineOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.pharmacyId !== profile.id) {
      return res.status(403).json({ message: "Access forbidden: cannot update another pharmacy's order" });
    }

    // Validate state transition
    const allowedNextStatuses = PHARMACY_STATUS_TRANSITIONS[order.status] || [];
    if (!allowedNextStatuses.includes(normTargetStatus)) {
      return res.status(400).json({
        message: `Invalid state transition: cannot move order from ${order.status} to ${normTargetStatus}. Allowed: ${allowedNextStatuses.join(", ") || "None"}`,
      });
    }

    // Payment gate: fulfillment cannot start or proceed if order payment is pending or incomplete
    if (normTargetStatus !== "REJECTED") {
      const payments = await prisma.payment.findMany({
        where: { medicineOrderId: id },
      });
      if (payments.length > 0) {
        const hasSucceeded = payments.some((p) => p.status === "SUCCEEDED");
        if (!hasSucceeded) {
          return res.status(400).json({
            message: "Cannot fulfill order: payment is pending, incomplete, or failed",
          });
        }
      }
    }

    // Process transition in transaction
    const updatedOrder = await prisma.$transaction(async (tx) => {
      // If REJECTED: release reserved stock
      if (normTargetStatus === "REJECTED") {
        for (const item of order.items) {
          await tx.$executeRaw`
            UPDATE "Inventory"
            SET "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${item.quantity}),
                "updatedAt" = NOW()
            WHERE "pharmacyId" = ${profile.id} AND "medicineId" = ${item.medicineId}
          `;
        }
      }

      // If DELIVERED: consume reserved stock (reduce stockQuantity and reservedQuantity)
      if (normTargetStatus === "DELIVERED") {
        for (const item of order.items) {
          await tx.$executeRaw`
            UPDATE "Inventory"
            SET "stockQuantity" = GREATEST(0, "stockQuantity" - ${item.quantity}),
                "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${item.quantity}),
                "updatedAt" = NOW()
            WHERE "pharmacyId" = ${profile.id} AND "medicineId" = ${item.medicineId}
          `;
        }
      }

      return await tx.medicineOrder.update({
        where: { id },
        data: { status: normTargetStatus },
        include: { items: true },
      });
    });

    // Audit log event
    const auditActionMap = {
      ACCEPTED: "ORDER_ACCEPTED",
      REJECTED: "ORDER_REJECTED",
      PACKED: "ORDER_PACKED",
      OUT_FOR_DELIVERY: "ORDER_OUT_FOR_DELIVERY",
      DELIVERED: "ORDER_DELIVERED",
    };

    if (auditActionMap[normTargetStatus]) {
      await logOrderAction({
        orderId: id,
        userId,
        action: auditActionMap[normTargetStatus],
        ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
        userAgent: req.headers["user-agent"] || null,
      });
    }

    res.status(200).json({
      message: `Order status updated to ${normTargetStatus}`,
      order: updatedOrder,
    });
  } catch (error) {
    next(error);
  }
};

// 6. PUT /api/orders/:id/cancel (PATIENT only)
const cancelOrder = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const { id } = req.params;

    const order = await prisma.medicineOrder.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (order.patientId !== patientId) {
      return res.status(403).json({ message: "Access forbidden: cannot cancel another patient's order" });
    }

    if (order.status !== "PENDING") {
      return res.status(400).json({
        message: `Order cannot be cancelled in its current status: ${order.status}. Only PENDING orders can be cancelled.`,
      });
    }

    // Atomic transaction: release reserved stock and mark CANCELLED
    const cancelledOrder = await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedQuantity" = GREATEST(0, "reservedQuantity" - ${item.quantity}),
              "updatedAt" = NOW()
          WHERE "pharmacyId" = ${order.pharmacyId} AND "medicineId" = ${item.medicineId}
        `;
      }

      return await tx.medicineOrder.update({
        where: { id },
        data: { status: "CANCELLED" },
        include: { items: true },
      });
    });

    await logOrderAction({
      orderId: id,
      userId: patientId,
      action: "ORDER_CANCELLED",
      ipAddress: req.ip || req.headers["x-forwarded-for"] || null,
      userAgent: req.headers["user-agent"] || null,
    });

    res.status(200).json({
      message: "Order cancelled successfully and stock reservation released",
      order: cancelledOrder,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createOrder,
  getMyOrders,
  getPharmacyOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
};
