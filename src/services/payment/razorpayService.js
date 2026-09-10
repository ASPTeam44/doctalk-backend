const crypto = require("crypto");
let Razorpay;
try {
  Razorpay = require("razorpay");
} catch (err) {
  Razorpay = null;
}

const getCredentials = () => {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;

  return {
    keyId: keyId && keyId.trim() ? keyId.trim() : null,
    keySecret: keySecret && keySecret.trim() ? keySecret.trim() : null,
    webhookSecret: webhookSecret && webhookSecret.trim() ? webhookSecret.trim() : null,
  };
};

const isConfigured = () => {
  const { keyId, keySecret } = getCredentials();
  return Boolean(keyId && keySecret && Razorpay);
};

const getInstance = () => {
  const { keyId, keySecret } = getCredentials();
  if (!keyId || !keySecret) {
    const error = new Error("Razorpay payment provider is not configured on the server");
    error.statusCode = 503;
    throw error;
  }
  if (!Razorpay) {
    const error = new Error("Razorpay SDK is not available");
    error.statusCode = 503;
    throw error;
  }
  return new Razorpay({
    key_id: keyId,
    key_secret: keySecret,
  });
};

/**
 * Creates a Razorpay order.
 * Amount is passed in main currency unit (e.g. INR 500.00) and converted to paise.
 */
const createOrder = async ({ amount, currency = "INR", receipt, notes = {} }) => {
  const instance = getInstance();

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    const error = new Error("Invalid payment amount");
    error.statusCode = 400;
    throw error;
  }

  // Convert to paise (smallest currency unit for INR)
  const amountInPaise = Math.round(numAmount * 100);

  const options = {
    amount: amountInPaise,
    currency: currency.toUpperCase(),
    receipt: receipt ? String(receipt).slice(0, 40) : undefined,
    notes,
  };

  const order = await instance.orders.create(options);

  return {
    providerOrderId: order.id,
    amount: order.amount,
    currency: order.currency,
    receipt: order.receipt,
    status: order.status,
  };
};

/**
 * Verifies the Razorpay webhook signature using HMAC-SHA256.
 * Timing-safe comparison prevents timing attacks.
 */
const verifyWebhookSignature = ({ rawBody, signature, customSecret = null }) => {
  const { webhookSecret: envSecret } = getCredentials();
  const secret = customSecret || envSecret;

  if (!secret) {
    const error = new Error("Razorpay webhook secret is not configured");
    error.statusCode = 503;
    throw error;
  }

  if (!signature || !rawBody) {
    return false;
  }

  try {
    const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody), "utf-8");
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(payload)
      .digest("hex");

    const expectedBuffer = Buffer.from(expectedSignature, "utf-8");
    const signatureBuffer = Buffer.from(signature, "utf-8");

    if (expectedBuffer.length !== signatureBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
  } catch (err) {
    return false;
  }
};

/**
 * Initiates a refund through Razorpay.
 */
const createRefund = async ({ providerPaymentId, amount, notes = {} }) => {
  const instance = getInstance();

  if (!providerPaymentId) {
    const error = new Error("Provider payment ID is required for refund");
    error.statusCode = 400;
    throw error;
  }

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    const error = new Error("Invalid refund amount");
    error.statusCode = 400;
    throw error;
  }

  const amountInPaise = Math.round(numAmount * 100);

  const refund = await instance.payments.refund(providerPaymentId, {
    amount: amountInPaise,
    notes,
  });

  return {
    refundId: refund.id,
    providerPaymentId: refund.payment_id,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
  };
};

module.exports = {
  isConfigured,
  createOrder,
  verifyWebhookSignature,
  createRefund,
};
