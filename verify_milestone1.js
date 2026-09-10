const http = require("http");

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

async function runTests() {
  console.log("=== STARTING MILESTONE 1 VERIFICATION TESTS ===");
  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = "") {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} - Details:`, details);
      failed++;
    }
  }

  try {
    // 1. GET /
    const rootRes = await request("GET", "/");
    assert(rootRes.status === 200 && rootRes.data === "Doctor Platform API Running", "GET / returns 200 with API running message", rootRes.data);

    // 2. 404 Route Handler
    const notFoundRes = await request("GET", "/api/nonexistent-route-test");
    assert(notFoundRes.status === 404 && notFoundRes.data?.message?.includes("not found"), "GET unknown route returns 404 with clean message", notFoundRes.data);

    // 3. Validation - Missing fields on registration
    const emptyRegRes = await request("POST", "/api/auth/register", {});
    assert(emptyRegRes.status === 400 && emptyRegRes.data?.message === "Name is required", "Empty registration rejected with 400", emptyRegRes.data);

    // 4. Validation - Password length < 8
    const shortPassRes = await request("POST", "/api/auth/register", {
      name: "Short Pass",
      email: "test_short@example.com",
      phone: "1112223334",
      password: "short",
      role: "PATIENT",
    });
    assert(shortPassRes.status === 400 && shortPassRes.data?.message?.includes("8 characters"), "Short password rejected with 400", shortPassRes.data);

    // 5. Validation - Invalid email
    const badEmailRes = await request("POST", "/api/auth/register", {
      name: "Bad Email",
      email: "not-an-email",
      phone: "1112223334",
      password: "password123",
      role: "PATIENT",
    });
    assert(badEmailRes.status === 400 && badEmailRes.data?.message?.includes("valid email"), "Malformed email rejected with 400", badEmailRes.data);

    // 6. Validation - Invalid role
    const badRoleRes = await request("POST", "/api/auth/register", {
      name: "Bad Role",
      email: "badrole@example.com",
      phone: "1112223334",
      password: "password123",
      role: "SUPERUSER",
    });
    assert(badRoleRes.status === 400 && badRoleRes.data?.message?.includes("Invalid role"), "Unknown role rejected with 400", badRoleRes.data);

    // 7. Security - ADMIN self-registration rejected with 403
    const adminRegRes = await request("POST", "/api/auth/register", {
      name: "Malicious Admin",
      email: "admin_hack@example.com",
      phone: "9998887776",
      password: "adminpassword123",
      role: "ADMIN",
    });
    assert(adminRegRes.status === 403 && adminRegRes.data?.message?.includes("ADMIN"), "Self-register as ADMIN rejected with 403", adminRegRes.data);

    // 8. Valid Patient Registration
    const rand = Math.floor(Math.random() * 1000000);
    const patientEmail = `patient_${rand}@test.com`;
    const patientPhone = `98${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const patientPassword = "PatientPass123!";

    const regPatientRes = await request("POST", "/api/auth/register", {
      name: `Patient ${rand}`,
      email: patientEmail,
      phone: patientPhone,
      password: patientPassword,
      role: "PATIENT",
    });

    assert(regPatientRes.status === 201, "Valid patient registration returns 201", regPatientRes.data);
    assert(regPatientRes.data?.user && !("password" in regPatientRes.data.user), "Registration user payload does NOT contain password or password hash", regPatientRes.data?.user);
    assert(regPatientRes.data?.user?.id && regPatientRes.data?.user?.email === patientEmail, "Registration user has safe fields (id, email, role, etc.)", regPatientRes.data?.user);

    // 9. Login validation
    const emptyLoginRes = await request("POST", "/api/auth/login", {});
    assert(emptyLoginRes.status === 400 && emptyLoginRes.data?.message?.includes("Email is required"), "Empty login rejected with 400", emptyLoginRes.data);

    const wrongPassRes = await request("POST", "/api/auth/login", {
      email: patientEmail,
      password: "WrongPassword!",
    });
    assert(wrongPassRes.status === 400 && wrongPassRes.data?.message === "Invalid credentials", "Wrong password rejected with 400", wrongPassRes.data);

    // 10. Successful Patient Login
    const loginRes = await request("POST", "/api/auth/login", {
      email: patientEmail,
      password: patientPassword,
    });
    assert(loginRes.status === 200, "Valid login returns 200", loginRes.data);
    assert(typeof loginRes.data?.token === "string" && loginRes.data.token.length > 20, "Login returns signed JWT token", loginRes.data);
    assert(loginRes.data?.user && !("password" in loginRes.data.user), "Login user payload does NOT contain password or password hash", loginRes.data?.user);

    const patientToken = loginRes.data?.token;

    // 11. Protected Profile Route (/api/user/profile)
    const noTokenRes = await request("GET", "/api/user/profile");
    assert(noTokenRes.status === 401 && noTokenRes.data?.message?.includes("No token"), "Missing token returns 401", noTokenRes.data);

    const badTokenRes = await request("GET", "/api/user/profile", null, "invalid.jwt.token");
    assert(badTokenRes.status === 401 && badTokenRes.data?.message?.includes("Invalid token"), "Malformed token returns 401", badTokenRes.data);

    const authedProfileRes = await request("GET", "/api/user/profile", null, patientToken);
    assert(authedProfileRes.status === 200 && authedProfileRes.data?.user?.id === regPatientRes.data?.user?.id, "Valid JWT accesses protected profile route", authedProfileRes.data);

    // 12. Doctor Profile Authorization - PATIENT attempt must be forbidden (403)
    const patientDoctorAttempt = await request("POST", "/api/doctor/create-profile", {
      specialization: "Cardiology",
      experience: 10,
      consultationFee: 500,
      qualification: "MD, MBBS",
    }, patientToken);
    assert(patientDoctorAttempt.status === 403 && patientDoctorAttempt.data?.message?.includes("insufficient role"), "PATIENT creating doctor profile rejected with 403", patientDoctorAttempt.data);

    // 13. Register a DOCTOR and verify Doctor Profile creation
    const doctorRand = Math.floor(Math.random() * 1000000);
    const doctorEmail = `dr_${doctorRand}@test.com`;
    const doctorPhone = `97${doctorRand.toString().padStart(8, "0")}`.slice(0, 10);
    const doctorPassword = "DoctorPass123!";

    const regDoctorRes = await request("POST", "/api/auth/register", {
      name: `Dr. Smith ${doctorRand}`,
      email: doctorEmail,
      phone: doctorPhone,
      password: doctorPassword,
      role: "DOCTOR",
    });
    assert(regDoctorRes.status === 201, "Valid DOCTOR registration returns 201", regDoctorRes.data);

    const doctorLoginRes = await request("POST", "/api/auth/login", {
      email: doctorEmail,
      password: doctorPassword,
    });
    const doctorToken = doctorLoginRes.data?.token;

    const doctorCreateProfileRes = await request("POST", "/api/doctor/create-profile", {
      specialization: "Neurology",
      experience: 8,
      consultationFee: 750,
      qualification: "DM Neurology",
      hospitalName: "Apollo Hospital",
      bio: "Experienced neurologist",
      languages: "English, Hindi",
    }, doctorToken);

    assert(doctorCreateProfileRes.status === 201 && doctorCreateProfileRes.data?.doctorProfile?.specialization === "Neurology", "DOCTOR can create doctor profile (201)", doctorCreateProfileRes.data);

    // 14. Doctor profile duplicate creation prevented
    const dupDoctorProfileRes = await request("POST", "/api/doctor/create-profile", {
      specialization: "Neurology",
      experience: 8,
      consultationFee: 750,
      qualification: "DM Neurology",
    }, doctorToken);
    assert(dupDoctorProfileRes.status === 400 && dupDoctorProfileRes.data?.message?.includes("already exists"), "Duplicate doctor profile rejected with 400", dupDoctorProfileRes.data);

    // 15. Public GET /api/doctor/all
    const allDoctorsRes = await request("GET", "/api/doctor/all");
    assert(allDoctorsRes.status === 200 && Array.isArray(allDoctorsRes.data?.doctors), "GET /api/doctor/all returns list of doctors", allDoctorsRes.data?.doctors?.length);

    // 16. Existing Appointment APIs
    const patientAppointmentsRes = await request("GET", "/api/appointment/my-appointments", null, patientToken);
    assert(patientAppointmentsRes.status === 200 && Array.isArray(patientAppointmentsRes.data?.appointments), "GET /api/appointment/my-appointments returns 200 array", patientAppointmentsRes.data);

    const doctorAppointmentsRes = await request("GET", "/api/appointment/doctor-appointments", null, doctorToken);
    assert(doctorAppointmentsRes.status === 200 && Array.isArray(doctorAppointmentsRes.data?.appointments), "GET /api/appointment/doctor-appointments returns 200 array", doctorAppointmentsRes.data);

    // Book appointment test
    const doctorId = regDoctorRes.data?.user?.id;
    // Verify doctor and add schedule for Milestone 2+ compatibility
    const prismaClient = new (require("@prisma/client").PrismaClient)();
    await prismaClient.doctorProfile.update({
      where: { userId: doctorId },
      data: { verified: true },
    });
    const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
    const targetDate = new Date(Date.now() + 86400000 * 2);
    targetDate.setUTCMinutes(0, 0, 0);
    const dayName = DAYS[targetDate.getUTCDay()];
    await prismaClient.doctorSchedule.upsert({
      where: {
        doctorId_dayOfWeek: {
          doctorId,
          dayOfWeek: dayName,
        },
      },
      update: { active: true, startTime: "00:00", endTime: "23:59" },
      create: {
        doctorId,
        dayOfWeek: dayName,
        startTime: "00:00",
        endTime: "23:59",
        slotDuration: 30,
        active: true,
      },
    });
    await prismaClient.$disconnect();

    const futureDate = targetDate.toISOString();
    const bookRes = await request("POST", "/api/appointment/book", {
      doctorId: doctorId,
      appointmentDate: futureDate,
      symptoms: "Mild headaches and dizziness",
    }, patientToken);
    assert(bookRes.status === 201 && bookRes.data?.appointment?.doctorId === doctorId, "Patient can book appointment with valid doctor (201)", bookRes.data);

    console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Test execution failed with error:", err);
    process.exit(1);
  }
}

runTests();
