const express = require("express");
const router = express.Router();

const {
  authMiddleware,
  authorizeRoles,
} = require("../middleware/authMiddleware");

const {
  createProfile,
  getMyProfile,
  updateMyProfile,
  getPublicPharmacies,
  getPublicPharmacyById,
  addInventoryItem,
  getMyInventory,
  updateInventoryItem,
  deleteInventoryItem,
} = require("../controllers/pharmacyController");

// Public endpoints
router.get("/all", getPublicPharmacies);

// Protected PHARMACY profile endpoints
router.post("/profile", authMiddleware, authorizeRoles("PHARMACY"), createProfile);
router.get("/profile/me", authMiddleware, authorizeRoles("PHARMACY"), getMyProfile);
router.put("/profile/me", authMiddleware, authorizeRoles("PHARMACY"), updateMyProfile);

// Protected PHARMACY inventory endpoints
router.post("/inventory", authMiddleware, authorizeRoles("PHARMACY"), addInventoryItem);
router.get("/inventory", authMiddleware, authorizeRoles("PHARMACY"), getMyInventory);
router.put("/inventory/:id", authMiddleware, authorizeRoles("PHARMACY"), updateInventoryItem);
router.delete("/inventory/:id", authMiddleware, authorizeRoles("PHARMACY"), deleteInventoryItem);

// Public single pharmacy endpoint (placed after specific paths)
router.get("/:id", getPublicPharmacyById);

module.exports = router;
