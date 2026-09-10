const paymentService = require("../services/payment/paymentService");

const createConsultationPayment = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const { appointmentId, provider } = req.body;
    const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await paymentService.createConsultationPayment({
      patientId,
      appointmentId,
      provider,
      idempotencyKey,
      ipAddress,
      userAgent,
    });

    const statusCode = result.isReplay ? 200 : 201;
    res.status(statusCode).json({
      message: result.isReplay ? "Idempotent payment retrieved" : "Consultation payment initiated successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const createMedicineOrderPayment = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const { medicineOrderId, provider } = req.body;
    const idempotencyKey = req.headers["idempotency-key"] || req.headers["x-idempotency-key"] || null;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await paymentService.createMedicineOrderPayment({
      patientId,
      medicineOrderId,
      provider,
      idempotencyKey,
      ipAddress,
      userAgent,
    });

    const statusCode = result.isReplay ? 200 : 201;
    res.status(statusCode).json({
      message: result.isReplay ? "Idempotent payment retrieved" : "Medicine order payment initiated successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const getMyPayments = async (req, res, next) => {
  try {
    const patientId = req.user.id;
    const { page, limit } = req.query;

    const result = await paymentService.getPaymentsForPatient({
      patientId,
      page,
      limit,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getPaymentById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const payment = await paymentService.getPaymentById({
      paymentId: id,
      userId,
      userRole,
    });

    res.status(200).json({ payment });
  } catch (error) {
    next(error);
  }
};

const cancelPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const patientId = req.user.id;
    const { reason } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const payment = await paymentService.cancelPayment({
      paymentId: id,
      patientId,
      reason,
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      message: "Payment cancelled successfully",
      payment,
    });
  } catch (error) {
    next(error);
  }
};

const refundPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const requestedByUserId = req.user.id;
    const requestedByRole = req.user.role;
    const { amount, reason } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const payment = await paymentService.refundPayment({
      paymentId: id,
      requestedByUserId,
      requestedByRole,
      amount,
      reason,
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      message: "Payment refunded successfully",
      payment,
    });
  } catch (error) {
    next(error);
  }
};

const handleRazorpayWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["x-razorpay-signature"];
    const rawBody = req.rawBody || req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const customSecret = req.headers["x-test-webhook-secret"] || null;

    const result = await paymentService.handleRazorpayWebhook({
      rawBody,
      signature,
      customSecret,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const handleStripeWebhook = async (req, res, next) => {
  try {
    const signature = req.headers["stripe-signature"];
    const rawBody = req.rawBody || req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const customSecret = req.headers["x-test-webhook-secret"] || null;

    const result = await paymentService.handleStripeWebhook({
      rawBody,
      signature,
      customSecret,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createConsultationPayment,
  createMedicineOrderPayment,
  getMyPayments,
  getPaymentById,
  cancelPayment,
  refundPayment,
  handleRazorpayWebhook,
  handleStripeWebhook,
};
