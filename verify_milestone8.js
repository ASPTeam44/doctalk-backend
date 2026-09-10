const http = require("http");
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

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

async function runMilestone8Tests() {
  console.log("=== STARTING MILESTONE 8 VERIFICATION TESTS ===");
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

    // 2. Setup test actors: Patient 1, Patient 2, Doctor 1 (Verified), Doctor 2 (Unverified), Pharmacy, Admin
    const rand = Math.floor(Math.random() * 900000) + 100000;
    const testPassword = "Password123!";

    // Patient 1
    const p1Email = `m8_pat1_${rand}@test.com`;
    const p1Phone = `81${rand}01`.slice(0, 10);
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

    // Patient 2 (Unrelated)
    const p2Email = `m8_pat2_${rand}@test.com`;
    const p2Phone = `82${rand}02`.slice(0, 10);
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

    // Doctor 1 (Verified)
    const d1Email = `m8_doc1_${rand}@test.com`;
    const d1Phone = `83${rand}03`.slice(0, 10);
    const regD1 = await request("POST", "/api/auth/register", {
      name: `Dr. Video Specialist ${rand}`,
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

    // Doctor 1 Profile
    const docProfileRes = await request(
      "POST",
      "/api/doctor/create-profile",
      {
        specialization: "Telemedicine & Cardiology",
        experience: 12,
        consultationFee: 800,
        qualification: "MBBS, MD Cardiology",
        hospitalName: "Apollo DocTalk Digital",
      },
      doctor1Token
    );

    await prisma.doctorProfile.update({
      where: { id: docProfileRes.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Schedule for Doctor 1 (all days 08:00 - 20:00, 30m slots)
    const days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
    for (const d of days) {
      await prisma.doctorSchedule.create({
        data: {
          doctorId: doctor1Id,
          dayOfWeek: d,
          startTime: "08:00",
          endTime: "20:00",
          slotDuration: 30,
          active: true,
        },
      });
    }

    // Admin
    const adminEmail = `m8_admin_${rand}@test.com`;
    const adminPhone = `84${rand}04`.slice(0, 10);
    const hashedAdminPassword = await bcrypt.hash(testPassword, 10);
    await prisma.user.create({
      data: {
        name: `Admin ${rand}`,
        email: adminEmail,
        phone: adminPhone,
        password: hashedAdminPassword,
        role: "ADMIN",
      },
    });
    const loginAdmin = await request("POST", "/api/auth/login", {
      email: adminEmail,
      password: testPassword,
    });
    const adminToken = loginAdmin.data?.token;

    // Doctor 2 (Unverified)
    const d2Email = `m8_doc2_${rand}@test.com`;
    const d2Phone = `85${rand}05`.slice(0, 10);
    const regD2 = await request("POST", "/api/auth/register", {
      name: `Dr. Unverified ${rand}`,
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
    const doctor2Id = regD2.data?.user?.id;
    await request(
      "POST",
      "/api/doctor/create-profile",
      {
        specialization: "General Practice",
        experience: 3,
        consultationFee: 400,
        qualification: "MBBS",
      },
      doctor2Token
    );

    // Pharmacy
    const pharmEmail = `m8_pharm_${rand}@test.com`;
    const pharmPhone = `81${rand}06`.slice(0, 10);
    await request("POST", "/api/auth/register", {
      name: `Pharmacy Partner ${rand}`,
      email: pharmEmail,
      phone: pharmPhone,
      password: testPassword,
      role: "PHARMACY",
    });
    const loginPharm = await request("POST", "/api/auth/login", {
      email: pharmEmail,
      password: testPassword,
    });
    const pharmacyToken = loginPharm.data?.token;

    assert(
      patient1Token && doctor1Token && patient2Token && doctor2Token && adminToken && pharmacyToken,
      "2. Existing authentication works across Patient, Doctor, Pharmacy, and Admin"
    );

    // 3. Book an appointment between Patient 1 and Doctor 1
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    futureDate.setUTCHours(10, 0, 0, 0);

    const aptRes = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate.toISOString(),
        symptoms: "Chest palpitation and fatigue during evening workouts",
      },
      patient1Token
    );
    const appointment1Id = aptRes.data?.appointment?.id;
    assert(
      aptRes.status === 201 && appointment1Id,
      "3. Existing appointment functionality works (201 booked)",
      aptRes.data
    );

    // 4. PENDING appointment rejects video session creation
    const pendingSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      patient1Token
    );
    assert(
      pendingSessionRes.status === 400,
      "4. PENDING appointment rejects video session creation (400)",
      pendingSessionRes.data
    );

    // Confirm the appointment
    await request(
      "PUT",
      `/api/appointment/update-status/${appointment1Id}`,
      { status: "CONFIRMED" },
      doctor1Token
    );

    // Book another appointment to test CANCELLED status
    const futureDate2 = new Date();
    futureDate2.setDate(futureDate2.getDate() + 8);
    futureDate2.setUTCHours(11, 0, 0, 0);

    const apt2Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate2.toISOString(),
        symptoms: "Headache",
      },
      patient1Token
    );
    const appointment2Id = apt2Res.data?.appointment?.id;
    await request(
      "PUT",
      `/api/appointment/update-status/${appointment2Id}`,
      { status: "CANCELLED" },
      patient1Token
    );

    // 5. CANCELLED appointment rejects video session creation
    const cancelledSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment2Id },
      patient1Token
    );
    assert(
      cancelledSessionRes.status === 400,
      "5. CANCELLED appointment rejects video session creation (400)",
      cancelledSessionRes.data
    );

    // 6. Patient can create video session for own CONFIRMED appointment
    const createSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      patient1Token
    );
    const session1 = createSessionRes.data?.session;
    const session1Id = session1?.id;
    assert(
      createSessionRes.status === 201 &&
        session1Id &&
        session1.roomId &&
        session1.roomToken &&
        session1.status === "CREATED",
      "6. Patient can create video session from own CONFIRMED appointment (201)",
      createSessionRes.data
    );

    // 7. Repeated session creation returns existing session idempotently (200)
    const duplicateSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      doctor1Token
    );
    assert(
      duplicateSessionRes.status === 200 && duplicateSessionRes.data?.session?.id === session1Id,
      "7. Duplicate session creation returns existing record idempotently (200)",
      duplicateSessionRes.data
    );

    // 8. Patient cannot create session for another patient's appointment
    const unauthPatCreate = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      patient2Token
    );
    assert(
      unauthPatCreate.status === 403,
      "8. Patient cannot create session for another patient's appointment (403)",
      unauthPatCreate.data
    );

    // 9. Doctor cannot create session for another doctor's appointment
    const unauthDocCreate = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      doctor2Token
    );
    assert(
      unauthDocCreate.status === 403,
      "9. Doctor cannot create session for another doctor's appointment (403)",
      unauthDocCreate.data
    );

    // 10. Unverified doctor cannot participate in video session
    const unverifiedApt = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor2Id,
        appointmentDate: futureDate.toISOString(),
        status: "CONFIRMED",
      },
    });
    const unverifiedSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: unverifiedApt.id },
      doctor2Token
    );
    assert(
      unverifiedSessionRes.status === 400,
      "10. Unverified doctor cannot create/access video session (400)",
      unverifiedSessionRes.data
    );

    // 11. Pharmacy cannot create video session
    const pharmCreate = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      pharmacyToken
    );
    assert(
      pharmCreate.status === 403,
      "11. Pharmacy cannot create video session (403 Forbidden)",
      pharmCreate.data
    );

    // 12. Admin cannot create video session
    const adminCreate = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: appointment1Id },
      adminToken
    );
    assert(
      adminCreate.status === 403,
      "12. Admin cannot create patient-doctor video session (403 Forbidden)",
      adminCreate.data
    );

    // 13. Patient can retrieve own session by ID
    const getSessionP1 = await request("GET", `/api/video/sessions/${session1Id}`, null, patient1Token);
    assert(
      getSessionP1.status === 200 && getSessionP1.data?.session?.id === session1Id,
      "13. Patient can retrieve own session by ID (200)",
      getSessionP1.data
    );

    // 14. Doctor can retrieve same session by ID
    const getSessionD1 = await request("GET", `/api/video/sessions/${session1Id}`, null, doctor1Token);
    assert(
      getSessionD1.status === 200 && getSessionD1.data?.session?.id === session1Id,
      "14. Doctor can retrieve same session by ID (200)",
      getSessionD1.data
    );

    // 15. Unrelated patient cannot retrieve session
    const getSessionP2 = await request("GET", `/api/video/sessions/${session1Id}`, null, patient2Token);
    assert(
      getSessionP2.status === 403,
      "15. Unrelated patient cannot retrieve session (403 Forbidden)",
      getSessionP2.data
    );

    // 16. Unrelated doctor cannot retrieve session
    const getSessionD2 = await request("GET", `/api/video/sessions/${session1Id}`, null, doctor2Token);
    assert(
      getSessionD2.status === 403,
      "16. Unrelated doctor cannot retrieve session (403 Forbidden)",
      getSessionD2.data
    );

    // 17. Pharmacy cannot retrieve session
    const getSessionPharm = await request("GET", `/api/video/sessions/${session1Id}`, null, pharmacyToken);
    assert(
      getSessionPharm.status === 403,
      "17. Pharmacy cannot retrieve session (403 Forbidden)",
      getSessionPharm.data
    );

    // 18. Admin cannot retrieve session
    const getSessionAdmin = await request("GET", `/api/video/sessions/${session1Id}`, null, adminToken);
    assert(
      getSessionAdmin.status === 403,
      "18. Admin cannot retrieve session (403 Forbidden)",
      getSessionAdmin.data
    );

    // 19. Non-existent session query returns 404
    const nonExistentSession = await request("GET", "/api/video/sessions/non_existent_session_id", null, patient1Token);
    assert(
      nonExistentSession.status === 404,
      "19. Non-existent session query returns 404",
      nonExistentSession.data
    );

    // 20. Timing rules: early join rejection
    // session1 is scheduled 7 days in future. Joining now should be rejected as "too early"
    const earlyJoinRes = await request("POST", `/api/video/sessions/${session1Id}/join`, {}, patient1Token);
    assert(
      earlyJoinRes.status === 400 && String(earlyJoinRes.data?.message).includes("Too early"),
      "20. Early join attempt (>10 min before scheduled start) rejected (400)",
      earlyJoinRes.data
    );

    // Create an active appointment scheduled right now to test valid join window
    const nowTime = new Date();
    const activeApt = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor1Id,
        appointmentDate: nowTime,
        status: "CONFIRMED",
      },
    });
    const activeSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: activeApt.id },
      patient1Token
    );
    const activeSessionId = activeSessionRes.data?.session?.id;

    // 21. Valid join window accepted (status moves to ACTIVE, startedAt recorded)
    const joinRes = await request("POST", `/api/video/sessions/${activeSessionId}/join`, {}, patient1Token);
    assert(
      joinRes.status === 200 &&
        joinRes.data?.session?.status === "ACTIVE" &&
        joinRes.data?.session?.startedAt !== null,
      "21. Valid join window accepted (200, status ACTIVE, startedAt recorded)",
      joinRes.data
    );

    // 22. Join response includes valid ICE servers configuration (STUN)
    assert(
      Array.isArray(joinRes.data?.iceServers) &&
        joinRes.data.iceServers.length > 0 &&
        joinRes.data.iceServers[0].urls.length > 0,
      "22. Join response includes valid ICE servers configuration",
      joinRes.data?.iceServers
    );

    // 23. Unauthorized patient cannot join session
    const unauthPatJoin = await request("POST", `/api/video/sessions/${activeSessionId}/join`, {}, patient2Token);
    assert(
      unauthPatJoin.status === 403,
      "23. Unauthorized patient cannot join session (403)",
      unauthPatJoin.data
    );

    // 24. Unauthorized doctor cannot join session
    const unauthDocJoin = await request("POST", `/api/video/sessions/${activeSessionId}/join`, {}, doctor2Token);
    assert(
      unauthDocJoin.status === 403,
      "24. Unauthorized doctor cannot join session (403)",
      unauthDocJoin.data
    );

    // 25. Pharmacy cannot join session
    const pharmJoin = await request("POST", `/api/video/sessions/${activeSessionId}/join`, {}, pharmacyToken);
    assert(
      pharmJoin.status === 403,
      "25. Pharmacy cannot join session (403 Forbidden)",
      pharmJoin.data
    );

    // 26. Admin cannot join session
    const adminJoin = await request("POST", `/api/video/sessions/${activeSessionId}/join`, {}, adminToken);
    assert(
      adminJoin.status === 403,
      "26. Admin cannot join session (403 Forbidden)",
      adminJoin.data
    );

    // 27. Participant can retrieve ICE servers via GET /api/video/sessions/:sessionId/ice-servers
    const getIceRes = await request("GET", `/api/video/sessions/${activeSessionId}/ice-servers`, null, doctor1Token);
    assert(
      getIceRes.status === 200 && Array.isArray(getIceRes.data?.iceServers),
      "27. Participant can retrieve ICE servers (200)",
      getIceRes.data
    );

    // 28. Unauthorized user cannot retrieve ICE servers
    const unauthIceRes = await request("GET", `/api/video/sessions/${activeSessionId}/ice-servers`, null, patient2Token);
    assert(
      unauthIceRes.status === 403,
      "28. Unauthorized user cannot retrieve ICE servers (403)",
      unauthIceRes.data
    );

    // 29. Authorized patient can submit SDP offer
    const sampleOffer = {
      type: "offer",
      sdp: "v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 50000 RTP/AVP 0\r\n",
    };
    const offerRes = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      { offer: sampleOffer },
      patient1Token
    );
    assert(
      offerRes.status === 200 && offerRes.data?.offer?.payload?.type === "offer",
      "29. Authorized patient can submit SDP offer (200)",
      offerRes.data
    );

    // 30. Authorized doctor can retrieve SDP offer
    const getOfferRes = await request(
      "GET",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      null,
      doctor1Token
    );
    assert(
      getOfferRes.status === 200 && getOfferRes.data?.offer?.payload?.type === "offer",
      "30. Authorized doctor can retrieve SDP offer (200)",
      getOfferRes.data
    );

    // 31. Authorized doctor can submit SDP answer
    const sampleAnswer = {
      type: "answer",
      sdp: "v=0\r\no=- 654321 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 50000 RTP/AVP 0\r\n",
    };
    const answerRes = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/answer`,
      { answer: sampleAnswer },
      doctor1Token
    );
    assert(
      answerRes.status === 200 && answerRes.data?.answer?.payload?.type === "answer",
      "31. Authorized doctor can submit SDP answer (200)",
      answerRes.data
    );

    // 32. Authorized patient can retrieve SDP answer
    const getAnswerRes = await request(
      "GET",
      `/api/video/sessions/${activeSessionId}/signaling/answer`,
      null,
      patient1Token
    );
    assert(
      getAnswerRes.status === 200 && getAnswerRes.data?.answer?.payload?.type === "answer",
      "32. Authorized patient can retrieve SDP answer (200)",
      getAnswerRes.data
    );

    // 33. Authorized patient can submit ICE candidate
    const sampleCandidate = {
      candidate: "candidate:1 1 UDP 2122252543 192.168.1.100 50005 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };
    const iceCandidateRes = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/ice`,
      { candidate: sampleCandidate },
      patient1Token
    );
    assert(
      iceCandidateRes.status === 200 && iceCandidateRes.data?.candidate?.payload?.candidate,
      "33. Authorized patient can submit ICE candidate (200)",
      iceCandidateRes.data
    );

    // 34. Authorized doctor can retrieve ICE candidates
    const getCandidatesRes = await request(
      "GET",
      `/api/video/sessions/${activeSessionId}/signaling/ice`,
      null,
      doctor1Token
    );
    assert(
      getCandidatesRes.status === 200 && Array.isArray(getCandidatesRes.data?.candidates) && getCandidatesRes.data.candidates.length >= 1,
      "34. Authorized doctor can retrieve ICE candidates (200)",
      getCandidatesRes.data
    );

    // 35. Unauthorized participant cannot submit SDP offer
    const unauthOffer = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      { offer: sampleOffer },
      patient2Token
    );
    assert(
      unauthOffer.status === 403,
      "35. Unauthorized participant cannot submit SDP offer (403)",
      unauthOffer.data
    );

    // 36. Unauthorized participant cannot retrieve SDP offer
    const unauthGetOffer = await request(
      "GET",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      null,
      patient2Token
    );
    assert(
      unauthGetOffer.status === 403,
      "36. Unauthorized participant cannot retrieve SDP offer (403)",
      unauthGetOffer.data
    );

    // 37. Unauthorized participant cannot submit SDP answer
    const unauthAnswer = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/answer`,
      { answer: sampleAnswer },
      patient2Token
    );
    assert(
      unauthAnswer.status === 403,
      "37. Unauthorized participant cannot submit SDP answer (403)",
      unauthAnswer.data
    );

    // 38. Unauthorized participant cannot retrieve SDP answer
    const unauthGetAnswer = await request(
      "GET",
      `/api/video/sessions/${activeSessionId}/signaling/answer`,
      null,
      patient2Token
    );
    assert(
      unauthGetAnswer.status === 403,
      "38. Unauthorized participant cannot retrieve SDP answer (403)",
      unauthGetAnswer.data
    );

    // 39. Unauthorized participant cannot submit ICE candidate
    const unauthIce = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/ice`,
      { candidate: sampleCandidate },
      patient2Token
    );
    assert(
      unauthIce.status === 403,
      "39. Unauthorized participant cannot submit ICE candidate (403)",
      unauthIce.data
    );

    // 40. Unauthorized participant cannot retrieve ICE candidates
    const unauthGetIce = await request(
      "GET",
      `/api/video/sessions/${activeSessionId}/signaling/ice`,
      null,
      patient2Token
    );
    assert(
      unauthGetIce.status === 403,
      "40. Unauthorized participant cannot retrieve ICE candidates (403)",
      unauthGetIce.data
    );

    // 41. Oversized signaling payload (>64 KB) rejected with 400
    const giantPayload = {
      type: "offer",
      sdp: "x".repeat(70000), // > 64 KB
    };
    const giantOfferRes = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      { offer: giantPayload },
      patient1Token
    );
    assert(
      giantOfferRes.status === 400,
      "41. Oversized signaling payload (>64 KB) rejected (400)",
      giantOfferRes.data
    );

    // 42. Invalid non-object signaling payload rejected with 400
    const invalidPayloadRes = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      { offer: "not-an-object" },
      patient1Token
    );
    assert(
      invalidPayloadRes.status === 400,
      "42. Invalid non-object signaling payload rejected (400)",
      invalidPayloadRes.data
    );

    // 43. Participant can leave session
    const leaveRes = await request("POST", `/api/video/sessions/${activeSessionId}/leave`, {}, patient1Token);
    assert(
      leaveRes.status === 200 && leaveRes.data?.message,
      "43. Participant can leave session (200)",
      leaveRes.data
    );

    // 44. Leave does not terminate session for remaining participant (status remains ACTIVE)
    const checkAfterLeave = await request("GET", `/api/video/sessions/${activeSessionId}`, null, doctor1Token);
    assert(
      checkAfterLeave.status === 200 && checkAfterLeave.data?.session?.status === "ACTIVE",
      "44. Leave does not terminate session (status remains ACTIVE for other participant)",
      checkAfterLeave.data
    );

    // 45. Participant can end session (200, status ENDED, endedAt recorded)
    const endRes = await request("POST", `/api/video/sessions/${activeSessionId}/end`, {}, doctor1Token);
    assert(
      endRes.status === 200 &&
        endRes.data?.session?.status === "ENDED" &&
        endRes.data?.session?.endedAt !== null,
      "45. Participant can end session (200, status ENDED, endedAt recorded)",
      endRes.data
    );

    // 46. Repeated end session call is safe and idempotent (200)
    const repeatEndRes = await request("POST", `/api/video/sessions/${activeSessionId}/end`, {}, patient1Token);
    assert(
      repeatEndRes.status === 200 && repeatEndRes.data?.isAlreadyEnded === true,
      "46. Repeated end session call is safe and idempotent (200)",
      repeatEndRes.data
    );

    // 47. Participant cannot rejoin ended session (400)
    const rejoinRes = await request("POST", `/api/video/sessions/${activeSessionId}/join`, {}, patient1Token);
    assert(
      rejoinRes.status === 400 && String(rejoinRes.data?.message).includes("ended"),
      "47. Participant cannot rejoin ended session (400)",
      rejoinRes.data
    );

    // 48. Signaling rejected for ended session (400)
    const endedSignalingRes = await request(
      "POST",
      `/api/video/sessions/${activeSessionId}/signaling/offer`,
      { offer: sampleOffer },
      patient1Token
    );
    assert(
      endedSignalingRes.status === 400,
      "48. Signaling rejected for ended session (400)",
      endedSignalingRes.data
    );

    // 49. Timing rules: expired session handling
    // Create an appointment in the past (>30 min past slot end)
    const pastTime = new Date(Date.now() - 4 * 60 * 60 * 1000); // 4 hours ago
    const expiredApt = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor1Id,
        appointmentDate: pastTime,
        status: "CONFIRMED",
      },
    });
    const expiredSessionRes = await request(
      "POST",
      "/api/video/sessions",
      { appointmentId: expiredApt.id },
      patient1Token
    );
    const expiredSessionId = expiredSessionRes.data?.session?.id;

    // Join attempt should mark session EXPIRED in DB and return 400
    const joinExpiredRes = await request("POST", `/api/video/sessions/${expiredSessionId}/join`, {}, patient1Token);
    assert(
      joinExpiredRes.status === 400 && String(joinExpiredRes.data?.message).includes("expired"),
      "49. Join attempt on past session window marks EXPIRED and rejects (400)",
      joinExpiredRes.data
    );

    // 50. Rejoin expired session rejected with 400
    const rejoinExpired = await request("POST", `/api/video/sessions/${expiredSessionId}/join`, {}, patient1Token);
    assert(
      rejoinExpired.status === 400 && String(rejoinExpired.data?.message).includes("expired"),
      "50. Rejoin expired session rejected (400)",
      rejoinExpired.data
    );

    // 51. Privacy: No video/audio data stored in database models
    const dbSession = await prisma.consultationSession.findUnique({
      where: { id: activeSessionId },
    });
    const hasMediaCols =
      "videoUrl" in dbSession ||
      "audioUrl" in dbSession ||
      "recordingUrl" in dbSession ||
      "mediaStream" in dbSession;
    assert(
      hasMediaCols === false,
      "51. No video/audio data stored in database models",
      dbSession
    );

    // 52. Privacy: No recording enabled by default (no media URLs or recording records)
    assert(
      dbSession.status === "ENDED" && !("recording" in dbSession),
      "52. Recording is off by default and no recording data stored"
    );

    // 53. Response Security: No password hashes, JWTs, or secrets in session response
    const sessionStr = JSON.stringify(joinRes.data?.session);
    assert(
      !sessionStr.includes("password") && !sessionStr.includes("$2b$") && !sessionStr.includes("JWT_SECRET"),
      "53. No password hashes, JWTs, or secrets in session response"
    );

    // 54. Clinical Privacy: No medical report contents or prescription data leaked into session record
    const hasClinicalFields =
      "prescription" in dbSession ||
      "medicalReport" in dbSession ||
      "diagnosis" in dbSession ||
      "symptoms" in dbSession;
    assert(
      hasClinicalFields === false,
      "54. No clinical report contents, prescriptions, or diagnosis in session record"
    );

    // 55-62. Audit Log Verification
    const auditLogs = await prisma.videoAuditLog.findMany({
      where: {
        sessionId: { in: [activeSessionId, expiredSessionId, session1Id] },
      },
    });
    const auditActions = new Set(auditLogs.map((l) => l.action));

    assert(
      auditActions.has("VIDEO_SESSION_CREATED"),
      "55. Audit log captured for VIDEO_SESSION_CREATED"
    );
    assert(
      auditActions.has("VIDEO_SESSION_ACCESSED"),
      "56. Audit log captured for VIDEO_SESSION_ACCESSED"
    );
    assert(
      auditActions.has("VIDEO_SESSION_JOINED"),
      "57. Audit log captured for VIDEO_SESSION_JOINED"
    );
    assert(
      auditActions.has("VIDEO_SESSION_LEFT"),
      "58. Audit log captured for VIDEO_SESSION_LEFT"
    );
    assert(
      auditActions.has("VIDEO_SESSION_ENDED"),
      "59. Audit log captured for VIDEO_SESSION_ENDED"
    );
    assert(
      auditActions.has("VIDEO_SESSION_EXPIRED"),
      "60. Audit log captured for VIDEO_SESSION_EXPIRED"
    );
    assert(
      auditActions.has("VIDEO_SIGNALING_ATTEMPT"),
      "61. Audit log captured for VIDEO_SIGNALING_ATTEMPT"
    );
    assert(
      auditActions.has("VIDEO_UNAUTHORIZED_ACCESS"),
      "62. Audit log captured for VIDEO_UNAUTHORIZED_ACCESS"
    );

    // 63. Existing appointment functionality still works
    const myAptsRes = await request("GET", "/api/appointment/my-appointments", null, patient1Token);
    assert(
      myAptsRes.status === 200 && Array.isArray(myAptsRes.data?.appointments),
      "63. Existing appointment listing still works (200)"
    );

    // 64. Existing prescription functionality still works
    const rxRes = await request(
      "POST",
      "/api/prescriptions",
      {
        appointmentId: appointment1Id,
        diagnosis: "Mild Sinus Tachycardia",
        items: [
          {
            medicineName: "Metoprolol 25mg",
            dosage: "25mg once daily",
            frequency: "ONCE_DAILY",
            duration: 14,
            quantity: 14,
          },
        ],
      },
      doctor1Token
    );
    assert(
      rxRes.status === 201 && rxRes.data?.prescription?.id,
      "64. Existing prescription functionality still works (201)",
      rxRes.data
    );

    // 65. Existing medical report functionality still works
    const reportRes = await request(
      "POST",
      "/api/reports/upload-url",
      {
        title: "ECG Stress Test Report",
        reportType: "ECG",
        fileName: "ecg_stress_test.pdf",
        mimeType: "application/pdf",
        fileSize: 10240,
        reportDate: new Date().toISOString(),
      },
      patient1Token
    );
    assert(
      reportRes.status === 201 && (reportRes.data?.reportId || reportRes.data?.report?.id),
      "65. Existing medical report functionality still works (201)"
    );

    // 66. Existing pharmacy listing works
    const pubPharmList = await request("GET", "/api/pharmacy/all");
    assert(
      pubPharmList.status === 200 && Array.isArray(pubPharmList.data?.pharmacies),
      "66. Existing pharmacy listing works (200)"
    );

    // 67. Existing payment functionality still works
    const payRes = await request(
      "POST",
      "/api/payments/consultation",
      {
        appointmentId: appointment1Id,
        provider: "RAZORPAY",
      },
      patient1Token
    );
    assert(
      (payRes.status === 201 || payRes.status === 200) && payRes.data?.payment?.id,
      "67. Existing payment consultation payment functionality works (201/200 Payment created)"
    );

    // 68. Existing secure chat functionality still works
    const chatRes = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      patient1Token
    );
    assert(
      (chatRes.status === 201 || chatRes.status === 200) && chatRes.data?.conversation?.id,
      "68. Existing secure chat functionality still works (200/201)"
    );

  } catch (error) {
    console.error("Test execution failed with error:", error);
    failed++;
  } finally {
    await prisma.$disconnect();
    console.log(`\n=== MILESTONE 8 TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);
    if (failed > 0) {
      process.exit(1);
    }
  }
}

runMilestone8Tests();
