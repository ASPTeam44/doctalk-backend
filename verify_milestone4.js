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

async function runMilestone4Tests() {
  console.log("=== STARTING MILESTONE 4 VERIFICATION TESTS ===");
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
    // 1. Server starts and GET / works
    const rootRes = await request("GET", "/");
    assert(rootRes.status === 200 && rootRes.data === "Doctor Platform API Running", "1. Server starts and GET / works", rootRes.data);

    // 2. Existing authentication works
    const rand = Math.floor(Math.random() * 1000000);
    const patientPassword = "Password123!";

    // Patient 1
    const pat1Email = `m4_patient1_${rand}@test.com`;
    const pat1Phone = `71${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPat1 = await request("POST", "/api/auth/register", {
      name: `Patient One ${rand}`,
      email: pat1Email,
      phone: pat1Phone,
      password: patientPassword,
      role: "PATIENT",
    });
    const loginPat1 = await request("POST", "/api/auth/login", {
      email: pat1Email,
      password: patientPassword,
    });
    const patient1Token = loginPat1.data?.token;
    const patient1Id = regPat1.data?.user?.id;
    assert(regPat1.status === 201 && patient1Token, "2. Authentication works (Patient 1 registered & logged in)", regPat1.data);

    // Patient 2 (for unauthorized access check)
    const pat2Email = `m4_patient2_${rand}@test.com`;
    const pat2Phone = `72${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPat2 = await request("POST", "/api/auth/register", {
      name: `Patient Two ${rand}`,
      email: pat2Email,
      phone: pat2Phone,
      password: patientPassword,
      role: "PATIENT",
    });
    const loginPat2 = await request("POST", "/api/auth/login", {
      email: pat2Email,
      password: patientPassword,
    });
    const patient2Token = loginPat2.data?.token;

    // Doctor 1 (Verified Doctor)
    const doc1Email = `m4_doc1_${rand}@test.com`;
    const doc1Phone = `73${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regDoc1 = await request("POST", "/api/auth/register", {
      name: `Dr. Verified ${rand}`,
      email: doc1Email,
      phone: doc1Phone,
      password: patientPassword,
      role: "DOCTOR",
    });
    const loginDoc1 = await request("POST", "/api/auth/login", {
      email: doc1Email,
      password: patientPassword,
    });
    const doctor1Token = loginDoc1.data?.token;
    const doctor1Id = regDoc1.data?.user?.id;

    // Create and verify Doctor 1 profile
    const doc1Profile = await request("POST", "/api/doctor/create-profile", {
      specialization: "Pulmonology",
      experience: 15,
      consultationFee: 700,
      qualification: "MD, FCCP",
      hospitalName: "Chest & Care Hospital",
    }, doctor1Token);

    // Direct DB verification for test speed
    await prisma.doctorProfile.update({
      where: { id: doc1Profile.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Create schedule for Doctor 1 (MONDAY-SUNDAY)
    await request("POST", "/api/doctor/schedule", {
      dayOfWeek: "MONDAY",
      startTime: "09:00",
      endTime: "18:00",
      slotDuration: 30,
    }, doctor1Token);

    // Doctor 2 (Unverified Doctor)
    const doc2Email = `m4_doc2_${rand}@test.com`;
    const doc2Phone = `74${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regDoc2 = await request("POST", "/api/auth/register", {
      name: `Dr. Unverified ${rand}`,
      email: doc2Email,
      phone: doc2Phone,
      password: patientPassword,
      role: "DOCTOR",
    });
    const loginDoc2 = await request("POST", "/api/auth/login", {
      email: doc2Email,
      password: patientPassword,
    });
    const doctor2Token = loginDoc2.data?.token;

    await request("POST", "/api/doctor/create-profile", {
      specialization: "General Practice",
      experience: 2,
      consultationFee: 300,
      qualification: "MBBS",
    }, doctor2Token);
    // Left unverified (verified = false)

    // Doctor 3 (Another Verified Doctor for cross-doctor checks)
    const doc3Email = `m4_doc3_${rand}@test.com`;
    const doc3Phone = `75${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regDoc3 = await request("POST", "/api/auth/register", {
      name: `Dr. Third ${rand}`,
      email: doc3Email,
      phone: doc3Phone,
      password: patientPassword,
      role: "DOCTOR",
    });
    const loginDoc3 = await request("POST", "/api/auth/login", {
      email: doc3Email,
      password: patientPassword,
    });
    const doctor3Token = loginDoc3.data?.token;
    const doc3Profile = await request("POST", "/api/doctor/create-profile", {
      specialization: "Cardiology",
      experience: 8,
      consultationFee: 600,
      qualification: "MD",
    }, doctor3Token);
    await prisma.doctorProfile.update({
      where: { id: doc3Profile.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Create a CONFIRMED appointment between Patient 1 and Doctor 1
    const appointmentConfirmed = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor1Id,
        appointmentDate: new Date(Date.now() + 86400000 * 3), // 3 days in future
        symptoms: "Persistent dry cough",
        status: "CONFIRMED",
      },
    });

    // Create a PENDING appointment
    const appointmentPending = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor1Id,
        appointmentDate: new Date(Date.now() + 86400000 * 4),
        symptoms: "Fatigue",
        status: "PENDING",
      },
    });

    // Create a CANCELLED appointment
    const appointmentCancelled = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor1Id,
        appointmentDate: new Date(Date.now() + 86400000 * 5),
        symptoms: "Fever",
        status: "CANCELLED",
      },
    });

    const sampleItems = [
      {
        medicineName: "Amoxicillin",
        strength: "500mg",
        dosage: "1 capsule",
        frequency: "3 times daily",
        duration: 7,
        durationUnit: "DAYS",
        route: "ORAL",
        instructions: "Take with food",
        quantity: 21,
      },
      {
        medicineName: "Salbutamol Inhaler",
        strength: "100mcg",
        dosage: "2 puffs",
        frequency: "Every 4 to 6 hours as needed",
        duration: 14,
        durationUnit: "DAYS",
        route: "INHALATION",
        instructions: "Rinse mouth after use",
        quantity: 1,
      },
    ];

    // 3. Patient cannot create prescription
    const patCreateRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentConfirmed.id,
      diagnosis: "Acute Bronchitis",
      items: sampleItems,
    }, patient1Token);
    assert(patCreateRes.status === 403, "3. Patient cannot create prescription (403)", patCreateRes.data);

    // 4. Unverified doctor cannot create prescription
    const unverifiedCreateRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentConfirmed.id,
      diagnosis: "Acute Bronchitis",
      items: sampleItems,
    }, doctor2Token);
    assert(unverifiedCreateRes.status === 400 && unverifiedCreateRes.data?.message?.includes("verified"), "4. Unverified doctor cannot create prescription (400)", unverifiedCreateRes.data);

    // 5. Doctor cannot create prescription for another doctor's appointment
    const doc3CreateRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentConfirmed.id,
      diagnosis: "Acute Bronchitis",
      items: sampleItems,
    }, doctor3Token);
    assert(doc3CreateRes.status === 403 && doc3CreateRes.data?.message?.includes("own appointments"), "5. Doctor cannot create prescription for another doctor's appointment (403)", doc3CreateRes.data);

    // 7. Prescription cannot be created for PENDING appointment
    const pendingPrescRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentPending.id,
      diagnosis: "Acute Bronchitis",
      items: sampleItems,
    }, doctor1Token);
    assert(pendingPrescRes.status === 400 && pendingPrescRes.data?.message?.includes("CONFIRMED or COMPLETED"), "7. Prescription cannot be created for PENDING appointment (400)", pendingPrescRes.data);

    // 8. Prescription cannot be created for CANCELLED appointment
    const cancelledPrescRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentCancelled.id,
      diagnosis: "Acute Bronchitis",
      items: sampleItems,
    }, doctor1Token);
    assert(cancelledPrescRes.status === 400 && cancelledPrescRes.data?.message?.includes("CONFIRMED or COMPLETED"), "8. Prescription cannot be created for CANCELLED appointment (400)", cancelledPrescRes.data);

    // 9, 10. Valid prescription created atomically for CONFIRMED appointment
    const createPrescRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentConfirmed.id,
      diagnosis: "Acute Bronchitis with wheezing",
      clinicalNotes: "Patient presents with persistent cough for 4 days.",
      instructions: "Drink plenty of warm fluids and rest.",
      status: "DRAFT",
      items: sampleItems,
    }, doctor1Token);

    assert(createPrescRes.status === 201, "9. Prescription can be created for valid CONFIRMED appointment (201)", createPrescRes.data);
    const prescription1 = createPrescRes.data?.prescription;
    const prescriptionId = prescription1?.id;
    assert(prescription1 && prescription1.status === "DRAFT", "Prescription initial status is DRAFT", prescription1);
    assert(prescription1?.items?.length === 2 && prescription1?.patientId === patient1Id, "10. Prescription items created atomically with correct patientId", prescription1?.items);

    // 11. Missing medicine fields rejected
    const missingMedRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentConfirmed.id,
      diagnosis: "Test",
      items: [{ medicineName: "TestMed" }], // missing dosage, frequency, duration, quantity
    }, doctor1Token);
    assert(missingMedRes.status === 400 && missingMedRes.data?.message?.includes("dosage"), "11. Missing medicine fields rejected (400)", missingMedRes.data);

    // 12. Invalid quantity / duration rejected
    const invalidQtyRes = await request("POST", "/api/prescriptions", {
      appointmentId: appointmentConfirmed.id,
      diagnosis: "Test",
      items: [{
        medicineName: "TestMed",
        dosage: "1 tab",
        frequency: "Daily",
        duration: -5,
        quantity: 0,
      }],
    }, doctor1Token);
    assert(invalidQtyRes.status === 400 && invalidQtyRes.data?.message?.includes("duration"), "12. Invalid duration/quantity rejected (400)", invalidQtyRes.data);

    // 13. Doctor can update DRAFT prescription
    const updateRes = await request("PUT", `/api/prescriptions/${prescriptionId}`, {
      diagnosis: "Acute Bronchitis (Updated)",
      items: [
        {
          medicineName: "Amoxicillin Clavulanate",
          strength: "625mg",
          dosage: "1 tablet",
          frequency: "Twice daily",
          duration: 5,
          durationUnit: "DAYS",
          route: "ORAL",
          instructions: "With breakfast and dinner",
          quantity: 10,
        },
      ],
    }, doctor1Token);
    assert(updateRes.status === 200 && updateRes.data?.prescription?.diagnosis === "Acute Bronchitis (Updated)" && updateRes.data?.prescription?.items?.length === 1, "13. Doctor can update DRAFT prescription (200)", updateRes.data);

    // 14. Doctor cannot modify another doctor's prescription
    const doc3ModRes = await request("PUT", `/api/prescriptions/${prescriptionId}`, {
      diagnosis: "Hacked Diagnosis",
    }, doctor3Token);
    assert(doc3ModRes.status === 403, "14. Doctor cannot modify another doctor's prescription (403)", doc3ModRes.data);

    // 21. Patient cannot modify prescription
    const patModRes = await request("PUT", `/api/prescriptions/${prescriptionId}`, {
      diagnosis: "Patient self-edit",
    }, patient1Token);
    assert(patModRes.status === 403, "21. Patient cannot modify prescription (403)", patModRes.data);

    // Patient cannot view DRAFT prescription
    const patDraftViewRes = await request("GET", `/api/prescriptions/${prescriptionId}`, null, patient1Token);
    assert(patDraftViewRes.status === 403 && patDraftViewRes.data?.message?.includes("draft"), "17. Patient cannot view DRAFT prescription (403)", patDraftViewRes.data);

    // 15. Doctor can issue own DRAFT prescription
    const issueRes = await request("POST", `/api/prescriptions/${prescriptionId}/issue`, {}, doctor1Token);
    assert(issueRes.status === 200 && issueRes.data?.prescription?.status === "ISSUED", "15. Doctor can issue own DRAFT prescription (200, ISSUED)", issueRes.data);

    // 16. ISSUED prescription becomes immutable
    const immutabilityRes = await request("PUT", `/api/prescriptions/${prescriptionId}`, {
      diagnosis: "Trying to modify after issue",
    }, doctor1Token);
    assert(immutabilityRes.status === 400 && immutabilityRes.data?.message?.includes("ISSUED"), "16. ISSUED prescription becomes immutable (PUT rejected with 400)", immutabilityRes.data);

    // 17. Patient can view own ISSUED prescription
    const patIssuedViewRes = await request("GET", `/api/prescriptions/${prescriptionId}`, null, patient1Token);
    assert(patIssuedViewRes.status === 200 && patIssuedViewRes.data?.prescription?.id === prescriptionId, "17b. Patient can view own ISSUED prescription (200)", patIssuedViewRes.data);

    // Patient can view my-prescriptions
    const myPrescRes = await request("GET", "/api/prescriptions/my-prescriptions", null, patient1Token);
    assert(myPrescRes.status === 200 && myPrescRes.data?.prescriptions?.some((p) => p.id === prescriptionId), "Patient can list own released prescriptions (200)", myPrescRes.data);

    // 18. Patient cannot view another patient's prescription
    const pat2ViewRes = await request("GET", `/api/prescriptions/${prescriptionId}`, null, patient2Token);
    assert(pat2ViewRes.status === 403, "18. Patient cannot view another patient's prescription (403)", pat2ViewRes.data);

    // 19. Doctor can view own prescription
    const docViewRes = await request("GET", `/api/prescriptions/${prescriptionId}`, null, doctor1Token);
    assert(docViewRes.status === 200 && docViewRes.data?.prescription?.id === prescriptionId, "19. Doctor can view own prescription (200)", docViewRes.data);

    const docListRes = await request("GET", "/api/prescriptions/doctor", null, doctor1Token);
    assert(docListRes.status === 200 && docListRes.data?.prescriptions?.some((p) => p.id === prescriptionId), "Doctor can list own authored prescriptions (200)", docListRes.data);

    // 20. Other doctor cannot view unauthorized prescription
    const doc3ViewRes = await request("GET", `/api/prescriptions/${prescriptionId}`, null, doctor3Token);
    assert(doc3ViewRes.status === 403, "20. Other doctor cannot view unauthorized prescription (403)", doc3ViewRes.data);

    // 23. Doctor can cancel according to defined rules
    const cancelRes = await request("POST", `/api/prescriptions/${prescriptionId}/cancel`, {}, doctor1Token);
    assert(cancelRes.status === 200 && cancelRes.data?.prescription?.status === "CANCELLED", "23. Doctor can cancel prescription (200, CANCELLED)", cancelRes.data);

    // 22. Invalid state transitions rejected (cannot issue once CANCELLED)
    const reIssueRes = await request("POST", `/api/prescriptions/${prescriptionId}/issue`, {}, doctor1Token);
    assert(reIssueRes.status === 400 && reIssueRes.data?.message?.includes("cancelled"), "22. Invalid state transition (CANCELLED -> ISSUED) rejected (400)", reIssueRes.data);

    // 24. Audit events are recorded
    const prescAuditCount = await prisma.prescriptionAuditLog.count({
      where: { prescriptionId },
    });
    assert(prescAuditCount >= 4, `24. Prescription audit events recorded (${prescAuditCount} events found in DB)`, { prescAuditCount });

    console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Milestone 4 Test Error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone4Tests();
