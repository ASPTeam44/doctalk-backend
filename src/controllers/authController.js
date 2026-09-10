const prisma = require("../config/prisma");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_ROLES = ["PATIENT", "DOCTOR", "PHARMACY", "ADMIN"];

// Helper to return only safe user fields without password hash
const toSafeUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  phone: user.phone,
  role: user.role,
  createdAt: user.createdAt,
});

// REGISTER USER
const registerUser = async (req, res, next) => {
  try {
    const { name, email, phone, password, role } = req.body;

    // Validate required fields and formats
    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        message: "Name is required",
      });
    }

    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email.trim())) {
      return res.status(400).json({
        message: "A valid email address is required",
      });
    }

    if (!phone || typeof phone !== "string" || !phone.trim() || phone.trim().length < 7) {
      return res.status(400).json({
        message: "A valid phone number is required",
      });
    }

    if (!password || typeof password !== "string") {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    if (!role || typeof role !== "string") {
      return res.status(400).json({
        message: "Role is required",
      });
    }

    const normalizedRole = role.trim().toUpperCase();

    if (!ALLOWED_ROLES.includes(normalizedRole)) {
      return res.status(400).json({
        message: "Invalid role specified",
      });
    }

    // Never allow self-registration as ADMIN
    if (normalizedRole === "ADMIN") {
      return res.status(403).json({
        message: "Registration as ADMIN is not permitted",
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();

    // Check existing user
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ email: cleanEmail }, { phone: cleanPhone }],
      },
    });

    if (existingUser) {
      return res.status(400).json({
        message: "User already exists with this email or phone",
      });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        phone: cleanPhone,
        password: hashedPassword,
        role: normalizedRole,
      },
    });

    res.status(201).json({
      message: "User registered successfully",
      user: toSafeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

// LOGIN USER
const loginUser = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || typeof email !== "string" || !email.trim()) {
      return res.status(400).json({
        message: "Email is required",
      });
    }

    if (!password || typeof password !== "string") {
      return res.status(400).json({
        message: "Password is required",
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check user
    const user = await prisma.user.findUnique({
      where: {
        email: cleanEmail,
      },
    });

    if (!user) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Invalid credentials",
      });
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error("[Configuration Error]: JWT_SECRET is not configured on the server");
      return res.status(500).json({
        message: "Server authentication configuration error",
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
      },
      jwtSecret,
      {
        expiresIn: "7d",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: toSafeUser(user),
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  registerUser,
  loginUser,
};