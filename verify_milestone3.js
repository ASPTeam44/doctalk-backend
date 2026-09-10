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

async function runMilestone3Tests() {
  console.log("=== STARTING MILESTONE 3 VERIFICATION TESTS ===");
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
    // 21. Existing authentication still works: Register Patient 1
    const rand = Math.floor(Math.random() * 1000000);
    const pat1Email = `m3_patient1_${rand}@test.com`;
    const pat1Phone = `81${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const password = "Password123!";

    const regPat1 = await request("POST", "/api/auth/register", {
      name: `Patient One ${rand}`,
      email: pat1Email,
      phone: pat1Phone,
      password,
      role: "PATIENT",
    });
    assert(regPat1.status === 201, "21. Patient 1 registration works (201)", regPat1.data);

    const loginPat1 = await request("POST", "/api/auth/login", {
      email: pat1Email,
      password,
    });
    const patient1Token = loginPat1.data?.token;
    const patient1Id = regPat1.data?.user?.id;

    // Register Patient 2 (for cross-patient access checks)
    const pat2Email = `m3_patient2_${rand}@test.com`;
    const pat2Phone = `82${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPat2 = await request("POST", "/api/auth/register", {
      name: `Patient Two ${rand}`,
      email: pat2Email,
      phone: pat2Phone,
      password,
      role: "PATIENT",
    });
    const loginPat2 = await request("POST", "/api/auth/login", {
      email: pat2Email,
      password,
    });
    const patient2Token = loginPat2.data?.token;

    // Register Doctor 1 (Authorized Doctor)
    const doc1Email = `m3_doc1_${rand}@test.com`;
    const doc1Phone = `83${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regDoc1 = await request("POST", "/api/auth/register", {
      name: `Dr. Authorized ${rand}`,
      email: doc1Email,
      phone: doc1Phone,
      password,
      role: "DOCTOR",
    });
    const loginDoc1 = await request("POST", "/api/auth/login", {
      email: doc1Email,
      password,
    });
    const doctor1Token = loginDoc1.data?.token;
    const doctor1Id = regDoc1.data?.user?.id;

    // Create doctor 1 profile
    await request("POST", "/api/doctor/create-profile", {
      specialization: "General Medicine",
      experience: 10,
      consultationFee: 500,
      qualification: "MBBS, MD",
    }, doctor1Token);

    // Register Doctor 2 (Unauthorized Doctor)
    const doc2Email = `m3_doc2_${rand}@test.com`;
    const doc2Phone = `84${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regDoc2 = await request("POST", "/api/auth/register", {
      name: `Dr. Unauthorized ${rand}`,
      email: doc2Email,
      phone: doc2Phone,
      password,
      role: "DOCTOR",
    });
    const loginDoc2 = await request("POST", "/api/auth/login", {
      email: doc2Email,
      password,
    });
    const doctor2Token = loginDoc2.data?.token;

    // 2. Invalid MIME type rejected
    const badMimeRes = await request("POST", "/api/reports/upload-url", {
      title: "Blood Test",
      reportType: "Lab Report",
      reportDate: "2026-09-01",
      fileName: "test.exe",
      mimeType: "application/x-msdownload",
      fileSize: 1024,
    }, patient1Token);
    assert(badMimeRes.status === 400 && badMimeRes.data?.message?.includes("mimeType"), "2. Invalid MIME type rejected (400)", badMimeRes.data);

    // 3. Oversized file rejected (> 10MB)
    const oversizedRes = await request("POST", "/api/reports/upload-url", {
      title: "Huge MRI",
      reportType: "Scan",
      reportDate: "2026-09-01",
      fileName: "huge_scan.pdf",
      mimeType: "application/pdf",
      fileSize: 15 * 1024 * 1024,
    }, patient1Token);
    assert(oversizedRes.status === 400 && oversizedRes.data?.message?.includes("10 MB"), "3. Oversized file rejected (400)", oversizedRes.data);

    // 4. Missing required fields rejected
    const missingFieldRes = await request("POST", "/api/reports/upload-url", {
      reportType: "Lab Report",
      fileName: "scan.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
    }, patient1Token);
    assert(missingFieldRes.status === 400 && missingFieldRes.data?.message?.includes("Title"), "4. Missing required fields rejected (400)", missingFieldRes.data);

    // 1, 5, 6. Patient can create report upload request, metadata created, presigned upload URL generated
    const uploadReqRes = await request("POST", "/api/reports/upload-url", {
      title: "Complete Blood Count",
      reportType: "Hematology",
      reportDate: "2026-09-05",
      fileName: "blood_test_cbc.pdf",
      mimeType: "application/pdf",
      fileSize: 512000,
    }, patient1Token);

    assert(uploadReqRes.status === 201, "1. Patient can create report upload request (201)", uploadReqRes.data);
    const report1Id = uploadReqRes.data?.reportId;
    const uploadUrl = uploadReqRes.data?.uploadUrl;
    const s3Key = uploadReqRes.data?.s3Key;

    assert(report1Id && uploadReqRes.data?.expiresIn === 900, "5. MedicalReport metadata created and returned", uploadReqRes.data);
    assert(uploadUrl && uploadUrl.includes("https://") && s3Key?.startsWith("medical-reports/"), "6. Presigned upload URL generated with server-controlled S3 key", { uploadUrl, s3Key });

    // 7. Patient can complete own upload
    const completeRes = await request("POST", `/api/reports/${report1Id}/complete-upload`, {}, patient1Token);
    assert(completeRes.status === 200 && completeRes.data?.report?.uploadStatus === "UPLOADED", "7. Patient can complete own upload (200, UPLOADED)", completeRes.data);

    // Patient 2 cannot complete Patient 1's upload
    const pat2CompleteAttempt = await request("POST", `/api/reports/${report1Id}/complete-upload`, {}, patient2Token);
    assert(pat2CompleteAttempt.status === 403, "7b. Another patient cannot complete upload of report they do not own (403)", pat2CompleteAttempt.data);

    // 8. Patient can list own reports
    const myReportsRes = await request("GET", "/api/reports/my-reports", null, patient1Token);
    assert(myReportsRes.status === 200 && myReportsRes.data?.reports?.some((r) => r.id === report1Id), "8. Patient can list own reports (200)", myReportsRes.data);

    // 9. Patient can request download URL for own report
    const downloadRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, patient1Token);
    assert(downloadRes.status === 200 && downloadRes.data?.downloadUrl?.includes("https://"), "9. Patient can request download URL for own report (200)", downloadRes.data);

    // 10. Another patient cannot access report (download URL)
    const pat2DownloadRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, patient2Token);
    assert(pat2DownloadRes.status === 403, "10. Another patient cannot access report download URL (403)", pat2DownloadRes.data);

    // 11. Doctor cannot access report without ReportAccess
    const doc1UnauthRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, doctor1Token);
    assert(doc1UnauthRes.status === 403, "11. Doctor cannot access report download URL without ReportAccess (403)", doc1UnauthRes.data);

    const doc1ListBeforeAccess = await request("GET", `/api/reports/patient/${patient1Id}`, null, doctor1Token);
    assert(doc1ListBeforeAccess.status === 403, "11b. Doctor cannot list patient reports without ReportAccess (403)", doc1ListBeforeAccess.data);

    // 18. Doctor cannot grant themselves access
    const docSelfGrant = await request("POST", `/api/reports/${report1Id}/access`, {
      doctorId: doctor1Id,
    }, doctor1Token);
    assert(docSelfGrant.status === 403, "18. Doctor cannot grant themselves access to patient report (403)", docSelfGrant.data);

    // 12. Patient can grant doctor access
    const grantRes = await request("POST", `/api/reports/${report1Id}/access`, {
      doctorId: doctor1Id,
      expiresAt: new Date(Date.now() + 86400000 * 7).toISOString(), // 7 days in future
    }, patient1Token);
    assert(grantRes.status === 201 && grantRes.data?.access?.doctorId === doctor1Id, "12. Patient can grant doctor access (201)", grantRes.data);
    const accessId = grantRes.data?.access?.id;

    // View access list as patient owner
    const accessListRes = await request("GET", `/api/reports/${report1Id}/access`, null, patient1Token);
    assert(accessListRes.status === 200 && accessListRes.data?.accessList?.length >= 1, "12b. Patient can view access list for report (200)", accessListRes.data);

    // 13. Authorized doctor can list shared reports
    const doc1ListAfterAccess = await request("GET", `/api/reports/patient/${patient1Id}`, null, doctor1Token);
    assert(doc1ListAfterAccess.status === 200 && doc1ListAfterAccess.data?.reports?.some((r) => r.id === report1Id), "13. Authorized doctor can list shared reports (200)", doc1ListAfterAccess.data);

    // 14. Authorized doctor can request download URL
    const doc1DownloadRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, doctor1Token);
    assert(doc1DownloadRes.status === 200 && doc1DownloadRes.data?.downloadUrl?.includes("https://"), "14. Authorized doctor can request download URL (200)", doc1DownloadRes.data);

    // 15. Unauthorized doctor gets 403
    const doc2ListRes = await request("GET", `/api/reports/patient/${patient1Id}`, null, doctor2Token);
    assert(doc2ListRes.status === 403, "15. Unauthorized doctor cannot list patient reports (403)", doc2ListRes.data);

    const doc2DownloadRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, doctor2Token);
    assert(doc2DownloadRes.status === 403, "15b. Unauthorized doctor cannot get download URL (403)", doc2DownloadRes.data);

    // 16. Expired access gets 403
    // Create an expired access record directly in DB to test expiry enforcement
    const expiredReportReq = await request("POST", "/api/reports/upload-url", {
      title: "Expired Report Test",
      reportType: "Blood Test",
      reportDate: "2026-09-01",
      fileName: "expired_test.pdf",
      mimeType: "application/pdf",
      fileSize: 1024,
    }, patient1Token);
    const expReportId = expiredReportReq.data?.reportId;
    await request("POST", `/api/reports/${expReportId}/complete-upload`, {}, patient1Token);

    // Insert access that expired 1 hour ago
    await prisma.reportAccess.create({
      data: {
        reportId: expReportId,
        doctorId: doctor1Id,
        grantedByPatientId: patient1Id,
        expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    });

    const expDocDownloadRes = await request("GET", `/api/reports/${expReportId}/download-url`, null, doctor1Token);
    assert(expDocDownloadRes.status === 403, "16. Expired access gets 403 on download URL", expDocDownloadRes.data);

    // 17. Revoked access gets 403
    const revokeRes = await request("DELETE", `/api/reports/${report1Id}/access/${accessId}`, null, patient1Token);
    assert(revokeRes.status === 200 && revokeRes.data?.access?.revokedAt !== null, "17. Patient can revoke doctor access (200)", revokeRes.data);

    const revokedDownloadRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, doctor1Token);
    assert(revokedDownloadRes.status === 403, "17b. Revoked access gets 403 on download URL", revokedDownloadRes.data);

    // 19. Doctor cannot delete patient report
    const docDeleteAttempt = await request("DELETE", `/api/reports/${report1Id}`, null, doctor1Token);
    assert(docDeleteAttempt.status === 403, "19. Doctor cannot delete patient report (403)", docDeleteAttempt.data);

    // 20. Patient can delete own report
    const deleteReportRes = await request("DELETE", `/api/reports/${report1Id}`, null, patient1Token);
    assert(deleteReportRes.status === 200, "20. Patient can delete own report (200)", deleteReportRes.data);

    const checkDeletedRes = await request("GET", `/api/reports/${report1Id}/download-url`, null, patient1Token);
    assert(checkDeletedRes.status === 404, "20b. Deleted report returns 404", checkDeletedRes.data);

    // 22. Existing appointment APIs still work
    const patApts = await request("GET", "/api/appointment/my-appointments", null, patient1Token);
    assert(patApts.status === 200 && Array.isArray(patApts.data?.appointments), "22. GET /api/appointment/my-appointments works (200)", patApts.data);

    // 23. Existing doctor scheduling APIs still work
    const docSchedule = await request("GET", "/api/doctor/schedule", null, doctor1Token);
    assert(docSchedule.status === 200 && Array.isArray(docSchedule.data?.schedules), "23. GET /api/doctor/schedule works (200)", docSchedule.data);

    // Check Audit Log table has captured audit records
    const auditCount = await prisma.reportAuditLog.count();
    assert(auditCount > 0, `Audit logs captured: ${auditCount} audit events recorded`, { auditCount });

    console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===`);
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Milestone 3 Test execution error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone3Tests();
