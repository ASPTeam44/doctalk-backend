const express = require("express");
const router = express.Router();

const {
  authMiddleware,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  createOrder,
  getMyOrders,
  getPharmacyOrders,
  getOrderById,
  updateOrderStatus,
  cancelOrder,
} = require("../controllers/orderController");

// Patient creates prescription-based order
router.post("/", authMiddleware, authorizeRoles("PATIENT"), createOrder);

// Patient views own order history
router.get("/my-orders", authMiddleware, authorizeRoles("PATIENT"), getMyOrders);

// Pharmacy views incoming orders
router.get("/pharmacy", authMiddleware, authorizeRoles("PHARMACY"), getPharmacyOrders);

// Pharmacy updates order status (fulfill or reject)
router.put("/:id/status", authMiddleware, authorizeRoles("PHARMACY"), updateOrderStatus);

// Patient cancels pending order
router.put("/:id/cancel", authMiddleware, authorizeRoles("PATIENT"), cancelOrder);

// Get single order (Patient or Pharmacy with ownership check)
router.get("/:id", authMiddleware, getOrderById);

module.exports = router;
