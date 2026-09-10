const prisma = require("../config/prisma");

/**
 * Log access or lifecycle actions on medical reports for healthcare compliance auditing.
 * Never logs sensitive authentication secrets, file contents, or signed URLs.
 */
const logReportAction = async ({
  reportId,
  userId,
  action,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    if (!reportId || !userId || !action) {
      return;
    }

    await prisma.reportAuditLog.create({
      data: {
        reportId,
        userId,
        action,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      },
    });
  } catch (error) {
    // Audit logging should not crash primary operations, but should be logged on server
    console.error("[Audit Logging Error]:", error.message);
  }
};

const logPrescriptionAction = async ({
  prescriptionId,
  userId,
  action,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    if (!prescriptionId || !userId || !action) {
      return;
    }

    await prisma.prescriptionAuditLog.create({
      data: {
        prescriptionId,
        userId,
        action,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      },
    });
  } catch (error) {
    console.error("[Prescription Audit Error]:", error.message);
  }
};

const logPharmacyAction = async ({
  pharmacyId,
  userId,
  action,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    if (!pharmacyId || !userId || !action) {
      return;
    }

    await prisma.pharmacyAuditLog.create({
      data: {
        pharmacyId,
        userId,
        action,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      },
    });
  } catch (error) {
    console.error("[Pharmacy Audit Error]:", error.message);
  }
};

const logOrderAction = async ({
  orderId,
  userId,
  action,
  ipAddress = null,
  userAgent = null,
}) => {
  try {
    if (!orderId || !userId || !action) {
      return;
    }

    await prisma.orderAuditLog.create({
      data: {
        orderId,
        userId,
        action,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
      },
    });
  } catch (error) {
    console.error("[Order Audit Error]:", error.message);
  }
};

const logPaymentAction = async ({
  paymentId,
  userId = null,
  action,
  ipAddress = null,
  userAgent = null,
  metadata = null,
}) => {
  try {
    if (!paymentId || !action) {
      return;
    }

    await prisma.paymentAuditLog.create({
      data: {
        paymentId,
        userId: userId || null,
        action,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    console.error("[Payment Audit Error]:", error.message);
  }
};

const logChatAction = async ({
  conversationId = null,
  messageId = null,
  userId = null,
  action,
  ipAddress = null,
  userAgent = null,
  metadata = null,
}) => {
  try {
    if (!action) {
      return;
    }

    await prisma.chatAuditLog.create({
      data: {
        conversationId: conversationId || null,
        messageId: messageId || null,
        userId: userId || null,
        action,
        ipAddress: ipAddress ? String(ipAddress).slice(0, 100) : null,
        userAgent: userAgent ? String(userAgent).slice(0, 255) : null,
        metadata: metadata || null,
      },
    });
  } catch (error) {
    console.error("[Chat Audit Error]:", error.message);
  }
};

module.exports = {
  logReportAction,
  logPrescriptionAction,
  logPharmacyAction,
  logOrderAction,
  logPaymentAction,
  logChatAction,
};

