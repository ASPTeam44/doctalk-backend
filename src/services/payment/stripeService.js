let StripeModule;
try {
  StripeModule = require("stripe");
} catch (err) {
  StripeModule = null;
}

const getCredentials = () => {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  return {
    secretKey: secretKey && secretKey.trim() ? secretKey.trim() : null,
    webhookSecret: webhookSecret && webhookSecret.trim() ? webhookSecret.trim() : null,
  };
};

const isConfigured = () => {
  const { secretKey } = getCredentials();
  return Boolean(secretKey && StripeModule);
};

const getInstance = () => {
  const { secretKey } = getCredentials();
  if (!secretKey) {
    const error = new Error("Stripe payment provider is not configured on the server");
    error.statusCode = 503;
    throw error;
  }
  if (!StripeModule) {
    const error = new Error("Stripe SDK is not available");
    error.statusCode = 503;
    throw error;
  }
  return StripeModule(secretKey);
};

/**
 * Creates a Stripe PaymentIntent.
 * Amount is passed in main currency unit (e.g. USD 50.00) and converted to cents.
 */
const createPaymentIntent = async ({ amount, currency = "usd", metadata = {} }) => {
  const stripe = getInstance();

  const numAmount = Number(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    const error = new Error("Invalid payment amount");
    error.statusCode = 400;
    throw error;
  }

  // Convert to cents (smallest unit for USD)
  const amountInCents = Math.round(numAmount * 100);

  const paymentIntent = await stripe.paymentIntents.create({
    amount: amountInCents,
    currency: currency.toLowerCase(),
    metadata,
    automatic_payment_methods: {
      enabled: true,
    },
  });

  return {
    providerOrderId: paymentIntent.id,
    clientSecret: paymentIntent.client_secret,
    amount: paymentIntent.amount,
    currency: paymentIntent.currency,
    status: paymentIntent.status,
  };
};

/**
 * Constructs and verifies a Stripe webhook event using the official SDK.
 */
const constructWebhookEvent = ({ rawBody, signature, customSecret = null }) => {
  const { webhookSecret: envSecret } = getCredentials();
  const secret = customSecret || envSecret;

  if (!secret) {
    const error = new Error("Stripe webhook secret is not configured");
    error.statusCode = 503;
    throw error;
  }

  if (!signature || !rawBody) {
    const error = new Error("Missing Stripe signature or payload");
    error.statusCode = 400;
    throw error;
  }

  const stripe = StripeModule ? (getCredentials().secretKey ? getInstance() : StripeModule("dummy_key_for_webhook_verify")) : null;
  if (!stripe) {
    const error = new Error("Stripe SDK is not available");
    error.statusCode = 503;
    throw error;
  }

  // Stripe SDK requires raw body as Buffer or string
  const payload = Buffer.isBuffer(rawBody) ? rawBody : (typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody));

  try {
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    const error = new Error(`Stripe webhook signature verification failed: ${err.message}`);
    error.statusCode = 400;
    throw error;
  }
};

/**
 * Initiates a refund through Stripe.
 */
const createRefund = async ({ providerPaymentId, amount, reason = "requested_by_customer" }) => {
  const stripe = getInstance();

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

  const amountInCents = Math.round(numAmount * 100);

  const refundOptions = {
    amount: amountInCents,
  };

  // Provider payment id could be a PaymentIntent id (pi_xxx) or Charge id (ch_xxx)
  if (providerPaymentId.startsWith("pi_")) {
    refundOptions.payment_intent = providerPaymentId;
  } else {
    refundOptions.charge = providerPaymentId;
  }

  if (reason) {
    refundOptions.reason = reason;
  }

  const refund = await stripe.refunds.create(refundOptions);

  return {
    refundId: refund.id,
    providerPaymentId: refund.payment_intent || refund.charge,
    amount: refund.amount,
    currency: refund.currency,
    status: refund.status,
  };
};

module.exports = {
  isConfigured,
  createPaymentIntent,
  constructWebhookEvent,
  createRefund,
};
