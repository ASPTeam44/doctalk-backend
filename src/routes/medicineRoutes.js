const express = require("express");
const router = express.Router();

const {
  searchMedicines,
  getMedicineById,
} = require("../controllers/medicineController");

// Public medicine catalog routes
router.get("/search", searchMedicines);
router.get("/:id", getMedicineById);

module.exports = router;
