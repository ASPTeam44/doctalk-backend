const http = require("http");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const prisma = new PrismaClient();
const BASE_URL = "http://localhost:5000";

function request(method, path, body = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
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

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function setupAdminUser() {
  const adminEmail = "platform_admin@doctalk.com";
  let admin = await prisma.user.findUnique({ where: { email: adminEmail } });
  if (!admin) {
    const hashedPassword = await bcrypt.hash("AdminSecurePass123!", 10);
    admin = await prisma.user.create({
      data: {
        name: "Platform Administrator",
        email: adminEmail,
        phone: "9900000000",
        password: hashedPassword,
        role: "ADMIN",
      },
    });
  }
  const token = jwt.sign({ id: admin.id, role: admin.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  return { admin, token };
}

async function runMilestone2Tests() {
  console.log("=== STARTING MILESTONE 2 VERIFICATION TESTS ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = "") {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} - Details:`, typeof details === "object" ? JSON.stringify(details) : details);
      failed++;
    }
  }

  try {
    const { admin, token: adminToken } = await setupAdminUser();

    // 1. Existing server starts and health check works
    const rootRes = await request("GET", "/");
    assert(rootRes.status === 200 && rootRes.data === "Doctor Platform API Running", "1. Existing server starts & GET / works", rootRes.data);

    // 2. Authentication still works
    const rand = Math.floor(Math.random() * 1000000);
    const patientEmail = `m2_patient_${rand}@test.com`;
    const patientPhone = `95${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const patientPassword = "PatientPass123!";

    const regPatRes = await request("POST", "/api/auth/register", {
      name: `Patient M2 ${rand}`,
      email: patientEmail,
      phone: patientPhone,
      password: patientPassword,
      role: "PATIENT",
    });
    assert(regPatRes.status === 201, "2. Patient registration works", regPatRes.data);

    const loginPatRes = await request("POST", "/api/auth/login", {
      email: patientEmail,
      password: patientPassword,
    });
    const patientToken = loginPatRes.data?.token;
    assert(loginPatRes.status === 200 && patientToken, "2b. Patient login works", loginPatRes.data);

    // Register Doctor 1
    const doctorRand = Math.floor(Math.random() * 1000000);
    const doctorEmail = `m2_doctor_${doctorRand}@test.com`;
    const doctorPhone = `94${doctorRand.toString().padStart(8, "0")}`.slice(0, 10);
    const doctorPassword = "DoctorPass123!";

    const regDocRes = await request("POST", "/api/auth/register", {
      name: `Dr. Smith M2 ${doctorRand}`,
      email: doctorEmail,
      phone: doctorPhone,
      password: doctorPassword,
      role: "DOCTOR",
    });
    const docLoginRes = await request("POST", "/api/auth/login", {
      email: doctorEmail,
      password: doctorPassword,
    });
    const doctorToken = docLoginRes.data?.token;
    const doctorId = regDocRes.data?.user?.id;

    // Create Doctor 1 Profile
    const createDocProfileRes = await request("POST", "/api/doctor/create-profile", {
      specialization: "Cardiology",
      experience: 12,
      consultationFee: 600,
      qualification: "MD, DM Cardiology",
      hospitalName: "Metro Heart Care",
      timezone: "UTC",
    }, doctorToken);
    const doctorProfileId = createDocProfileRes.data?.doctorProfile?.id;
    assert(createDocProfileRes.status === 201 && createDocProfileRes.data?.doctorProfile?.verified === false, "Doctor profile created with verified = false", createDocProfileRes.data);

    // 3. Patient cannot access admin verification endpoints
    const patAdminRes = await request("GET", "/api/admin/doctors/pending", null, patientToken);
    assert(patAdminRes.status === 403, "3. Patient cannot access admin verification endpoints (403)", patAdminRes.data);

    // 4. Doctor cannot access admin verification endpoints
    const docAdminRes = await request("GET", "/api/admin/doctors/pending", null, doctorToken);
    assert(docAdminRes.status === 403, "4. Doctor cannot access admin verification endpoints (403)", docAdminRes.data);

    // 5. Admin can access admin verification endpoints
    const adminPendingRes = await request("GET", "/api/admin/doctors/pending", null, adminToken);
    assert(adminPendingRes.status === 200 && Array.isArray(adminPendingRes.data?.doctors), "5. Admin can access admin verification endpoints (200)", adminPendingRes.data);

    // 6. Unverified doctor is not returned by public doctor listing
    const publicDocsUnverified = await request("GET", "/api/doctor/all");
    const foundUnverified = publicDocsUnverified.data?.doctors?.some((d) => d.id === doctorProfileId);
    assert(!foundUnverified, "6. Unverified doctor is NOT returned by public doctor listing", publicDocsUnverified.data);

    // 7. Admin verifies doctor
    const verifyRes = await request("PUT", `/api/admin/doctors/${doctorProfileId}/verify`, {}, adminToken);
    assert(verifyRes.status === 200 && verifyRes.data?.doctorProfile?.verified === true, "7. Admin verifies doctor (200, verified: true)", verifyRes.data);

    // 8. Verified doctor appears in public listing with pagination
    const publicDocsVerified = await request("GET", `/api/doctor/all?name=${encodeURIComponent(`Dr. Smith M2 ${doctorRand}`)}`);
    const foundVerified = publicDocsVerified.data?.doctors?.some((d) => d.id === doctorProfileId);
    assert(foundVerified && publicDocsVerified.data?.pagination?.total >= 1, "8. Verified doctor appears in public listing with pagination", publicDocsVerified.data);

    // 9. Doctor can create schedule
    const createScheduleRes = await request("POST", "/api/doctor/schedule", {
      dayOfWeek: "FRIDAY",
      startTime: "09:00",
      endTime: "12:00",
      slotDuration: 30,
      active: true,
    }, doctorToken);
    const scheduleId = createScheduleRes.data?.schedule?.id;
    assert(createScheduleRes.status === 201 && createScheduleRes.data?.schedule?.dayOfWeek === "FRIDAY", "9. Doctor can create schedule (201)", createScheduleRes.data);

    // 10. Patient cannot create schedule
    const patScheduleRes = await request("POST", "/api/doctor/schedule", {
      dayOfWeek: "MONDAY",
      startTime: "09:00",
      endTime: "12:00",
      slotDuration: 30,
    }, patientToken);
    assert(patScheduleRes.status === 403, "10. Patient cannot create schedule (403)", patScheduleRes.data);

    // 11. Doctor can view own schedule
    const viewScheduleRes = await request("GET", "/api/doctor/schedule", null, doctorToken);
    assert(viewScheduleRes.status === 200 && viewScheduleRes.data?.schedules?.length >= 1, "11. Doctor can view own schedule (200)", viewScheduleRes.data);

    // Register Doctor 2
    const doc2Rand = Math.floor(Math.random() * 1000000);
    const regDoc2Res = await request("POST", "/api/auth/register", {
      name: `Dr. Other ${doc2Rand}`,
      email: `m2_dr2_${doc2Rand}@test.com`,
      phone: `93${doc2Rand.toString().padStart(8, "0")}`.slice(0, 10),
      password: "DoctorPass123!",
      role: "DOCTOR",
    });
    const doc2LoginRes = await request("POST", "/api/auth/login", {
      email: `m2_dr2_${doc2Rand}@test.com`,
      password: "DoctorPass123!",
    });
    const doctor2Token = doc2LoginRes.data?.token;

    // 12. Doctor cannot modify another doctor's schedule
    const doc2ModSchedule = await request("PUT", `/api/doctor/schedule/${scheduleId}`, {
      startTime: "10:00",
    }, doctor2Token);
    assert(doc2ModSchedule.status === 403, "12. Doctor cannot modify another doctor's schedule (403)", doc2ModSchedule.data);

    // 13. Available slots endpoint works
    // Find next upcoming Friday
    const now = new Date();
    const daysUntilFriday = (5 - now.getUTCDay() + 7) % 7 || 7;
    const targetFriday = new Date(now.getTime() + daysUntilFriday * 86400000);
    const targetDateStr = targetFriday.toISOString().slice(0, 10);

    const slotsRes = await request("GET", `/api/doctor/${doctorId}/available-slots?date=${targetDateStr}`);
    assert(slotsRes.status === 200 && slotsRes.data?.slots?.length === 6, "13. Available slots endpoint returns generated slots (6 slots for 9-12 with 30m)", slotsRes.data);

    // 14. Past date is rejected
    const pastSlotsRes = await request("GET", `/api/doctor/${doctorId}/available-slots?date=2020-01-01`);
    assert(pastSlotsRes.status === 400 && pastSlotsRes.data?.message?.includes("past"), "14. Past date is rejected (400)", pastSlotsRes.data);

    // 15. Invalid date format is rejected
    const badDateSlotsRes = await request("GET", `/api/doctor/${doctorId}/available-slots?date=2026-02-31`);
    assert(badDateSlotsRes.status === 400, "15. Invalid calendar date is rejected (400)", badDateSlotsRes.data);

    // 16. Appointment outside availability is rejected (e.g. at 03:00 on Friday)
    const badTimeRes = await request("POST", "/api/appointment/book", {
      doctorId,
      appointmentDate: `${targetDateStr}T03:00:00.000Z`,
      symptoms: "Late night headache",
    }, patientToken);
    assert(badTimeRes.status === 400 && badTimeRes.data?.message?.includes("working hours"), "16. Appointment outside availability is rejected (400)", badTimeRes.data);

    // 17. Appointment with unverified doctor is rejected
    const unverifiedDocRand = Math.floor(Math.random() * 1000000);
    const regUnverifiedDoc = await request("POST", "/api/auth/register", {
      name: `Dr. Unverified ${unverifiedDocRand}`,
      email: `unverified_${unverifiedDocRand}@test.com`,
      phone: `92${unverifiedDocRand.toString().padStart(8, "0")}`.slice(0, 10),
      password: "DoctorPass123!",
      role: "DOCTOR",
    });
    const unverifiedDocLogin = await request("POST", "/api/auth/login", {
      email: `unverified_${unverifiedDocRand}@test.com`,
      password: "DoctorPass123!",
    });
    await request("POST", "/api/doctor/create-profile", {
      specialization: "Dermatology",
      experience: 5,
      consultationFee: 400,
      qualification: "MD",
    }, unverifiedDocLogin.data?.token);

    const bookUnverifiedRes = await request("POST", "/api/appointment/book", {
      doctorId: regUnverifiedDoc.data?.user?.id,
      appointmentDate: `${targetDateStr}T09:00:00.000Z`,
      symptoms: "Skin rash",
    }, patientToken);
    assert(bookUnverifiedRes.status === 400 && bookUnverifiedRes.data?.message?.includes("not verified"), "17. Appointment with unverified doctor is rejected (400)", bookUnverifiedRes.data);

    // 18. Valid appointment can be booked
    const validBookingDate = `${targetDateStr}T09:30:00.000Z`;
    const bookRes = await request("POST", "/api/appointment/book", {
      doctorId,
      appointmentDate: validBookingDate,
      symptoms: "Routine cardiac checkup",
    }, patientToken);
    const appointmentId = bookRes.data?.appointment?.id;
    assert(bookRes.status === 201 && bookRes.data?.appointment?.status === "PENDING", "18. Valid appointment can be booked (201, PENDING)", bookRes.data);

    // Check that available-slots now shows 09:30 slot as available: false
    const updatedSlotsRes = await request("GET", `/api/doctor/${doctorId}/available-slots?date=${targetDateStr}`);
    const slot930 = updatedSlotsRes.data?.slots?.find((s) => s.start === "09:30");
    assert(slot930 && slot930.available === false, "18b. Booked slot is marked available = false in slots API", slot930);

    // 19. Duplicate exact-time booking is prevented
    const dupBookRes = await request("POST", "/api/appointment/book", {
      doctorId,
      appointmentDate: validBookingDate,
      symptoms: "Trying to take same slot",
    }, patientToken);
    assert(dupBookRes.status === 409 && dupBookRes.data?.message?.includes("already booked"), "19. Duplicate exact-time booking is prevented with 409 Conflict", dupBookRes.data);

    // 20. Existing appointment status authorization still works
    // Doctor confirms appointment
    const confirmRes = await request("PUT", `/api/appointment/update-status/${appointmentId}`, {
      status: "CONFIRMED",
    }, doctorToken);
    assert(confirmRes.status === 200 && confirmRes.data?.appointment?.status === "CONFIRMED", "20. Doctor can confirm appointment (200, CONFIRMED)", confirmRes.data);

    // Patient cannot confirm or complete
    const patientConfirmRes = await request("PUT", `/api/appointment/update-status/${appointmentId}`, {
      status: "COMPLETED",
    }, patientToken);
    assert(patientConfirmRes.status === 403, "20b. Patient cannot confirm or complete appointment (403)", patientConfirmRes.data);

    // Doctor completes appointment
    const completeRes = await request("PUT", `/api/appointment/update-status/${appointmentId}`, {
      status: "COMPLETED",
    }, doctorToken);
    assert(completeRes.status === 200 && completeRes.data?.appointment?.status === "COMPLETED", "20c. Doctor can complete appointment (200, COMPLETED)", completeRes.data);

    // 21. Invalid status transitions are rejected (COMPLETED -> PENDING)
    const invalidTransRes = await request("PUT", `/api/appointment/update-status/${appointmentId}`, {
      status: "PENDING",
    }, doctorToken);
    assert(invalidTransRes.status === 400 && invalidTransRes.data?.message?.includes("Invalid appointment status transition"), "21. Invalid status transition (COMPLETED -> PENDING) rejected (400)", invalidTransRes.data);

    // Patient cancels their own appointment test: Book another slot and cancel
    const validBookingDate2 = `${targetDateStr}T10:00:00.000Z`;
    const bookRes2 = await request("POST", "/api/appointment/book", {
      doctorId,
      appointmentDate: validBookingDate2,
      symptoms: "Followup",
    }, patientToken);
    const apt2Id = bookRes2.data?.appointment?.id;

    const patientCancelRes = await request("PUT", `/api/appointment/update-status/${apt2Id}`, {
      status: "CANCELLED",
    }, patientToken);
    assert(patientCancelRes.status === 200 && patientCancelRes.data?.appointment?.status === "CANCELLED", "21b. Patient can cancel own appointment (200, CANCELLED)", patientCancelRes.data);

    // 22. Existing appointment APIs still work
    const patListRes = await request("GET", "/api/appointment/my-appointments", null, patientToken);
    assert(patListRes.status === 200 && Array.isArray(patListRes.data?.appointments), "22. GET /api/appointment/my-appointments still works", patListRes.data);

    const docListRes = await request("GET", "/api/appointment/doctor-appointments", null, doctorToken);
    assert(docListRes.status === 200 && Array.isArray(docListRes.data?.appointments), "22b. GET /api/appointment/doctor-appointments still works", docListRes.data);

    console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Test execution failed:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone2Tests();
