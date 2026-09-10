// 404 Handler for unknown routes
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    message: `Route ${req.method} ${req.originalUrl} not found`,
  });
};

// Centralized Error Handler
const errorHandler = (err, req, res, next) => {
  // Log error details on server side during development/non-production
  if (process.env.NODE_ENV !== "production") {
    console.error(`[Error] ${req.method} ${req.originalUrl}:`, err);
  }

  let statusCode = err.statusCode || err.status || 500;
  let message = err.message || "Internal Server Error";

  // Handle known Prisma errors cleanly without exposing internals
  if (err.code === "P2002") {
    statusCode = 409;
    const target = Array.isArray(err.meta?.target)
      ? err.meta.target.join(", ")
      : "field";
    message = `A record with this ${target} already exists.`;
  } else if (err.code === "P2025") {
    statusCode = 404;
    message = "Requested record was not found.";
  } else if (err.code === "P2003") {
    statusCode = 400;
    message = "Invalid reference to related entity.";
  }

  // Handle JWT errors if passed to next(err)
  if (err.name === "JsonWebTokenError") {
    statusCode = 401;
    message = "Invalid token";
  } else if (err.name === "TokenExpiredError") {
    statusCode = 401;
    message = "Token expired";
  }

  // In production, ensure no unhandled 500 leaks internal details
  if (statusCode === 500 && process.env.NODE_ENV === "production") {
    message = "Internal Server Error";
  }

  res.status(statusCode).json({
    message,
  });
};

module.exports = {
  notFoundHandler,
  errorHandler,
};
