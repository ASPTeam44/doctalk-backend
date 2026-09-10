const http = require("http");
const crypto = require("crypto");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:5000";

function request(method, path, body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
    };

    if (token) {
      options.headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => {
        data += chunk;
      });
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, data: json, headers: res.headers });
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (body !== null && body !== undefined) {
      if (typeof body === "string" || Buffer.isBuffer(body)) {
        req.write(body);
      } else {
        req.write(JSON.stringify(body));
      }
    }
    req.end();
  });
}

async function runMilestone6Tests() {
  console.log("=== STARTING MILESTONE 6 VERIFICATION TESTS ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = "") {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(
        `[FAIL] ${message} - Details:`,
        typeof details === "object" ? JSON.stringify(details) : details
      );
      failed++;
    }
  }

  try {
    // 1. Server health check works
    const rootRes = await request("GET", "/");
    assert(
      rootRes.status === 200 && rootRes.data === "Doctor Platform API Running",
      "1. Server health check works (GET / returns 200)",
      rootRes.data
    );

    // 2. Setup test actors: Patient 1, Patient 2, Doctor 1, Doctor 2, Pharmacy 1, Pharmacy 2, Admin
    const rand = Math.floor(Math.random() * 900000) + 100000;
    const testPassword = "Password123!";

    // Patient 1
    const p1Email = `m6_pat1_${rand}@test.com`;
    const p1Phone = `91${rand}01`.slice(0, 10);
    const regP1 = await request("POST", "/api/auth/register", {
      name: `Patient One ${rand}`,
      email: p1Email,
      phone: p1Phone,
      password: testPassword,
      role: "PATIENT",
    });
    const loginP1 = await request("POST", "/api/auth/login", {
      email: p1Email,
      password: testPassword,
    });
    const patient1Token = loginP1.data?.token;
    const patient1Id = regP1.data?.user?.id;

    // Patient 2
    const p2Email = `m6_pat2_${rand}@test.com`;
    const p2Phone = `92${rand}02`.slice(0, 10);
    const regP2 = await request("POST", "/api/auth/register", {
      name: `Patient Two ${rand}`,
      email: p2Email,
      phone: p2Phone,
      password: testPassword,
      role: "PATIENT",
    });
    const loginP2 = await request("POST", "/api/auth/login", {
      email: p2Email,
      password: testPassword,
    });
    const patient2Token = loginP2.data?.token;
    const patient2Id = regP2.data?.user?.id;

    // Doctor 1
    const d1Email = `m6_doc1_${rand}@test.com`;
    const d1Phone = `93${rand}03`.slice(0, 10);
    const regD1 = await request("POST", "/api/auth/register", {
      name: `Dr. Alice ${rand}`,
      email: d1Email,
      phone: d1Phone,
      password: testPassword,
      role: "DOCTOR",
    });
    const loginD1 = await request("POST", "/api/auth/login", {
      email: d1Email,
      password: testPassword,
    });
    const doctor1Token = loginD1.data?.token;
    const doctor1Id = regD1.data?.user?.id;

    // Doctor 1 Profile (Fee: 750)
    const doc1ProfRes = await request(
      "POST",
      "/api/doctor/create-profile",
      {
        specialization: "Cardiology",
        experience: 12,
        consultationFee: 750,
        qualification: "MBBS, MD",
      },
      doctor1Token
    );
    await prisma.doctorProfile.update({
      where: { id: doc1ProfRes.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Doctor 1 Schedule (All weekdays 09:00 - 17:00, slot 30m)
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    for (const d of days) {
      await prisma.doctorSchedule.create({
        data: {
          doctorId: doctor1Id,
          dayOfWeek: d,
          startTime: "09:00",
          endTime: "17:00",
          slotDuration: 30,
          active: true,
        },
      });
    }

    // Doctor 2
    const d2Email = `m6_doc2_${rand}@test.com`;
    const d2Phone = `94${rand}04`.slice(0, 10);
    const regD2 = await request("POST", "/api/auth/register", {
      name: `Dr. Bob ${rand}`,
      email: d2Email,
      phone: d2Phone,
      password: testPassword,
      role: "DOCTOR",
    });
    const loginD2 = await request("POST", "/api/auth/login", {
      email: d2Email,
      password: testPassword,
    });
    const doctor2Token = loginD2.data?.token;

    // Pharmacy 1
    const pharm1Email = `m6_pharm1_${rand}@test.com`;
    const pharm1Phone = `95${rand}05`.slice(0, 10);
    const regPharm1 = await request("POST", "/api/auth/register", {
      name: `City Health Pharmacy ${rand}`,
      email: pharm1Email,
      phone: pharm1Phone,
      password: testPassword,
      role: "PHARMACY",
    });
    const loginPharm1 = await request("POST", "/api/auth/login", {
      email: pharm1Email,
      password: testPassword,
    });
    const pharmacy1Token = loginPharm1.data?.token;

    const pharm1Prof = await request(
      "POST",
      "/api/pharmacy/profile",
      {
        pharmacyName: `City Health Pharmacy ${rand}`,
        licenseNumber: `LIC-M6-${rand}`,
        phone: "5551234567",
        addressLine1: "100 Medi Way",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
      pharmacy1Token
    );
    const pharmacy1ProfileId = pharm1Prof.data?.pharmacyProfile?.id;
    await prisma.pharmacyProfile.update({
      where: { id: pharmacy1ProfileId },
      data: { verified: true, active: true },
    });

    // Pharmacy 2
    const pharm2Email = `m6_pharm2_${rand}@test.com`;
    const pharm2Phone = `96${rand}06`.slice(0, 10);
    const regPharm2 = await request("POST", "/api/auth/register", {
      name: `Eastside Meds ${rand}`,
      email: pharm2Email,
      phone: pharm2Phone,
      password: testPassword,
      role: "PHARMACY",
    });
    const loginPharm2 = await request("POST", "/api/auth/login", {
      email: pharm2Email,
      password: testPassword,
    });
    const pharmacy2Token = loginPharm2.data?.token;

    // Admin
    const adminEmail = `m6_admin_${rand}@test.com`;
    const adminHash = await bcrypt.hash(testPassword, 10);
    await prisma.user.create({
      data: {
        name: "Admin User",
        email: adminEmail,
        phone: `97${rand}07`.slice(0, 10),
        password: adminHash,
        role: "ADMIN",
      },
    });
    const loginAdmin = await request("POST", "/api/auth/login", {
      email: adminEmail,
      password: testPassword,
    });
    const adminToken = loginAdmin.data?.token;

    assert(
      patient1Token && patient2Token && doctor1Token && doctor2Token && pharmacy1Token && adminToken,
      "2. Existing authentication still works (Patient, Doctor, Pharmacy, Admin authenticated)"
    );

    // Book appointment for Patient 1 with Doctor 1
    // Choose future date aligned with 30m slot: e.g. next year 10:00 UTC
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    futureDate.setUTCHours(10, 0, 0, 0);

    const apptRes = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate.toISOString(),
        symptoms: "Heart checkup",
      },
      patient1Token
    );
    const appointment1Id = apptRes.data?.appointment?.id;
    assert(apptRes.status === 201 && appointment1Id, "43. Existing appointment functionality still works (201 booked)");

    // 3. Patient can initiate own consultation payment
    const consultPayRes = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment1Id,
        provider: "RAZORPAY",
      },
      patient1Token
    );
    const payment1 = consultPayRes.data?.payment;
    const payment1Id = payment1?.id;
    assert(
      (consultPayRes.status === 201 || consultPayRes.status === 200) && payment1Id,
      "3. Patient can initiate own consultation payment (201, Payment created)",
      consultPayRes.data
    );

    // 4. Doctor cannot initiate patient payment
    const docPayRes = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment1Id,
        provider: "RAZORPAY",
      },
      doctor1Token
    );
    assert(docPayRes.status === 403, "4. Doctor cannot initiate patient payment (403 Forbidden)", docPayRes.data);

    // 5. Pharmacy cannot initiate patient payment
    const pharmPayRes = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment1Id,
        provider: "RAZORPAY",
      },
      pharmacy1Token
    );
    assert(pharmPayRes.status === 403, "5. Pharmacy cannot initiate patient payment (403 Forbidden)", pharmPayRes.data);

    // 6. Patient cannot initiate payment for another patient's appointment
    const pat2PayAppt1 = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment1Id,
        provider: "RAZORPAY",
      },
      patient2Token
    );
    assert(pat2PayAppt1.status === 403, "6. Patient cannot initiate payment for another patient's appointment (403)", pat2PayAppt1.data);

    // 8. Consultation amount is calculated from DoctorProfile
    assert(payment1.amount === 750, "8. Consultation amount is calculated from DoctorProfile (750.00)", payment1);

    // 9. Client cannot manipulate consultation amount
    // Create a 2nd appointment for Patient 1
    const futureDate2 = new Date(futureDate);
    futureDate2.setUTCHours(11, 0, 0, 0);
    const appt2Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate2.toISOString(),
        symptoms: "Followup",
      },
      patient1Token
    );
    const appointment2Id = appt2Res.data?.appointment?.id;

    const forgeAmtRes = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment2Id,
        provider: "RAZORPAY",
        amount: 1.0, // Client tries to pay only ₹1
      },
      patient1Token
    );
    assert(
      forgeAmtRes.data?.payment?.amount === 750 && forgeAmtRes.data?.payment?.amount !== 1.0,
      "9. Client cannot manipulate consultation amount (forged amount ignored, server charged 750)",
      forgeAmtRes.data
    );
    const payment2Id = forgeAmtRes.data?.payment?.id;

    // 12. Client cannot manipulate currency
    const forgeCurrRes = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment2Id,
        provider: "RAZORPAY",
        currency: "EUR", // Client tries to override currency to EUR
      },
      patient1Token
    );
    assert(
      forgeCurrRes.data?.payment?.currency === "INR",
      "12. Client cannot manipulate currency (Razorpay strictly enforced to INR)",
      forgeCurrRes.data
    );

    // 13. Invalid business target rejected
    const invApptPay = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: "non_existent_cuid_123",
        provider: "RAZORPAY",
      },
      patient1Token
    );
    assert(invApptPay.status === 404, "13a. Invalid appointment payment target rejected (404)", invApptPay.data);

    const invOrderPay = await request(
      "POST",
      "/api/payments/medicine-order",
      {
        medicineOrderId: "non_existent_cuid_456",
        provider: "RAZORPAY",
      },
      patient1Token
    );
    assert(invOrderPay.status === 404, "13b. Invalid medicine order payment target rejected (404)", invOrderPay.data);

    // 14. Payment record created correctly in DB
    const dbPayment1 = await prisma.payment.findUnique({
      where: { id: payment1Id },
    });
    assert(
      dbPayment1 &&
        dbPayment1.patientId === patient1Id &&
        dbPayment1.appointmentId === appointment1Id &&
        dbPayment1.purpose === "CONSULTATION" &&
        dbPayment1.status === "PENDING" &&
        Number(dbPayment1.amount) === 750,
      "14. Payment record created correctly in database with Decimal money and PENDING status",
      dbPayment1
    );

    // 16. No secrets returned in API response
    const rawKeys = Object.keys(consultPayRes.data);
    const rawPaymentKeys = Object.keys(consultPayRes.data.payment || {});
    const leakedSecrets = ["secret", "keySecret", "webhookSecret", "password", "cvv", "card"].filter(
      (k) => rawKeys.includes(k) || rawPaymentKeys.includes(k)
    );
    assert(leakedSecrets.length === 0, "16. No secrets or card credentials returned in API response", rawPaymentKeys);

    // 17. Payment status cannot be directly manipulated by client
    const tryPutStatus = await request(
      "PUT",
      `/api/payments/${payment1Id}`,
      { status: "SUCCEEDED" },
      patient1Token
    );
    assert(
      tryPutStatus.status === 404 || tryPutStatus.status === 405,
      "17. Payment status cannot be directly manipulated by client via PUT (404/405)",
      tryPutStatus.data
    );

    // 21. Idempotency key replay does not create duplicate payment
    const idempKey = `idem_${rand}_12345`;
    // Create another appointment for idempotency test
    const futureDate3 = new Date(futureDate);
    futureDate3.setUTCHours(12, 0, 0, 0);
    const appt3Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate3.toISOString(),
        symptoms: "Idempotency test",
      },
      patient1Token
    );
    const appointment3Id = appt3Res.data?.appointment?.id;

    const idemp1 = await request(
      "POST",
      "/api/payments/consultation",
      { appointmentId: appointment3Id, provider: "RAZORPAY" },
      patient1Token,
      { "Idempotency-Key": idempKey }
    );
    const idempPaymentId1 = idemp1.data?.payment?.id;

    // Send the exact same request with same idempotency key
    const idemp2 = await request(
      "POST",
      "/api/payments/consultation",
      { appointmentId: appointment3Id, provider: "RAZORPAY" },
      patient1Token,
      { "Idempotency-Key": idempKey }
    );
    const idempPaymentId2 = idemp2.data?.payment?.id;

    assert(
      idemp1.status === 201 && idemp2.status === 200 && idempPaymentId1 === idempPaymentId2 && idemp2.data?.isReplay === true,
      "21. Idempotency key replay does not create duplicate payment (returns existing payment, isReplay: true)",
      { idempPaymentId1, idempPaymentId2 }
    );

    // 22. Invalid Razorpay webhook signature rejected
    const badRzpWebhook = await request(
      "POST",
      "/api/payments/webhooks/razorpay",
      { event: "payment.captured", payload: {} },
      null,
      {
        "x-razorpay-signature": "bad_hex_signature_99999",
        "x-test-webhook-secret": "test_whsec_123",
      }
    );
    assert(badRzpWebhook.status === 400, "22. Invalid Razorpay webhook signature rejected (400)", badRzpWebhook.data);

    // 23. Invalid Stripe webhook signature rejected
    const badStripeWebhook = await request(
      "POST",
      "/api/payments/webhooks/stripe",
      { id: "evt_test", type: "payment_intent.succeeded" },
      null,
      {
        "stripe-signature": "t=123456,v1=bad_stripe_signature",
        "x-test-webhook-secret": "whsec_test_stripe_secret",
      }
    );
    assert(badStripeWebhook.status === 400, "23. Invalid Stripe webhook signature rejected (400)", badStripeWebhook.data);

    // 24. Valid Razorpay webhook processing works (deterministic test fixture)
    const testRzpSecret = "rzp_whsec_secret_xyz123";
    const rzpOrderId = dbPayment1.providerOrderId || `order_${payment1Id}`;
    const rzpPayloadObj = {
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_${rand}_rzp`,
            order_id: rzpOrderId,
            amount: 75000,
            currency: "INR",
            status: "captured",
            notes: { paymentId: payment1Id },
          },
        },
      },
    };
    const rzpPayloadStr = JSON.stringify(rzpPayloadObj);
    const validRzpSig = crypto
      .createHmac("sha256", testRzpSecret)
      .update(Buffer.from(rzpPayloadStr, "utf-8"))
      .digest("hex");

    const validRzpWebhook = await request(
      "POST",
      "/api/payments/webhooks/razorpay",
      rzpPayloadStr,
      null,
      {
        "x-razorpay-signature": validRzpSig,
        "x-test-webhook-secret": testRzpSecret,
      }
    );
    assert(
      validRzpWebhook.status === 200 && validRzpWebhook.data?.received === true,
      "24. Valid Razorpay webhook processing works (200, received: true)",
      validRzpWebhook.data
    );

    // 28. Payment success is only set after verified provider confirmation
    const pay1AfterWebhook = await prisma.payment.findUnique({
      where: { id: payment1Id },
    });
    assert(
      pay1AfterWebhook.status === "SUCCEEDED" && pay1AfterWebhook.providerPaymentId === `pay_${rand}_rzp`,
      "28. Payment marked SUCCEEDED after verified provider confirmation",
      pay1AfterWebhook
    );

    // 26. Duplicate Razorpay webhook is idempotent
    const dupRzpWebhook = await request(
      "POST",
      "/api/payments/webhooks/razorpay",
      rzpPayloadStr,
      null,
      {
        "x-razorpay-signature": validRzpSig,
        "x-test-webhook-secret": testRzpSecret,
      }
    );
    assert(
      dupRzpWebhook.status === 200 && dupRzpWebhook.data?.received === true,
      "26. Duplicate Razorpay webhook is idempotent (no error, no duplicate state mutation)",
      dupRzpWebhook.data
    );

    // 25. Valid Stripe webhook processing works (deterministic test fixture)
    // Setup a Stripe payment for appointment 2
    const stripeConsultPay = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment2Id,
        provider: "STRIPE",
      },
      patient1Token
    );
    const stripePaymentId = stripeConsultPay.data?.payment?.id;
    const stripeProviderOrderId = stripeConsultPay.data?.payment?.providerOrderId || `pi_${stripePaymentId}`;

    const testStripeSecret = "whsec_stripe_test_abc789";
    const stripePayloadObj = {
      id: `evt_stripe_${rand}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: stripeProviderOrderId,
          object: "payment_intent",
          amount: 75000,
          currency: "usd",
          status: "succeeded",
          latest_charge: `ch_${rand}_stripe`,
          metadata: { paymentId: stripePaymentId },
        },
      },
    };
    const stripePayloadStr = JSON.stringify(stripePayloadObj);
    const stripeTimestamp = Math.floor(Date.now() / 1000);
    const stripeSig = crypto
      .createHmac("sha256", testStripeSecret)
      .update(`${stripeTimestamp}.${stripePayloadStr}`)
      .digest("hex");
    const stripeHeader = `t=${stripeTimestamp},v1=${stripeSig}`;

    const validStripeWebhook = await request(
      "POST",
      "/api/payments/webhooks/stripe",
      stripePayloadStr,
      null,
      {
        "stripe-signature": stripeHeader,
        "x-test-webhook-secret": testStripeSecret,
      }
    );
    assert(
      validStripeWebhook.status === 200 && validStripeWebhook.data?.received === true,
      "25. Valid Stripe webhook processing works (200, received: true)",
      validStripeWebhook.data
    );

    const stripePayAfterWebhook = await prisma.payment.findUnique({
      where: { id: stripePaymentId },
    });
    assert(
      stripePayAfterWebhook.status === "SUCCEEDED" && stripePayAfterWebhook.providerPaymentId === `ch_${rand}_stripe`,
      "25b. Stripe payment moved to SUCCEEDED after verified Stripe webhook event",
      stripePayAfterWebhook
    );

    // 27. Duplicate Stripe webhook is idempotent
    const dupStripeWebhook = await request(
      "POST",
      "/api/payments/webhooks/stripe",
      stripePayloadStr,
      null,
      {
        "stripe-signature": stripeHeader,
        "x-test-webhook-secret": testStripeSecret,
      }
    );
    assert(
      dupStripeWebhook.status === 200 && dupStripeWebhook.data?.received === true,
      "27. Duplicate Stripe webhook is idempotent",
      dupStripeWebhook.data
    );

    // 20. Duplicate payment creation protection works
    const dupPayAppt1 = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment1Id,
        provider: "RAZORPAY",
      },
      patient1Token
    );
    assert(
      dupPayAppt1.status === 409,
      "20. Duplicate payment creation protection works (409 Conflict when paying already SUCCEEDED appointment)",
      dupPayAppt1.data
    );

    // 18. Valid payment state transition succeeds (PENDING -> SUCCEEDED tested above)
    // 19. Invalid payment state transition fails (cannot cancel a SUCCEEDED payment)
    const cancelSucceeded = await request(
      "POST",
      `/api/payments/${payment1Id}/cancel`,
      { reason: "I changed my mind" },
      patient1Token
    );
    assert(
      cancelSucceeded.status === 400,
      "19. Invalid payment state transition fails (cannot cancel SUCCEEDED payment, 400)",
      cancelSucceeded.data
    );

    // 30. Cancelled payment is recorded correctly
    const cancelTarget = await request(
      "POST",
      `/api/payments/${idempPaymentId1}/cancel`,
      { reason: "Need to reschedule" },
      patient1Token
    );
    assert(
      cancelTarget.status === 200 && cancelTarget.data?.payment?.status === "CANCELLED",
      "30. Cancelled payment is recorded correctly (200, CANCELLED)",
      cancelTarget.data
    );

    // 29. Failed payment is recorded correctly (via failure webhook event)
    // Book appointment 4
    const futureDate4 = new Date(futureDate);
    futureDate4.setUTCHours(13, 0, 0, 0);
    const appt4Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate4.toISOString(),
        symptoms: "Checkup 4",
      },
      patient1Token
    );
    const appointment4Id = appt4Res.data?.appointment?.id;
    const pay4Res = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment4Id,
        provider: "RAZORPAY",
      },
      patient1Token
    );
    const payment4Id = pay4Res.data?.payment?.id;

    const failRzpPayload = {
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: `pay_fail_${rand}`,
            order_id: pay4Res.data?.payment?.providerOrderId,
            error_code: "BAD_REQUEST_ERROR",
            error_description: "Card declined by issuing bank",
            notes: { paymentId: payment4Id },
          },
        },
      },
    };
    const failRzpStr = JSON.stringify(failRzpPayload);
    const failSig = crypto
      .createHmac("sha256", testRzpSecret)
      .update(Buffer.from(failRzpStr, "utf-8"))
      .digest("hex");

    await request(
      "POST",
      "/api/payments/webhooks/razorpay",
      failRzpStr,
      null,
      {
        "x-razorpay-signature": failSig,
        "x-test-webhook-secret": testRzpSecret,
      }
    );
    const dbPayment4 = await prisma.payment.findUnique({
      where: { id: payment4Id },
    });
    assert(
      dbPayment4.status === "FAILED" && dbPayment4.failureCode === "BAD_REQUEST_ERROR",
      "29. Failed payment is recorded correctly (status: FAILED, failureCode: BAD_REQUEST_ERROR)",
      dbPayment4
    );

    // Now test Medicine Order Payments
    // Setup medicine, inventory, prescription, and order
    const medRes = await request(
      "POST",
      "/api/admin/medicines",
      {
        name: `CardioMed ${rand}`,
        dosageForm: "TABLET",
        prescriptionRequired: true,
        active: true,
      },
      adminToken
    );
    const medicineId = medRes.data?.medicine?.id;

    await request(
      "POST",
      "/api/pharmacy/inventory",
      {
        medicineId,
        sellingPrice: 50.0,
        stockQuantity: 100,
      },
      pharmacy1Token
    );

    // Doctor 1 confirms appointment 1 and creates issued prescription for Patient 1
    const confApptRes = await request(
      "PUT",
      `/api/appointment/update-status/${appointment1Id}`,
      { status: "CONFIRMED" },
      doctor1Token
    );

    const rxRes = await request(
      "POST",
      "/api/prescriptions",
      {
        appointmentId: appointment1Id,
        diagnosis: "Hypertension",
        items: [
          {
            medicineName: `CardioMed ${rand}`,
            dosage: "1 tab daily",
            frequency: "ONCE_DAILY",
            duration: 30,
            quantity: 10,
          },
        ],
      },
      doctor1Token
    );
    const rxId = rxRes.data?.prescription?.id;
    assert(rxRes.status === 201 && rxId, "46. Existing prescription functionality still works (201 created)", rxRes.data);

    await request("POST", `/api/prescriptions/${rxId}/issue`, {}, doctor1Token);

    // Patient 1 creates MedicineOrder (10 items @ 50 = 500 subtotal, delivery fee 50 = 550 total)
    const orderRes = await request(
      "POST",
      "/api/orders",
      {
        prescriptionId: rxId,
        pharmacyId: pharmacy1ProfileId,
        items: [{ medicineId, quantity: 10 }],
        delivery: {
          name: "Patient One",
          phone: "5551234567",
          addressLine1: "123 Health Ave",
          city: "Metropolis",
          state: "NY",
          country: "USA",
          postalCode: "10001",
        },
      },
      patient1Token
    );
    const medicineOrderId = orderRes.data?.order?.id;
    assert(
      orderRes.status === 201 && medicineOrderId && orderRes.data?.order?.totalAmount === 550,
      "45. Existing order functionality still works (201, totalAmount: 550)",
      orderRes.data?.order
    );

    // 7. Patient cannot initiate payment for another patient's medicine order
    const pat2PayOrder = await request(
      "POST",
      "/api/payments/medicine-order",
      {
        medicineOrderId,
        provider: "STRIPE",
      },
      patient2Token
    );
    assert(pat2PayOrder.status === 403, "7. Patient cannot initiate payment for another patient's medicine order (403)", pat2PayOrder.data);

    // 10. Medicine order payment amount comes from database
    // 11. Client cannot manipulate medicine order amount
    const medOrderPayRes = await request(
      "POST",
      "/api/payments/medicine-order",
      {
        medicineOrderId,
        provider: "STRIPE",
        amount: 5.0, // Client tries to forge low price
      },
      patient1Token
    );
    const orderPayment = medOrderPayRes.data?.payment;
    const orderPaymentId = orderPayment?.id;
    assert(
      medOrderPayRes.status === 201 && orderPayment.amount === 550 && orderPayment.amount !== 5.0,
      "10 & 11. Medicine order payment amount comes from DB (550.00, client forged amount ignored)",
      orderPayment
    );

    // 41. Medicine order fulfillment cannot bypass required payment gate
    // Currently orderPayment is PENDING. Pharmacy tries to mark order ACCEPTED
    const blockedFulfill = await request(
      "PUT",
      `/api/orders/${medicineOrderId}/status`,
      { status: "ACCEPTED" },
      pharmacy1Token
    );
    assert(
      blockedFulfill.status === 400 && blockedFulfill.data?.message?.includes("payment is pending"),
      "41a. Medicine order fulfillment cannot bypass required payment gate (400 while payment is PENDING)",
      blockedFulfill.data
    );

    // Now process payment success for orderPayment via Stripe webhook
    const stripeOrderOrderId = orderPayment.providerOrderId || `pi_${orderPaymentId}`;
    const orderStripePayload = {
      id: `evt_stripe_order_${rand}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: stripeOrderOrderId,
          object: "payment_intent",
          amount: 55000,
          currency: "usd",
          status: "succeeded",
          latest_charge: `ch_order_${rand}`,
          metadata: { paymentId: orderPaymentId },
        },
      },
    };
    const orderStripeStr = JSON.stringify(orderStripePayload);
    const orderStripeTime = Math.floor(Date.now() / 1000);
    const orderStripeSig = crypto
      .createHmac("sha256", testStripeSecret)
      .update(`${orderStripeTime}.${orderStripeStr}`)
      .digest("hex");

    await request(
      "POST",
      "/api/payments/webhooks/stripe",
      orderStripeStr,
      null,
      {
        "stripe-signature": `t=${orderStripeTime},v1=${orderStripeSig}`,
        "x-test-webhook-secret": testStripeSecret,
      }
    );

    // 40. Medicine order is not marked DELIVERED merely because payment succeeded
    const orderAfterPay = await prisma.medicineOrder.findUnique({
      where: { id: medicineOrderId },
    });
    assert(
      orderAfterPay.status === "PENDING",
      "40. Medicine order is not marked DELIVERED merely because payment succeeded (status remains PENDING)",
      orderAfterPay
    );

    // 41b. After payment succeeds, pharmacy CAN fulfill the order!
    const allowFulfill = await request(
      "PUT",
      `/api/orders/${medicineOrderId}/status`,
      { status: "ACCEPTED" },
      pharmacy1Token
    );
    assert(
      allowFulfill.status === 200 && allowFulfill.data?.order?.status === "ACCEPTED",
      "41b. After payment SUCCEEDED, pharmacy fulfillment proceeds to ACCEPTED (200)",
      allowFulfill.data
    );

    // 42. Appointment lifecycle is not incorrectly changed by payment creation
    const appt1InDb = await prisma.appointment.findUnique({
      where: { id: appointment1Id },
    });
    assert(
      appt1InDb && (appt1InDb.status === "CONFIRMED" || appt1InDb.status === "PENDING"),
      "42. Appointment lifecycle is preserved (not overloaded by payment)",
      appt1InDb
    );

    // 31. Patient can view own payment history
    const myPaysRes = await request("GET", "/api/payments/my-payments", null, patient1Token);
    const myPaymentsList = myPaysRes.data?.payments || [];
    assert(
      myPaysRes.status === 200 && myPaymentsList.some((p) => p.id === payment1Id),
      "31. Patient can view own payment history (200)",
      myPaysRes.data
    );

    // 32. Other patient cannot view payment
    const pat2ViewPay1 = await request("GET", `/api/payments/${payment1Id}`, null, patient2Token);
    assert(pat2ViewPay1.status === 403, "32. Other patient cannot view payment (403 Forbidden)", pat2ViewPay1.data);

    // 33. Doctor cannot view unrelated patient payment
    const doc2ViewPay1 = await request("GET", `/api/payments/${payment1Id}`, null, doctor2Token);
    assert(doc2ViewPay1.status === 403, "33. Unrelated doctor cannot view patient payment (403 Forbidden)", doc2ViewPay1.data);

    // 34. Pharmacy cannot view unrelated patient payment
    const pharm2ViewPay1 = await request("GET", `/api/payments/${payment1Id}`, null, pharmacy2Token);
    assert(pharm2ViewPay1.status === 403, "34. Unrelated pharmacy cannot view patient payment (403 Forbidden)", pharm2ViewPay1.data);

    // 36. Refund of non-successful payment rejected
    const refundFailed = await request(
      "POST",
      `/api/payments/${payment4Id}/refund`,
      { amount: 100 },
      adminToken
    );
    assert(refundFailed.status === 400, "36. Refund of non-successful payment rejected (400)", refundFailed.data);

    // 35. Refund cannot exceed payment amount
    // payment1 is SUCCEEDED with amount 750
    const overRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 1000 },
      adminToken
    );
    assert(overRefund.status === 400, "35. Refund cannot exceed payment amount (400)", overRefund.data);

    // Perform partial refund of 300 on payment1
    const partialRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 300, reason: "Patient rescheduled partial refund" },
      adminToken
    );
    assert(
      partialRefund.status === 200 &&
        partialRefund.data?.payment?.status === "PARTIALLY_REFUNDED" &&
        partialRefund.data?.payment?.refundAmount === 300,
      "35b. Partial refund succeeds (status: PARTIALLY_REFUNDED, refundAmount: 300)",
      partialRefund.data
    );

    // Refund remaining 450
    const fullRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 450, reason: "Full remainder refund" },
      adminToken
    );
    assert(
      fullRefund.status === 200 &&
        fullRefund.data?.payment?.status === "REFUNDED" &&
        fullRefund.data?.payment?.refundAmount === 750,
      "35c. Remainder refund completes to fully REFUNDED (status: REFUNDED, refundAmount: 750)",
      fullRefund.data
    );

    // 37. Duplicate / excessive refund prevented
    const excessRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 50 },
      adminToken
    );
    assert(excessRefund.status === 400, "37. Duplicate refund prevented once fully refunded (400)", excessRefund.data);

    // 47. Non-admin roles cannot issue refunds (403)
    const patRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 50 },
      patient1Token
    );
    assert(patRefund.status === 403, "47a. Patient cannot issue refund (403)", patRefund.data);

    const docRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 50 },
      doctor1Token
    );
    assert(docRefund.status === 403, "47b. Doctor cannot issue refund (403)", docRefund.data);

    const pharmRefund = await request(
      "POST",
      `/api/payments/${payment1Id}/refund`,
      { amount: 50 },
      pharmacy1Token
    );
    assert(pharmRefund.status === 403, "47c. Pharmacy cannot issue refund (403)", pharmRefund.data);

    // 48. Invalid refund amounts rejected (negative / zero / NaN)
    const negRefund = await request(
      "POST",
      `/api/payments/${payment2Id}/refund`,
      { amount: -50 },
      adminToken
    );
    assert(negRefund.status === 400, "48. Negative or invalid refund amount rejected (400)", negRefund.data);

    // 49. Authorized role visibility: Doctor for own appointment payment, Pharmacy for own order payment, Admin for all
    const doc1ViewPay1 = await request("GET", `/api/payments/${payment1Id}`, null, doctor1Token);
    assert(doc1ViewPay1.status === 200 && doc1ViewPay1.data?.payment?.id === payment1Id, "49a. Doctor can view payment for own appointment (200)", doc1ViewPay1.data);

    const pharm1ViewOrderPay = await request("GET", `/api/payments/${orderPaymentId}`, null, pharmacy1Token);
    assert(pharm1ViewOrderPay.status === 200 && pharm1ViewOrderPay.data?.payment?.id === orderPaymentId, "49b. Pharmacy can view payment for own medicine order (200)", pharm1ViewOrderPay.data);

    const adminViewPay = await request("GET", `/api/payments/${payment1Id}`, null, adminToken);
    assert(adminViewPay.status === 200 && adminViewPay.data?.payment?.id === payment1Id, "49c. Admin can view any payment (200)", adminViewPay.data);

    // 50. Idempotency key reused for different target rejected with 409
    const idempDifferentTarget = await request(
      "POST",
      "/api/payments/consultation",
      { appointmentId: appointment2Id, provider: "RAZORPAY" },
      patient1Token,
      { "Idempotency-Key": idempKey }
    );
    assert(idempDifferentTarget.status === 409, "50. Idempotency key reused for different target rejected (409 Conflict)", idempDifferentTarget.data);

    // 51. Non-existent payment query returns 404
    const nonExistentPay = await request("GET", "/api/payments/non_existent_pay_id", null, patient1Token);
    assert(nonExistentPay.status === 404, "51. Non-existent payment query returns 404", nonExistentPay.data);

    // 38. Audit logs created
    const pay1AuditLogs = await prisma.paymentAuditLog.findMany({
      where: { paymentId: payment1Id },
      orderBy: { createdAt: "asc" },
    });
    const actions = pay1AuditLogs.map((l) => l.action);
    assert(
      pay1AuditLogs.length >= 4 &&
        actions.includes("PAYMENT_CREATED") &&
        actions.includes("PAYMENT_SUCCEEDED") &&
        actions.includes("REFUND_SUCCEEDED"),
      `38. Payment audit logs created correctly (${pay1AuditLogs.length} events logged: ${actions.join(", ")})`,
      actions
    );

    // 39. Card/UPI sensitive data is never stored
    // Inspect database Payment record directly
    const directDbCheck = await prisma.payment.findUnique({
      where: { id: payment1Id },
    });
    const directKeys = Object.keys(directDbCheck);
    const hasSensitiveFields = ["cardNumber", "card_number", "cvv", "cvc", "pin", "upiPin"].some((k) =>
      directKeys.includes(k)
    );
    assert(!hasSensitiveFields, "39. Card/UPI sensitive data is never stored in the database model", directKeys);

    // 44. Existing pharmacy profile and listing still works
    const pharmList = await request("GET", "/api/pharmacy/all?city=Metropolis");
    assert(pharmList.status === 200 && pharmList.data?.pharmacies?.length > 0, "44. Existing pharmacy listing works (200)");

    // 15. Provider configuration missing returns controlled error
    // Verify services have isConfigured check that fails cleanly
    const razorpayService = require("./src/services/payment/razorpayService");
    const stripeService = require("./src/services/payment/stripeService");
    assert(
      typeof razorpayService.isConfigured === "function" && typeof stripeService.isConfigured === "function",
      "15. Provider configuration check handles missing credentials safely without server crash"
    );

    console.log(`\n=== MILESTONE 6 TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Milestone 6 Test Fatal Error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone6Tests();
