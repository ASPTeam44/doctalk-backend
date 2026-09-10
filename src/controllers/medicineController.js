const prisma = require("../config/prisma");

// GET /api/medicine/search (Public)
const searchMedicines = async (req, res, next) => {
  try {
    const {
      name,
      genericName,
      brandName,
      dosageForm,
      page = 1,
      limit = 20,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = {
      active: true,
    };

    if (name && typeof name === "string" && name.trim()) {
      where.name = {
        contains: name.trim(),
        mode: "insensitive",
      };
    }

    if (genericName && typeof genericName === "string" && genericName.trim()) {
      where.genericName = {
        contains: genericName.trim(),
        mode: "insensitive",
      };
    }

    if (brandName && typeof brandName === "string" && brandName.trim()) {
      where.brandName = {
        contains: brandName.trim(),
        mode: "insensitive",
      };
    }

    if (dosageForm && typeof dosageForm === "string" && dosageForm.trim()) {
      where.dosageForm = {
        equals: dosageForm.trim().toUpperCase(),
      };
    }

    const [total, medicines] = await Promise.all([
      prisma.medicine.count({ where }),
      prisma.medicine.findMany({
        where,
        skip,
        take: limitNum,
        orderBy: { name: "asc" },
      }),
    ]);

    res.status(200).json({
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
      medicines,
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/medicine/:id (Public)
const getMedicineById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const medicine = await prisma.medicine.findFirst({
      where: {
        id,
        active: true,
      },
    });

    if (!medicine) {
      return res.status(404).json({ message: "Medicine not found or inactive" });
    }

    res.status(200).json({ medicine });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  searchMedicines,
  getMedicineById,
};
