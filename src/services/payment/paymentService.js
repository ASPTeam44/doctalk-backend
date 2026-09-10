const { Prisma } = require("@prisma/client");
const prisma = require("../../config/prisma");
const razorpayService = require("./razorpayService");
const stripeService = require("./stripeService");
const { logPaymentAction } = require("../auditService");

// Valid payment state machine transitions
const VALID_PAYMENT_TRANSITIONS = {
  CREATED: ["PENDING", "FAILED", "CANCELLED"],
  PENDING: ["PROCESSING", "SUCCEEDED", "FAILED", "CANCELLED"],
  PROCESSING: ["SUCCEEDED", "FAILED"],
  SUCCEEDED: ["REFUNDED", "PARTIALLY_REFUNDED"],
  PARTIALLY_REFUNDED: ["PARTIALLY_REFUNDED", "REFUNDED"],
  FAILED: [],
  CANCELLED: [],
  REFUNDED: [],
};

const isValidTransition = (fromStatus, toStatus) => {
  if (fromStatus === toStatus) return true;
  const allowed = VALID_PAYMENT_TRANSITIONS[fromStatus] || [];
  return allowed.includes(toStatus);
};

// Sanitizes payment objects to ensure no sensitive credentials or internal keys are leaked
const sanitizePayment = (payment) => {
  if (!payment) return null;
  return {
    id: payment.id,
    patientId: payment.patientId,
    appointmentId: payment.appointmentId,
    medicineOrderId: payment.medicineOrderId,
    provider: payment.provider,
    purpose: payment.purpose,
    status: payment.status,
    amount: Number(payment.amount),
    currency: payment.currency,
    providerOrderId: payment.providerOrderId,
    refundAmount: Number(payment.refundAmount || 0),
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt,
    appointment: payment.appointment
      ? {
          id: payment.appointment.id,
          doctorId: payment.appointment.doctorId,
          appointmentDate: payment.appointment.appointmentDate,
          status: payment.appointment.status,
        }
      : undefined,
    medicineOrder: payment.medicineOrder
      ? {
          id: payment.medicineOrder.id,
          pharmacyId: payment.medicineOrder.pharmacyId,
          status: payment.medicineOrder.status,
          totalAmount: payment.medicineOrder.totalAmount,
        }
      : undefined,
  };
};

/**
 * 1. CONSULTATION PAYMENT INITIATION
 */
const createConsultationPayment = async ({
  patientId,
  appointmentId,
  provider = "RAZORPAY",
  idempotencyKey = null,
  ipAddress = null,
  userAgent = null,
}) => {
  if (!appointmentId || typeof appointmentId !== "string" || !appointmentId.trim()) {
    const error = new Error("appointmentId is required");
    error.statusCode = 400;
    throw error;
  }

  const normProvider = String(provider).toUpperCase().trim();
  if (!["RAZORPAY", "STRIPE"].includes(normProvider)) {
    const error = new Error("Invalid payment provider. Supported: RAZORPAY, STRIPE");
    error.statusCode = 400;
    throw error;
  }

  // Idempotency check: if an idempotency key was provided, check for previous request
  if (idempotencyKey) {
    const existingPaymentWithKey = await prisma.payment.findFirst({
      where: {
        patientId,
        idempotencyKey: String(idempotencyKey).trim(),
      },
      include: { appointment: true, medicineOrder: true },
    });

    if (existingPaymentWithKey) {
      if (existingPaymentWithKey.appointmentId === appointmentId.trim()) {
        await logPaymentAction({
          paymentId: existingPaymentWithKey.id,
          userId: patientId,
          action: "IDEMPOTENCY_REPLAY",
          ipAddress,
          userAgent,
          metadata: { idempotencyKey },
        });
        return {
          payment: sanitizePayment(existingPaymentWithKey),
          isReplay: true,
        };
      } else {
        const error = new Error("Idempotency key has already been used for another payment");
        error.statusCode = 409;
        throw error;
      }
    }
  }

  // Fetch appointment and verify ownership & validity
  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId.trim() },
    include: {
      doctor: {
        include: { doctorProfile: true },
      },
    },
  });

  if (!appointment) {
    const error = new Error("Appointment not found");
    error.statusCode = 404;
    throw error;
  }

  if (appointment.patientId !== patientId) {
    const error = new Error("Access forbidden: cannot pay for another patient's appointment");
    error.statusCode = 403;
    throw error;
  }

  if (appointment.status === "CANCELLED" || appointment.status === "COMPLETED") {
    const error = new Error(`Cannot pay for appointment in ${appointment.status} status`);
    error.statusCode = 400;
    throw error;
  }

  // Doctor must be verified
  const doctorProfile = appointment.doctor?.doctorProfile;
  if (!doctorProfile || !doctorProfile.verified) {
    const error = new Error("Doctor is not verified for paid consultations");
    error.statusCode = 400;
    throw error;
  }

  // Check if appointment already has a SUCCEEDED payment
  const existingSucceededPayment = await prisma.payment.findFirst({
    where: {
      appointmentId: appointment.id,
      status: "SUCCEEDED",
    },
  });

  if (existingSucceededPayment) {
    const error = new Error("This appointment has already been paid for");
    error.statusCode = 409;
    throw error;
  }

  // Calculate amount and currency server-side
  const amount = Number(doctorProfile.consultationFee);
  if (isNaN(amount) || amount <= 0) {
    const error = new Error("Doctor consultation fee is not configured");
    error.statusCode = 400;
    throw error;
  }

  // Currency strategy: RAZORPAY -> INR, STRIPE -> USD
  const currency = normProvider === "RAZORPAY" ? "INR" : "USD";

  // Check for an existing PENDING payment for this appointment and provider
  const existingPendingPayment = await prisma.payment.findFirst({
    where: {
      appointmentId: appointment.id,
      patientId,
      status: "PENDING",
      provider: normProvider,
    },
    include: { appointment: true },
  });

  if (existingPendingPayment) {
    return {
      payment: sanitizePayment(existingPendingPayment),
      checkout: {
        providerOrderId: existingPendingPayment.providerOrderId,
        currency: existingPendingPayment.currency,
        amount: Number(existingPendingPayment.amount),
      },
    };
  }

  // Create Payment record with PENDING status in DB
  const payment = await prisma.payment.create({
    data: {
      patientId,
      appointmentId: appointment.id,
      provider: normProvider,
      purpose: "CONSULTATION",
      status: "PENDING",
      amount: new Prisma.Decimal(amount.toFixed(2)),
      currency,
      idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
      metadata: {
        doctorId: appointment.doctorId,
        doctorName: appointment.doctor.name,
      },
    },
  });

  await logPaymentAction({
    paymentId: payment.id,
    userId: patientId,
    action: "PAYMENT_CREATED",
    ipAddress,
    userAgent,
    metadata: {
      amount,
      currency,
      provider: normProvider,
      purpose: "CONSULTATION",
    },
  });

  // Call provider to create order/payment intent
  let checkoutData = null;
  try {
    if (normProvider === "RAZORPAY") {
      if (razorpayService.isConfigured()) {
        const orderResult = await razorpayService.createOrder({
          amount,
          currency,
          receipt: payment.id,
          notes: { paymentId: payment.id, appointmentId: appointment.id },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: orderResult.providerOrderId },
        });
        payment.providerOrderId = orderResult.providerOrderId;
        checkoutData = {
          providerOrderId: orderResult.providerOrderId,
          currency,
          amount,
        };
      } else {
        // Controlled configuration error if live credentials are not available
        checkoutData = {
          providerOrderId: `mock_rzp_order_${payment.id}`,
          currency,
          amount,
          note: "Razorpay provider running in test/unconfigured mode",
        };
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: checkoutData.providerOrderId },
        });
      }
    } else if (normProvider === "STRIPE") {
      if (stripeService.isConfigured()) {
        const intentResult = await stripeService.createPaymentIntent({
          amount,
          currency,
          metadata: { paymentId: payment.id, appointmentId: appointment.id },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: intentResult.providerOrderId },
        });
        payment.providerOrderId = intentResult.providerOrderId;
        checkoutData = {
          providerOrderId: intentResult.providerOrderId,
          clientSecret: intentResult.clientSecret,
          currency,
          amount,
        };
      } else {
        checkoutData = {
          providerOrderId: `mock_pi_${payment.id}`,
          clientSecret: `mock_pi_secret_${payment.id}`,
          currency,
          amount,
          note: "Stripe provider running in test/unconfigured mode",
        };
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: checkoutData.providerOrderId },
        });
      }
    }

    await logPaymentAction({
      paymentId: payment.id,
      userId: patientId,
      action: "PAYMENT_PROVIDER_ORDER_CREATED",
      ipAddress,
      userAgent,
      metadata: { providerOrderId: checkoutData?.providerOrderId },
    });
  } catch (providerError) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failureCode: "PROVIDER_ORDER_CREATION_FAILED",
        failureMessage: providerError.message,
      },
    });
    throw providerError;
  }

  const updatedPayment = await prisma.payment.findUnique({
    where: { id: payment.id },
    include: { appointment: true },
  });

  return {
    payment: sanitizePayment(updatedPayment),
    checkout: checkoutData,
  };
};

/**
 * 2. MEDICINE ORDER PAYMENT INITIATION
 */
const createMedicineOrderPayment = async ({
  patientId,
  medicineOrderId,
  provider = "RAZORPAY",
  idempotencyKey = null,
  ipAddress = null,
  userAgent = null,
}) => {
  if (!medicineOrderId || typeof medicineOrderId !== "string" || !medicineOrderId.trim()) {
    const error = new Error("medicineOrderId is required");
    error.statusCode = 400;
    throw error;
  }

  const normProvider = String(provider).toUpperCase().trim();
  if (!["RAZORPAY", "STRIPE"].includes(normProvider)) {
    const error = new Error("Invalid payment provider. Supported: RAZORPAY, STRIPE");
    error.statusCode = 400;
    throw error;
  }

  // Idempotency check
  if (idempotencyKey) {
    const existingPaymentWithKey = await prisma.payment.findFirst({
      where: {
        patientId,
        idempotencyKey: String(idempotencyKey).trim(),
      },
      include: { appointment: true, medicineOrder: true },
    });

    if (existingPaymentWithKey) {
      if (existingPaymentWithKey.medicineOrderId === medicineOrderId.trim()) {
        await logPaymentAction({
          paymentId: existingPaymentWithKey.id,
          userId: patientId,
          action: "IDEMPOTENCY_REPLAY",
          ipAddress,
          userAgent,
          metadata: { idempotencyKey },
        });
        return {
          payment: sanitizePayment(existingPaymentWithKey),
          isReplay: true,
        };
      } else {
        const error = new Error("Idempotency key has already been used for another payment");
        error.statusCode = 409;
        throw error;
      }
    }
  }

  // Fetch medicine order and verify ownership & validity
  const order = await prisma.medicineOrder.findUnique({
    where: { id: medicineOrderId.trim() },
    include: { pharmacy: true },
  });

  if (!order) {
    const error = new Error("Medicine order not found");
    error.statusCode = 404;
    throw error;
  }

  if (order.patientId !== patientId) {
    const error = new Error("Access forbidden: cannot pay for another patient's medicine order");
    error.statusCode = 403;
    throw error;
  }

  if (order.status === "CANCELLED" || order.status === "REJECTED") {
    const error = new Error(`Cannot pay for medicine order in ${order.status} status`);
    error.statusCode = 400;
    throw error;
  }

  // Check if order already has a SUCCEEDED payment
  const existingSucceeded = await prisma.payment.findFirst({
    where: {
      medicineOrderId: order.id,
      status: "SUCCEEDED",
    },
  });

  if (existingSucceeded) {
    const error = new Error("This medicine order has already been paid for");
    error.statusCode = 409;
    throw error;
  }

  // Calculate amount strictly from trusted database order records
  const amount = Number(order.totalAmount);
  if (isNaN(amount) || amount <= 0) {
    const error = new Error("Invalid order total in database");
    error.statusCode = 400;
    throw error;
  }

  // Currency strategy:
  // Delivery country USA -> USD / STRIPE, otherwise INR / RAZORPAY by default
  const isUsOrder = order.deliveryCountry && order.deliveryCountry.toUpperCase().includes("USA");
  const currency = isUsOrder ? "USD" : (normProvider === "RAZORPAY" ? "INR" : "USD");

  // Check for an existing PENDING payment for this order
  const existingPendingPayment = await prisma.payment.findFirst({
    where: {
      medicineOrderId: order.id,
      patientId,
      status: "PENDING",
      provider: normProvider,
    },
    include: { medicineOrder: true },
  });

  if (existingPendingPayment) {
    return {
      payment: sanitizePayment(existingPendingPayment),
      checkout: {
        providerOrderId: existingPendingPayment.providerOrderId,
        currency: existingPendingPayment.currency,
        amount: Number(existingPendingPayment.amount),
      },
    };
  }

  // Create Payment record
  const payment = await prisma.payment.create({
    data: {
      patientId,
      medicineOrderId: order.id,
      provider: normProvider,
      purpose: "MEDICINE_ORDER",
      status: "PENDING",
      amount: new Prisma.Decimal(amount.toFixed(2)),
      currency,
      idempotencyKey: idempotencyKey ? String(idempotencyKey).trim() : null,
      metadata: {
        pharmacyId: order.pharmacyId,
        pharmacyName: order.pharmacy?.pharmacyName,
      },
    },
  });

  await logPaymentAction({
    paymentId: payment.id,
    userId: patientId,
    action: "PAYMENT_CREATED",
    ipAddress,
    userAgent,
    metadata: {
      amount,
      currency,
      provider: normProvider,
      purpose: "MEDICINE_ORDER",
    },
  });

  let checkoutData = null;
  try {
    if (normProvider === "RAZORPAY") {
      if (razorpayService.isConfigured()) {
        const orderResult = await razorpayService.createOrder({
          amount,
          currency,
          receipt: payment.id,
          notes: { paymentId: payment.id, medicineOrderId: order.id },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: orderResult.providerOrderId },
        });
        payment.providerOrderId = orderResult.providerOrderId;
        checkoutData = {
          providerOrderId: orderResult.providerOrderId,
          currency,
          amount,
        };
      } else {
        checkoutData = {
          providerOrderId: `mock_rzp_order_${payment.id}`,
          currency,
          amount,
          note: "Razorpay provider running in test/unconfigured mode",
        };
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: checkoutData.providerOrderId },
        });
      }
    } else if (normProvider === "STRIPE") {
      if (stripeService.isConfigured()) {
        const intentResult = await stripeService.createPaymentIntent({
          amount,
          currency,
          metadata: { paymentId: payment.id, medicineOrderId: order.id },
        });
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: intentResult.providerOrderId },
        });
        payment.providerOrderId = intentResult.providerOrderId;
        checkoutData = {
          providerOrderId: intentResult.providerOrderId,
          clientSecret: intentResult.clientSecret,
          currency,
          amount,
        };
      } else {
        checkoutData = {
          providerOrderId: `mock_pi_${payment.id}`,
          clientSecret: `mock_pi_secret_${payment.id}`,
          currency,
          amount,
          note: "Stripe provider running in test/unconfigured mode",
        };
        await prisma.payment.update({
          where: { id: payment.id },
          data: { providerOrderId: checkoutData.providerOrderId },
        });
      }
    }

    await logPaymentAction({
      paymentId: payment.id,
      userId: patientId,
      action: "PAYMENT_PROVIDER_ORDER_CREATED",
      ipAddress,
      userAgent,
      metadata: { providerOrderId: checkoutData?.providerOrderId },
    });
  } catch (providerError) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "FAILED",
        failureCode: "PROVIDER_ORDER_CREATION_FAILED",
        failureMessage: providerError.message,
      },
    });
    throw providerError;
  }

  const updatedPayment = await prisma.payment.findUnique({
    where: { id: payment.id },
    include: { medicineOrder: true },
  });

  return {
    payment: sanitizePayment(updatedPayment),
    checkout: checkoutData,
  };
};

/**
 * 3. MARK PAYMENT SUCCEEDED (Verified Provider Confirmation)
 */
const markPaymentSucceeded = async ({
  paymentId,
  providerPaymentId,
  providerOrderId = null,
  providerSignature = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { appointment: true, medicineOrder: true },
  });

  if (!payment) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }

  // Idempotency check: if already SUCCEEDED, return gracefully without duplicate side-effects
  if (payment.status === "SUCCEEDED") {
    await logPaymentAction({
      paymentId: payment.id,
      userId: payment.patientId,
      action: "IDEMPOTENCY_REPLAY",
      ipAddress,
      userAgent,
      metadata: { message: "Duplicate payment success ignored" },
    });
    return sanitizePayment(payment);
  }

  // State machine transition validation
  if (!isValidTransition(payment.status, "SUCCEEDED")) {
    const error = new Error(`Invalid state transition: cannot change payment status from ${payment.status} to SUCCEEDED`);
    error.statusCode = 400;
    throw error;
  }

  const updatedPayment = await prisma.$transaction(async (tx) => {
    const updated = await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCEEDED",
        providerPaymentId: providerPaymentId ? String(providerPaymentId) : payment.providerPaymentId,
        providerOrderId: providerOrderId ? String(providerOrderId) : payment.providerOrderId,
        providerSignature: providerSignature ? String(providerSignature) : payment.providerSignature,
        metadata: metadata ? { ...(payment.metadata || {}), ...metadata } : payment.metadata,
      },
      include: { appointment: true, medicineOrder: true },
    });

    return updated;
  });

  await logPaymentAction({
    paymentId: payment.id,
    userId: payment.patientId,
    action: "PAYMENT_SUCCEEDED",
    ipAddress,
    userAgent,
    metadata: {
      providerPaymentId,
      amount: Number(payment.amount),
      currency: payment.currency,
    },
  });

  return sanitizePayment(updatedPayment);
};

/**
 * 4. MARK PAYMENT FAILED
 */
const markPaymentFailed = async ({
  paymentId,
  failureCode = null,
  failureMessage = null,
  metadata = null,
  ipAddress = null,
  userAgent = null,
}) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }

  if (payment.status === "FAILED") {
    return sanitizePayment(payment);
  }

  if (!isValidTransition(payment.status, "FAILED")) {
    const error = new Error(`Invalid state transition: cannot change payment from ${payment.status} to FAILED`);
    error.statusCode = 400;
    throw error;
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "FAILED",
      failureCode: failureCode ? String(failureCode) : null,
      failureMessage: failureMessage ? String(failureMessage) : null,
      metadata: metadata ? { ...(payment.metadata || {}), ...metadata } : payment.metadata,
    },
  });

  await logPaymentAction({
    paymentId: payment.id,
    userId: payment.patientId,
    action: "PAYMENT_FAILED",
    ipAddress,
    userAgent,
    metadata: { failureCode, failureMessage },
  });

  return sanitizePayment(updated);
};

/**
 * 5. CANCEL PAYMENT
 */
const cancelPayment = async ({
  paymentId,
  patientId,
  reason = null,
  ipAddress = null,
  userAgent = null,
}) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }

  if (payment.patientId !== patientId) {
    const error = new Error("Access forbidden: you cannot cancel another patient's payment");
    error.statusCode = 403;
    throw error;
  }

  if (!isValidTransition(payment.status, "CANCELLED")) {
    const error = new Error(`Cannot cancel payment in ${payment.status} status. Succeeded payments must be refunded.`);
    error.statusCode = 400;
    throw error;
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: "CANCELLED",
      failureMessage: reason ? String(reason) : "Cancelled by patient",
    },
  });

  await logPaymentAction({
    paymentId: payment.id,
    userId: patientId,
    action: "PAYMENT_CANCELLED",
    ipAddress,
    userAgent,
    metadata: { reason },
  });

  return sanitizePayment(updated);
};

/**
 * 6. REFUND ARCHITECTURE
 */
const refundPayment = async ({
  paymentId,
  requestedByUserId,
  requestedByRole,
  amount = null,
  reason = "Requested by administrator",
  ipAddress = null,
  userAgent = null,
}) => {
  // Only ADMIN is authorized to issue refunds
  if (requestedByRole !== "ADMIN") {
    const error = new Error("Access forbidden: only administrators can issue refunds");
    error.statusCode = 403;
    throw error;
  }

  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: { appointment: true, medicineOrder: true },
  });

  if (!payment) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }

  // Must be in SUCCEEDED or PARTIALLY_REFUNDED status
  if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(payment.status)) {
    const error = new Error(`Cannot refund payment in ${payment.status} status. Only successful payments can be refunded.`);
    error.statusCode = 400;
    throw error;
  }

  const paymentAmount = Number(payment.amount);
  const currentRefundAmount = Number(payment.refundAmount || 0);
  const remainingRefundable = paymentAmount - currentRefundAmount;

  if (remainingRefundable <= 0) {
    const error = new Error("This payment has already been fully refunded");
    error.statusCode = 400;
    throw error;
  }

  // Determine refund amount
  let refundAmt = remainingRefundable;
  if (amount !== null && amount !== undefined) {
    const parsedAmount = Number(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      const error = new Error("Refund amount must be a positive number");
      error.statusCode = 400;
      throw error;
    }
    if (parsedAmount > remainingRefundable) {
      const error = new Error(`Refund amount (${parsedAmount}) exceeds refundable balance (${remainingRefundable})`);
      error.statusCode = 400;
      throw error;
    }
    refundAmt = parsedAmount;
  }

  await logPaymentAction({
    paymentId: payment.id,
    userId: requestedByUserId,
    action: "REFUND_CREATED",
    ipAddress,
    userAgent,
    metadata: {
      requestedAmount: refundAmt,
      remainingRefundable,
      reason,
    },
  });

  // Call provider refund if configured
  try {
    if (payment.provider === "RAZORPAY" && razorpayService.isConfigured() && payment.providerPaymentId) {
      await razorpayService.createRefund({
        providerPaymentId: payment.providerPaymentId,
        amount: refundAmt,
        notes: { paymentId: payment.id, reason },
      });
    } else if (payment.provider === "STRIPE" && stripeService.isConfigured() && payment.providerPaymentId) {
      await stripeService.createRefund({
        providerPaymentId: payment.providerPaymentId,
        amount: refundAmt,
        reason: "requested_by_customer",
      });
    }
  } catch (providerError) {
    await logPaymentAction({
      paymentId: payment.id,
      userId: requestedByUserId,
      action: "REFUND_FAILED",
      ipAddress,
      userAgent,
      metadata: { error: providerError.message },
    });
    throw providerError;
  }

  // Update DB state atomically
  const newTotalRefundAmount = currentRefundAmount + refundAmt;
  const newStatus = newTotalRefundAmount >= paymentAmount ? "REFUNDED" : "PARTIALLY_REFUNDED";

  const updatedPayment = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      status: newStatus,
      refundAmount: new Prisma.Decimal(newTotalRefundAmount.toFixed(2)),
    },
    include: { appointment: true, medicineOrder: true },
  });

  await logPaymentAction({
    paymentId: payment.id,
    userId: requestedByUserId,
    action: "REFUND_SUCCEEDED",
    ipAddress,
    userAgent,
    metadata: {
      refundAmount: refundAmt,
      totalRefunded: newTotalRefundAmount,
      newStatus,
    },
  });

  return sanitizePayment(updatedPayment);
};

/**
 * 7. WEBHOOK DISPATCHERS & HANDLERS
 */
const handleRazorpayWebhook = async ({
  rawBody,
  signature,
  customSecret = null,
  ipAddress = null,
  userAgent = null,
}) => {
  if (!signature) {
    const error = new Error("Missing x-razorpay-signature header");
    error.statusCode = 400;
    throw error;
  }

  const isValid = razorpayService.verifyWebhookSignature({
    rawBody,
    signature,
    customSecret,
  });

  if (!isValid) {
    const error = new Error("Invalid Razorpay webhook signature");
    error.statusCode = 400;
    throw error;
  }

  let event;
  try {
    event = typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString("utf-8"));
  } catch (err) {
    const error = new Error("Invalid webhook JSON payload");
    error.statusCode = 400;
    throw error;
  }

  const eventType = event.event;
  const paymentEntity = event.payload?.payment?.entity;
  const orderEntity = event.payload?.order?.entity;

  const providerOrderId = orderEntity?.id || paymentEntity?.order_id;
  const providerPaymentId = paymentEntity?.id;

  // Look up payment by providerOrderId or notes.paymentId
  const notesPaymentId = paymentEntity?.notes?.paymentId || orderEntity?.notes?.paymentId;

  let payment = null;
  if (notesPaymentId) {
    payment = await prisma.payment.findUnique({ where: { id: notesPaymentId } });
  }
  if (!payment && providerOrderId) {
    payment = await prisma.payment.findFirst({ where: { providerOrderId } });
  }

  if (payment) {
    await logPaymentAction({
      paymentId: payment.id,
      userId: null,
      action: "WEBHOOK_RECEIVED",
      ipAddress,
      userAgent,
      metadata: { event: eventType, provider: "RAZORPAY" },
    });

    if (eventType === "order.paid" || eventType === "payment.captured") {
      await markPaymentSucceeded({
        paymentId: payment.id,
        providerPaymentId: providerPaymentId || `rzp_pay_${Date.now()}`,
        providerOrderId,
        providerSignature: signature,
        metadata: { webhookEvent: eventType },
        ipAddress,
        userAgent,
      });
    } else if (eventType === "payment.failed") {
      await markPaymentFailed({
        paymentId: payment.id,
        failureCode: paymentEntity?.error_code || "PAYMENT_FAILED",
        failureMessage: paymentEntity?.error_description || "Payment failed via Razorpay",
        metadata: { webhookEvent: eventType },
        ipAddress,
        userAgent,
      });
    }
  }

  return { received: true, event: eventType };
};

const handleStripeWebhook = async ({
  rawBody,
  signature,
  customSecret = null,
  ipAddress = null,
  userAgent = null,
}) => {
  if (!signature) {
    const error = new Error("Missing stripe-signature header");
    error.statusCode = 400;
    throw error;
  }

  let event;
  try {
    event = stripeService.constructWebhookEvent({
      rawBody,
      signature,
      customSecret,
    });
  } catch (err) {
    throw err;
  }

  const eventType = event.type;
  const dataObject = event.data?.object;

  const providerOrderId = dataObject?.id;
  const notesPaymentId = dataObject?.metadata?.paymentId;

  let payment = null;
  if (notesPaymentId) {
    payment = await prisma.payment.findUnique({ where: { id: notesPaymentId } });
  }
  if (!payment && providerOrderId) {
    payment = await prisma.payment.findFirst({ where: { providerOrderId } });
  }

  if (payment) {
    await logPaymentAction({
      paymentId: payment.id,
      userId: null,
      action: "WEBHOOK_RECEIVED",
      ipAddress,
      userAgent,
      metadata: { event: eventType, provider: "STRIPE" },
    });

    if (eventType === "payment_intent.succeeded") {
      const chargeId = dataObject.latest_charge || dataObject.charges?.data?.[0]?.id || dataObject.id;
      await markPaymentSucceeded({
        paymentId: payment.id,
        providerPaymentId: chargeId,
        providerOrderId,
        providerSignature: signature,
        metadata: { webhookEvent: eventType },
        ipAddress,
        userAgent,
      });
    } else if (eventType === "payment_intent.payment_failed") {
      await markPaymentFailed({
        paymentId: payment.id,
        failureCode: dataObject.last_payment_error?.code || "PAYMENT_INTENT_FAILED",
        failureMessage: dataObject.last_payment_error?.message || "Stripe payment intent failed",
        metadata: { webhookEvent: eventType },
        ipAddress,
        userAgent,
      });
    }
  }

  return { received: true, event: eventType };
};

/**
 * 8. PAYMENT QUERIES & STRICT AUTHORIZATION
 */
const getPaymentsForPatient = async ({ patientId, page = 1, limit = 20 }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where: { patientId },
      include: {
        appointment: {
          select: {
            id: true,
            appointmentDate: true,
            status: true,
            doctor: { select: { id: true, name: true } },
          },
        },
        medicineOrder: {
          select: {
            id: true,
            status: true,
            totalAmount: true,
            pharmacy: { select: { id: true, pharmacyName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip,
      take: limitNum,
    }),
    prisma.payment.count({ where: { patientId } }),
  ]);

  return {
    payments: payments.map(sanitizePayment),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

const getPaymentById = async ({ paymentId, userId, userRole }) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
    include: {
      appointment: {
        include: {
          doctor: { select: { id: true, name: true } },
        },
      },
      medicineOrder: {
        include: {
          pharmacy: { select: { id: true, userId: true, pharmacyName: true } },
        },
      },
    },
  });

  if (!payment) {
    const error = new Error("Payment not found");
    error.statusCode = 404;
    throw error;
  }

  // Role-based access control
  let authorized = false;

  if (userRole === "ADMIN") {
    authorized = true;
  } else if (userRole === "PATIENT" && payment.patientId === userId) {
    authorized = true;
  } else if (userRole === "DOCTOR" && payment.appointment?.doctorId === userId) {
    authorized = true;
  } else if (userRole === "PHARMACY" && payment.medicineOrder?.pharmacy?.userId === userId) {
    authorized = true;
  }

  if (!authorized) {
    const error = new Error("Access forbidden: you do not have permission to view this payment");
    error.statusCode = 403;
    throw error;
  }

  return sanitizePayment(payment);
};

module.exports = {
  createConsultationPayment,
  createMedicineOrderPayment,
  markPaymentSucceeded,
  markPaymentFailed,
  cancelPayment,
  refundPayment,
  handleRazorpayWebhook,
  handleStripeWebhook,
  getPaymentsForPatient,
  getPaymentById,
  sanitizePayment,
  VALID_PAYMENT_TRANSITIONS,
};
