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

async function runMilestone7Tests() {
  console.log("=== STARTING MILESTONE 7 VERIFICATION TESTS ===");
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
    const p1Email = `m7_pat1_${rand}@test.com`;
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

    // Patient 2
    const p2Email = `m7_pat2_${rand}@test.com`;
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
    const d1Email = `m7_doc1_${rand}@test.com`;
    const d1Phone = `83${rand}03`.slice(0, 10);
    const regD1 = await request("POST", "/api/auth/register", {
      name: `Dr. Smith ${rand}`,
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

    const doc1ProfRes = await request(
      "POST",
      "/api/doctor/create-profile",
      {
        specialization: "Neurology",
        experience: 15,
        consultationFee: 800,
        qualification: "MBBS, MD",
      },
      doctor1Token
    );
    await prisma.doctorProfile.update({
      where: { id: doc1ProfRes.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Schedule for Doctor 1 (all days 09:00 - 17:00, 30m slots)
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

    // Doctor 2 (Unverified)
    const d2Email = `m7_doc2_${rand}@test.com`;
    const d2Phone = `84${rand}04`.slice(0, 10);
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
        specialization: "Dermatology",
        experience: 2,
        consultationFee: 400,
        qualification: "MBBS",
      },
      doctor2Token
    );
    // Doctor 2 verified remains false

    // Doctor 3 (Verified, independent doctor for cross-access tests)
    const d3Email = `m7_doc3_${rand}@test.com`;
    const d3Phone = `85${rand}05`.slice(0, 10);
    const regD3 = await request("POST", "/api/auth/register", {
      name: `Dr. Unrelated ${rand}`,
      email: d3Email,
      phone: d3Phone,
      password: testPassword,
      role: "DOCTOR",
    });
    const loginD3 = await request("POST", "/api/auth/login", {
      email: d3Email,
      password: testPassword,
    });
    const doctor3Token = loginD3.data?.token;
    const doctor3Id = regD3.data?.user?.id;
    const doc3ProfRes = await request(
      "POST",
      "/api/doctor/create-profile",
      {
        specialization: "Orthopedics",
        experience: 10,
        consultationFee: 600,
        qualification: "MBBS, MS",
      },
      doctor3Token
    );
    await prisma.doctorProfile.update({
      where: { id: doc3ProfRes.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Pharmacy
    const pharmEmail = `m7_pharm_${rand}@test.com`;
    const pharmPhone = `86${rand}06`.slice(0, 10);
    const regPharm = await request("POST", "/api/auth/register", {
      name: `Pharmacy Admin ${rand}`,
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

    // Admin
    const adminEmail = `m7_admin_${rand}@test.com`;
    const adminHash = await bcrypt.hash(testPassword, 10);
    await prisma.user.create({
      data: {
        name: "Admin User",
        email: adminEmail,
        phone: `87${rand}07`.slice(0, 10),
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
      patient1Token && patient2Token && doctor1Token && doctor2Token && doctor3Token && pharmacyToken && adminToken,
      "2. Existing authentication works across Patient, Doctor, Pharmacy, and Admin"
    );

    // Book Appointment 1: Patient 1 with Doctor 1 (future slot)
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    futureDate.setUTCHours(10, 0, 0, 0);

    const appt1Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate.toISOString(),
        symptoms: "Headache and fever",
      },
      patient1Token
    );
    const appointment1Id = appt1Res.data?.appointment?.id;
    assert(appt1Res.status === 201 && appointment1Id, "56. Existing appointment functionality still works (201 booked)");

    // Try creating conversation while appointment is PENDING (should fail)
    const pendingConvRes = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      patient1Token
    );
    assert(
      pendingConvRes.status === 400 && pendingConvRes.data?.message?.includes("CONFIRMED"),
      "6a. PENDING appointment rejects conversation creation (400)",
      pendingConvRes.data
    );

    // Doctor confirms Appointment 1
    await request(
      "PUT",
      `/api/appointment/update-status/${appointment1Id}`,
      { status: "CONFIRMED" },
      doctor1Token
    );

    // 3. Patient can create conversation from own CONFIRMED appointment
    const conv1Res = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      patient1Token
    );
    const conv1 = conv1Res.data?.conversation;
    const conv1Id = conv1?.id;
    assert(
      conv1Res.status === 201 && conv1Id && conv1.patientId === patient1Id && conv1.doctorId === doctor1Id,
      "3. Patient can create conversation from own CONFIRMED appointment (201)",
      conv1Res.data
    );

    // 4. Doctor can retrieve same conversation
    const docGetConv = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}`,
      null,
      doctor1Token
    );
    assert(
      docGetConv.status === 200 && docGetConv.data?.conversation?.id === conv1Id,
      "4. Doctor can retrieve same conversation (200)",
      docGetConv.data
    );

    // 12. Duplicate conversation does not create duplicate records (returns existing 200)
    const dupConvRes = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      patient1Token
    );
    assert(
      dupConvRes.status === 200 && dupConvRes.data?.conversation?.id === conv1Id,
      "12. Duplicate conversation initiation returns existing record idempotently (200)",
      dupConvRes.data
    );

    // Book and Complete Appointment 2 (Patient 1 with Doctor 1)
    const futureDate2 = new Date(futureDate);
    futureDate2.setUTCHours(11, 0, 0, 0);
    const appt2Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate2.toISOString(),
        symptoms: "Follow-up check",
      },
      patient1Token
    );
    const appointment2Id = appt2Res.data?.appointment?.id;
    await request(
      "PUT",
      `/api/appointment/update-status/${appointment2Id}`,
      { status: "CONFIRMED" },
      doctor1Token
    );
    await request(
      "PUT",
      `/api/appointment/update-status/${appointment2Id}`,
      { status: "COMPLETED" },
      doctor1Token
    );

    // 5. Completed appointment allows conversation
    const conv2Res = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment2Id },
      patient1Token
    );
    assert(
      conv2Res.status === 201 && conv2Res.data?.conversation?.id,
      "5. COMPLETED appointment allows conversation creation (201)",
      conv2Res.data
    );

    // Book Appointment 3 and Cancel it (Patient 1 with Doctor 1)
    const futureDate3 = new Date(futureDate);
    futureDate3.setUTCHours(12, 0, 0, 0);
    const appt3Res = await request(
      "POST",
      "/api/appointment/book",
      {
        doctorId: doctor1Id,
        appointmentDate: futureDate3.toISOString(),
        symptoms: "Will cancel",
      },
      patient1Token
    );
    const appointment3Id = appt3Res.data?.appointment?.id;
    await request(
      "PUT",
      `/api/appointment/update-status/${appointment3Id}`,
      { status: "CANCELLED" },
      patient1Token
    );

    // 6. Cancelled appointment rejects conversation
    const cancelConvRes = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment3Id },
      patient1Token
    );
    assert(
      cancelConvRes.status === 400 && cancelConvRes.data?.message?.includes("CANCELLED"),
      "6b. CANCELLED appointment rejects conversation creation (400)",
      cancelConvRes.data
    );

    // 7. Patient cannot create conversation from another patient's appointment
    const pat2Appt1 = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      patient2Token
    );
    assert(
      pat2Appt1.status === 403,
      "7. Patient cannot create conversation from another patient's appointment (403)",
      pat2Appt1.data
    );

    // 8. Doctor cannot create conversation from another doctor's appointment
    const doc3Appt1 = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      doctor3Token
    );
    assert(
      doc3Appt1.status === 403,
      "8. Doctor cannot create conversation from another doctor's appointment (403)",
      doc3Appt1.data
    );

    // 9. Unverified doctor cannot create/access chat
    // Doctor 2 tries to access conversation 1
    const doc2GetConv1 = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}`,
      null,
      doctor2Token
    );
    assert(
      doc2GetConv1.status === 403,
      "9. Unverified doctor cannot access conversation (403 Forbidden)",
      doc2GetConv1.data
    );

    // 10. Pharmacy cannot create conversation
    const pharmCreateConv = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      pharmacyToken
    );
    assert(
      pharmCreateConv.status === 403,
      "10. Pharmacy cannot create conversation (403 Forbidden)",
      pharmCreateConv.data
    );

    // 11. Admin cannot create conversation
    const adminCreateConv = await request(
      "POST",
      "/api/chat/conversations",
      { appointmentId: appointment1Id },
      adminToken
    );
    assert(
      adminCreateConv.status === 403,
      "11. Admin cannot create conversation (403 Forbidden)",
      adminCreateConv.data
    );

    // 13. Authorized patient can send text message
    const p1SendMsg = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "Hello Dr. Smith, I have a question regarding my medication dosage." },
      patient1Token
    );
    const msg1 = p1SendMsg.data?.data;
    const msg1Id = msg1?.id;
    assert(
      p1SendMsg.status === 201 && msg1Id && msg1.content === "Hello Dr. Smith, I have a question regarding my medication dosage.",
      "13. Authorized patient can send text message (201)",
      p1SendMsg.data
    );

    // 14. Authorized doctor can send text message (including reply)
    const d1SendMsg = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      {
        content: "Hello! Please take one tablet with food twice daily.",
        replyToMessageId: msg1Id,
      },
      doctor1Token
    );
    const msg2 = d1SendMsg.data?.data;
    const msg2Id = msg2?.id;
    assert(
      d1SendMsg.status === 201 && msg2Id && msg2.replyToMessageId === msg1Id,
      "14. Authorized doctor can send text message with reply (201)",
      d1SendMsg.data
    );

    // 15. Unrelated patient cannot send message
    const p2SendMsg = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "Intruder patient message" },
      patient2Token
    );
    assert(p2SendMsg.status === 403, "15. Unrelated patient cannot send message (403)", p2SendMsg.data);

    // 16. Unrelated doctor cannot send message
    const d3SendMsg = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "Intruder doctor message" },
      doctor3Token
    );
    assert(d3SendMsg.status === 403, "16. Unrelated doctor cannot send message (403)", d3SendMsg.data);

    // 17. Pharmacy cannot send message
    const pharmSendMsg = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "Pharmacy message" },
      pharmacyToken
    );
    assert(pharmSendMsg.status === 403, "17. Pharmacy cannot send message (403)", pharmSendMsg.data);

    // 18. Admin cannot send message
    const adminSendMsg = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "Admin message" },
      adminToken
    );
    assert(adminSendMsg.status === 403, "18. Admin cannot send message (403)", adminSendMsg.data);

    // 19. Empty message rejected
    const emptyMsgRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "   " },
      patient1Token
    );
    assert(emptyMsgRes.status === 400, "19. Empty message rejected (400)", emptyMsgRes.data);

    // 20. Message longer than 5000 characters rejected
    const longContent = "A".repeat(5001);
    const longMsgRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: longContent },
      patient1Token
    );
    assert(longMsgRes.status === 400 && longMsgRes.data?.message?.includes("5000"), "20. Message > 5000 chars rejected (400)", longMsgRes.data);

    // 21. Message history is paginated
    const msgListRes = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}/messages?page=1&limit=1`,
      null,
      patient1Token
    );
    assert(
      msgListRes.status === 200 &&
        msgListRes.data?.messages?.length === 1 &&
        msgListRes.data?.pagination?.total >= 2,
      "21. Message history is properly paginated (limit=1, total >= 2)",
      msgListRes.data
    );

    // 22. Message history is limited to authorized participants
    const pat2GetMsgs = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}/messages`,
      null,
      patient2Token
    );
    assert(pat2GetMsgs.status === 403, "22. Unauthorized user cannot access message history (403)", pat2GetMsgs.data);

    // 23. Patient cannot retrieve another patient's conversation
    const pat2GetConv1 = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}`,
      null,
      patient2Token
    );
    assert(pat2GetConv1.status === 403, "23. Patient cannot retrieve another patient's conversation (403)", pat2GetConv1.data);

    // 24. Doctor cannot retrieve another doctor's conversation
    const doc3GetConv1 = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}`,
      null,
      doctor3Token
    );
    assert(doc3GetConv1.status === 403, "24. Doctor cannot retrieve another doctor's conversation (403)", doc3GetConv1.data);

    // 28. Other participant cannot edit message
    const docEditPatMsg = await request(
      "PUT",
      `/api/chat/messages/${msg1Id}`,
      { content: "Doctor editing patient message" },
      doctor1Token
    );
    assert(docEditPatMsg.status === 403, "28. Other participant cannot edit message (403 Forbidden)", docEditPatMsg.data);

    // 29. Sender can edit own recent text message
    const patEditMsg = await request(
      "PUT",
      `/api/chat/messages/${msg1Id}`,
      { content: "Hello Dr. Smith, updated question about morning dosage." },
      patient1Token
    );
    assert(
      patEditMsg.status === 200 && patEditMsg.data?.data?.content === "Hello Dr. Smith, updated question about morning dosage.",
      "29. Sender can edit own recent text message (200)",
      patEditMsg.data
    );

    // 30. Sender cannot edit after 15-minute edit window
    // Set message createdAt to 20 minutes ago directly in DB
    const twentyMinsAgo = new Date(Date.now() - 20 * 60 * 1000);
    await prisma.message.update({
      where: { id: msg1Id },
      data: { createdAt: twentyMinsAgo },
    });
    const expiredEdit = await request(
      "PUT",
      `/api/chat/messages/${msg1Id}`,
      { content: "Attempting to edit after 20 mins" },
      patient1Token
    );
    assert(
      expiredEdit.status === 400 && expiredEdit.data?.message?.includes("15 minutes"),
      "30. Sender cannot edit after 15-minute edit window (400)",
      expiredEdit.data
    );

    // 27. Other participant cannot delete message
    const docDeletePatMsg = await request(
      "DELETE",
      `/api/chat/messages/${msg1Id}`,
      null,
      doctor1Token
    );
    assert(docDeletePatMsg.status === 403, "27. Other participant cannot delete message (403 Forbidden)", docDeletePatMsg.data);

    // 25. Deleted message is soft-deleted
    const patDeleteMsg = await request(
      "DELETE",
      `/api/chat/messages/${msg1Id}`,
      null,
      patient1Token
    );
    assert(patDeleteMsg.status === 200, "25a. Sender can soft-delete own message (200)", patDeleteMsg.data);

    // Verify in database: deletedAt is set, record not physically deleted
    const dbMsg1 = await prisma.message.findUnique({
      where: { id: msg1Id },
    });
    assert(dbMsg1 && dbMsg1.deletedAt !== null, "25b. Message record exists with non-null deletedAt (soft-deleted)", dbMsg1);

    // 26. Deleted message content is not exposed normally
    const getDeletedInList = await request(
      "GET",
      `/api/chat/conversations/${conv1Id}/messages`,
      null,
      doctor1Token
    );
    const fetchedDeleted = getDeletedInList.data?.messages?.find((m) => m.id === msg1Id);
    assert(
      fetchedDeleted && fetchedDeleted.content === "[Message deleted]",
      "26. Deleted message content is masked as '[Message deleted]'",
      fetchedDeleted
    );

    // 31. Sender cannot edit deleted message
    const editDeleted = await request(
      "PUT",
      `/api/chat/messages/${msg1Id}`,
      { content: "Reviving deleted message" },
      patient1Token
    );
    assert(editDeleted.status === 400, "31. Sender cannot edit deleted message (400)", editDeleted.data);

    // Now test S3 Attachment Architecture
    // 34. Unauthorized user cannot obtain attachment upload URL
    const unauthUploadUrl = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/attachments/upload-url`,
      { fileName: "lab_report.pdf", mimeType: "application/pdf", fileSize: 1024 },
      patient2Token
    );
    assert(unauthUploadUrl.status === 403, "34. Unauthorized user cannot obtain attachment upload URL (403)", unauthUploadUrl.data);

    // 37. Invalid attachment MIME type rejected
    const badMimeRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/attachments/upload-url`,
      { fileName: "malicious.exe", mimeType: "application/x-msdownload", fileSize: 1024 },
      patient1Token
    );
    assert(badMimeRes.status === 400 && badMimeRes.data?.message?.includes("mimeType"), "37. Invalid attachment MIME type rejected (400)", badMimeRes.data);

    // 38. Attachment larger than 10 MB rejected
    const oversizedRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/attachments/upload-url`,
      { fileName: "huge_video.mp4", mimeType: "application/pdf", fileSize: 11 * 1024 * 1024 },
      patient1Token
    );
    assert(oversizedRes.status === 400 && oversizedRes.data?.message?.includes("10 MB"), "38. Attachment > 10 MB rejected (400)", oversizedRes.data);

    // 33. Authorized participant can obtain attachment upload URL
    // 35. S3 key is server generated
    // 36. Client cannot choose arbitrary S3 key
    const validUploadUrlRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/attachments/upload-url`,
      { fileName: "ecg_chart.pdf", mimeType: "application/pdf", fileSize: 2048 },
      patient1Token
    );
    const attachmentId = validUploadUrlRes.data?.attachmentId;
    const s3Key = validUploadUrlRes.data?.s3Key;
    const uploadUrl = validUploadUrlRes.data?.uploadUrl;

    assert(
      validUploadUrlRes.status === 201 &&
        attachmentId &&
        s3Key &&
        s3Key.startsWith(`chat-attachments/${conv1Id}/`) &&
        uploadUrl,
      "33, 35 & 36. Attachment presigned upload URL generated with server-controlled S3 key",
      validUploadUrlRes.data
    );

    // Complete upload
    const completeUploadRes = await request(
      "POST",
      `/api/chat/attachments/${attachmentId}/complete-upload`,
      {},
      patient1Token
    );
    assert(
      completeUploadRes.status === 200 && completeUploadRes.data?.attachment?.uploadStatus === "UPLOADED",
      "32a. Attachment upload completed to UPLOADED status (200)",
      completeUploadRes.data
    );

    // 32. Attachment message authorization works: Patient sends message referencing attachment
    const attachMsgRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      {
        content: "Here is my previous ECG report for your review.",
        attachmentId,
      },
      patient1Token
    );
    const attachMsg = attachMsgRes.data?.data;
    assert(
      attachMsgRes.status === 201 && attachMsg.attachmentId === attachmentId && attachMsg.messageType === "ATTACHMENT",
      "32b. Message referencing verified attachment sent successfully (201)",
      attachMsgRes.data
    );

    // 39. Private attachment presigned download URL generation works and does not expose raw/public S3 URL
    const dlUrlRes = await request(
      "GET",
      `/api/chat/attachments/${attachmentId}/download-url`,
      null,
      doctor1Token
    );
    assert(
      dlUrlRes.status === 200 &&
        dlUrlRes.data?.downloadUrl &&
        dlUrlRes.data?.downloadUrl.includes("X-Amz-Signature"),
      "39. Doctor can retrieve presigned private S3 download URL (200)",
      dlUrlRes.data
    );

    // Unrelated patient cannot access download URL
    const unauthDlUrl = await request(
      "GET",
      `/api/chat/attachments/${attachmentId}/download-url`,
      null,
      patient2Token
    );
    assert(unauthDlUrl.status === 403, "39b. Unrelated patient cannot get attachment download URL (403)", unauthDlUrl.data);

    // 40 & 41. Read / Unread tracking:
    // Patient 1 just sent messages. Doctor 1 has not marked as read yet.
    // 44. Unread count works for doctor
    const docUnreadRes1 = await request("GET", "/api/chat/unread-count", null, doctor1Token);
    assert(
      docUnreadRes1.status === 200 && docUnreadRes1.data?.totalUnreadCount >= 1,
      "44a. Unread count for doctor reflects new messages from patient (>= 1)",
      docUnreadRes1.data
    );

    // 41. Doctor can mark conversation read
    const docMarkRead = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/read`,
      {},
      doctor1Token
    );
    assert(docMarkRead.status === 200, "41. Doctor can mark own conversation as read (200)", docMarkRead.data);

    // Doctor unread count should now be 0
    const docUnreadRes2 = await request("GET", "/api/chat/unread-count", null, doctor1Token);
    const conv1DocUnread = docUnreadRes2.data?.unreadByConversation?.find((c) => c.conversationId === conv1Id);
    assert(
      docUnreadRes2.status === 200 && !conv1DocUnread,
      "44b. Doctor unread count for conversation is 0 after marking read",
      docUnreadRes2.data
    );

    // Doctor sends a new message to Patient
    const docReply = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: "Thank you for the ECG report. The rhythms look regular." },
      doctor1Token
    );

    // 43. Unread count works for patient
    const patUnreadRes1 = await request("GET", "/api/chat/unread-count", null, patient1Token);
    assert(
      patUnreadRes1.status === 200 && patUnreadRes1.data?.totalUnreadCount >= 1,
      "43a. Unread count for patient reflects doctor message (>= 1)",
      patUnreadRes1.data
    );

    // 40. Patient can mark own conversation read
    const patMarkRead = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/read`,
      {},
      patient1Token
    );
    assert(patMarkRead.status === 200, "40. Patient can mark own conversation read (200)", patMarkRead.data);

    // Patient unread count is now 0
    const patUnreadRes2 = await request("GET", "/api/chat/unread-count", null, patient1Token);
    const conv1PatUnread = patUnreadRes2.data?.unreadByConversation?.find((c) => c.conversationId === conv1Id);
    assert(!conv1PatUnread, "43b. Patient unread count is 0 after marking read", patUnreadRes2.data);

    // 42. User cannot modify another user's read state (separate records in ConversationRead)
    const readRecords = await prisma.conversationRead.findMany({
      where: { conversationId: conv1Id },
    });
    const p1Read = readRecords.find((r) => r.userId === patient1Id);
    const d1Read = readRecords.find((r) => r.userId === doctor1Id);
    assert(
      readRecords.length === 2 && p1Read && d1Read && p1Read.userId !== d1Read.userId,
      "42. Read state is strictly isolated per participant user in database",
      readRecords
    );

    // 45 - 50. Chat Audit Logs verification
    const auditLogs = await prisma.chatAuditLog.findMany({
      where: { conversationId: conv1Id },
    });
    const logActions = auditLogs.map((a) => a.action);

    assert(
      logActions.includes("CONVERSATION_CREATED"),
      "45. Audit log created for conversation creation",
      logActions
    );
    assert(
      logActions.includes("MESSAGE_SENT"),
      "46. Audit log created for message sent",
      logActions
    );
    assert(
      logActions.includes("MESSAGE_EDITED"),
      "47. Audit log created for message edit",
      logActions
    );
    assert(
      logActions.includes("MESSAGE_DELETED"),
      "48. Audit log created for message deletion",
      logActions
    );
    assert(
      logActions.includes("MESSAGE_READ"),
      "49. Audit log created for read event",
      logActions
    );
    assert(
      logActions.includes("ATTACHMENT_REQUESTED") && logActions.includes("ATTACHMENT_UPLOADED"),
      "50. Audit log created for attachment lifecycle events",
      logActions
    );

    // 51 - 54. Privacy: Responses contain no password hashes, JWTs, secrets
    const sampleMsg = msg2;
    const msgKeys = Object.keys(sampleMsg);
    const leakedKeys = ["password", "token", "secret", "cvv", "hash"].filter((k) =>
      msgKeys.includes(k)
    );
    assert(
      leakedKeys.length === 0,
      "51 & 52. Message responses contain no password hashes, JWTs, or secrets",
      msgKeys
    );

    // 55. HTML / script content stored as plain text and not executed
    const scriptContent = "<script>alert('xss')</script>";
    const scriptMsgRes = await request(
      "POST",
      `/api/chat/conversations/${conv1Id}/messages`,
      { content: scriptContent },
      patient1Token
    );
    assert(
      scriptMsgRes.status === 201 && scriptMsgRes.data?.data?.content === scriptContent,
      "55. Script/HTML content is stored safely as raw text string without execution",
      scriptMsgRes.data
    );

    // 57. Existing prescription functionality still works
    const rxRes = await request(
      "POST",
      "/api/prescriptions",
      {
        appointmentId: appointment1Id,
        diagnosis: "Migraine with aura",
        items: [
          {
            medicineName: "Sumatriptan 50mg",
            dosage: "1 tab at onset",
            frequency: "AS_NEEDED",
            duration: 7,
            quantity: 6,
          },
        ],
      },
      doctor1Token
    );
    assert(rxRes.status === 201 && rxRes.data?.prescription?.id, "57. Existing prescription functionality still works (201)", rxRes.data);

    // 58. Existing medical report functionality still works
    const reportRes = await request(
      "POST",
      "/api/reports/upload-url",
      {
        title: "Brain MRI Scan",
        reportType: "MRI",
        fileName: "brain_mri.pdf",
        mimeType: "application/pdf",
        fileSize: 10240,
        reportDate: new Date().toISOString(),
      },
      patient1Token
    );
    assert(reportRes.status === 201 && (reportRes.data?.reportId || reportRes.data?.report?.id), "58. Existing medical report functionality still works (201)", reportRes.data);

    // 59. Existing pharmacy functionality still works
    const pubPharmList = await request("GET", "/api/pharmacy/all");
    assert(pubPharmList.status === 200 && Array.isArray(pubPharmList.data?.pharmacies), "59. Existing pharmacy listing works (200)");

    // 60. Existing payment functionality still works
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
      "60. Existing payment functionality still works (201/200 Payment created)",
      payRes.data
    );

    // 61. Patient and Doctor can list their conversations
    const myConvsRes = await request("GET", "/api/chat/conversations", null, patient1Token);
    assert(
      myConvsRes.status === 200 && Array.isArray(myConvsRes.data?.conversations) && myConvsRes.data?.conversations.some((c) => c.id === conv1Id),
      "61. Patient can list own conversations (200)",
      myConvsRes.data
    );

    // 62. Non-existent conversation query returns 404
    const nonExistentConv = await request("GET", "/api/chat/conversations/non_existent_conv_id", null, patient1Token);
    assert(nonExistentConv.status === 404, "62. Non-existent conversation query returns 404", nonExistentConv.data);

    // 63. Non-existent message edit returns 404
    const nonExistentMsgEdit = await request("PUT", "/api/chat/messages/non_existent_msg_id", { content: "test" }, patient1Token);
    assert(nonExistentMsgEdit.status === 404, "63. Non-existent message edit returns 404", nonExistentMsgEdit.data);

    // 64. Non-existent message delete returns 404
    const nonExistentMsgDel = await request("DELETE", "/api/chat/messages/non_existent_msg_id", null, patient1Token);
    assert(nonExistentMsgDel.status === 404, "64. Non-existent message delete returns 404", nonExistentMsgDel.data);


    console.log(`\n=== MILESTONE 7 TEST RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Milestone 7 Test Fatal Error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone7Tests();
