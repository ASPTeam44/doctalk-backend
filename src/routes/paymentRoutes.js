const express = require("express");
const paymentController = require("../controllers/paymentController");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

// Public Webhook routes (No JWT authentication; verified by provider signature)
router.post("/webhooks/razorpay", paymentController.handleRazorpayWebhook);
router.post("/webhooks/stripe", paymentController.handleStripeWebhook);

// Protected routes (JWT authentication required)
router.use(authMiddleware);

// Patient payment initiation & history
router.post(
  "/consultation",
  authorizeRoles("PATIENT"),
  paymentController.createConsultationPayment
);

router.post(
  "/medicine-order",
  authorizeRoles("PATIENT"),
  paymentController.createMedicineOrderPayment
);

router.get(
  "/my-payments",
  authorizeRoles("PATIENT"),
  paymentController.getMyPayments
);

// Payment details (authorized for patient owner, associated doctor/pharmacy, or admin)
router.get("/:id", paymentController.getPaymentById);

// Patient payment cancellation
router.post(
  "/:id/cancel",
  authorizeRoles("PATIENT"),
  paymentController.cancelPayment
);

// Admin-only refund
router.post(
  "/:id/refund",
  authorizeRoles("ADMIN"),
  paymentController.refundPayment
);

module.exports = router;
