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

async function runMilestone5Tests() {
  console.log("=== STARTING MILESTONE 5 VERIFICATION TESTS ===");
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
    // 1. Existing server starts and root responds
    const rootRes = await request("GET", "/");
    assert(rootRes.status === 200 && rootRes.data === "Doctor Platform API Running", "1. Existing server starts and responds", rootRes.data);

    // 2. Existing auth works
    const rand = Math.floor(Math.random() * 1000000);
    const testPassword = "Password123!";

    // Register Patient 1
    const pat1Email = `m5_pat1_${rand}@test.com`;
    const pat1Phone = `81${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPat1 = await request("POST", "/api/auth/register", {
      name: `Patient One ${rand}`,
      email: pat1Email,
      phone: pat1Phone,
      password: testPassword,
      role: "PATIENT",
    });
    const loginPat1 = await request("POST", "/api/auth/login", { email: pat1Email, password: testPassword });
    const patient1Token = loginPat1.data?.token;
    const patient1Id = regPat1.data?.user?.id;

    // Register Patient 2
    const pat2Email = `m5_pat2_${rand}@test.com`;
    const pat2Phone = `82${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPat2 = await request("POST", "/api/auth/register", {
      name: `Patient Two ${rand}`,
      email: pat2Email,
      phone: pat2Phone,
      password: testPassword,
      role: "PATIENT",
    });
    const loginPat2 = await request("POST", "/api/auth/login", { email: pat2Email, password: testPassword });
    const patient2Token = loginPat2.data?.token;

    // Register Doctor 1
    const doc1Email = `m5_doc1_${rand}@test.com`;
    const doc1Phone = `83${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regDoc1 = await request("POST", "/api/auth/register", {
      name: `Dr. Smith ${rand}`,
      email: doc1Email,
      phone: doc1Phone,
      password: testPassword,
      role: "DOCTOR",
    });
    const loginDoc1 = await request("POST", "/api/auth/login", { email: doc1Email, password: testPassword });
    const doctor1Token = loginDoc1.data?.token;
    const doctor1Id = regDoc1.data?.user?.id;

    // Doctor 1 creates profile & verify in DB
    const doc1ProfRes = await request("POST", "/api/doctor/create-profile", {
      specialization: "General Physician",
      experience: 10,
      consultationFee: 500,
      qualification: "MBBS, MD",
    }, doctor1Token);
    await prisma.doctorProfile.update({
      where: { id: doc1ProfRes.data?.doctorProfile?.id },
      data: { verified: true },
    });

    // Register Pharmacy User 1
    const pharm1Email = `m5_pharm1_${rand}@test.com`;
    const pharm1Phone = `84${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPharm1 = await request("POST", "/api/auth/register", {
      name: `City Meds Admin ${rand}`,
      email: pharm1Email,
      phone: pharm1Phone,
      password: testPassword,
      role: "PHARMACY",
    });
    const loginPharm1 = await request("POST", "/api/auth/login", { email: pharm1Email, password: testPassword });
    const pharmacy1Token = loginPharm1.data?.token;

    // Register Pharmacy User 2
    const pharm2Email = `m5_pharm2_${rand}@test.com`;
    const pharm2Phone = `85${rand.toString().padStart(8, "0")}`.slice(0, 10);
    const regPharm2 = await request("POST", "/api/auth/register", {
      name: `Metro Meds Admin ${rand}`,
      email: pharm2Email,
      phone: pharm2Phone,
      password: testPassword,
      role: "PHARMACY",
    });
    const loginPharm2 = await request("POST", "/api/auth/login", { email: pharm2Email, password: testPassword });
    const pharmacy2Token = loginPharm2.data?.token;

    // Register Admin via direct DB seeding
    const adminEmail = `m5_admin_${rand}@test.com`;
    const adminHash = await bcrypt.hash(testPassword, 10);
    const adminUser = await prisma.user.create({
      data: {
        name: "DocTalk Admin",
        email: adminEmail,
        phone: `86${rand.toString().padStart(8, "0")}`.slice(0, 10),
        password: adminHash,
        role: "ADMIN",
      },
    });
    const loginAdmin = await request("POST", "/api/auth/login", { email: adminEmail, password: testPassword });
    const adminToken = loginAdmin.data?.token;

    assert(patient1Token && doctor1Token && pharmacy1Token && adminToken, "2. Authentication works for Patient, Doctor, Pharmacy, Admin");

    // 3. Patient cannot create pharmacy profile
    const patCreatePharm = await request("POST", "/api/pharmacy/profile", {
      pharmacyName: "Illegal Pharmacy",
      licenseNumber: `LIC-PAT-${rand}`,
      phone: "9998887771",
      addressLine1: "123 Patient St",
      city: "New York",
      state: "NY",
      country: "USA",
      postalCode: "10001",
    }, patient1Token);
    assert(patCreatePharm.status === 403, "3. Patient cannot create pharmacy profile (403)", patCreatePharm.data);

    // 4. Doctor cannot create pharmacy profile
    const docCreatePharm = await request("POST", "/api/pharmacy/profile", {
      pharmacyName: "Illegal Doctor Pharmacy",
      licenseNumber: `LIC-DOC-${rand}`,
      phone: "9998887772",
      addressLine1: "123 Doctor St",
      city: "New York",
      state: "NY",
      country: "USA",
      postalCode: "10001",
    }, doctor1Token);
    assert(docCreatePharm.status === 403, "4. Doctor cannot create pharmacy profile (403)", docCreatePharm.data);

    // 5. Pharmacy can create own profile
    const pharm1Lic = `LIC-NY-${rand}`;
    const pharm1Create = await request("POST", "/api/pharmacy/profile", {
      pharmacyName: `City Care Pharmacy ${rand}`,
      licenseNumber: pharm1Lic,
      phone: "1112223334",
      addressLine1: "456 Health Ave",
      city: "Metropolis",
      state: "NY",
      country: "USA",
      postalCode: "10002",
    }, pharmacy1Token);
    const pharmacy1ProfileId = pharm1Create.data?.pharmacyProfile?.id;
    assert(pharm1Create.status === 201 && pharm1Create.data?.pharmacyProfile?.verified === false, "5. Pharmacy can create own profile (201, verified: false)", pharm1Create.data);

    // Create Pharmacy 2 profile for cross-pharmacy tests
    const pharm2Lic = `LIC-LA-${rand}`;
    const pharm2Create = await request("POST", "/api/pharmacy/profile", {
      pharmacyName: `Metro Care Pharmacy ${rand}`,
      licenseNumber: pharm2Lic,
      phone: "1112223335",
      addressLine1: "789 Broadway",
      city: "Metropolis",
      state: "NY",
      country: "USA",
      postalCode: "10003",
    }, pharmacy2Token);
    const pharmacy2ProfileId = pharm2Create.data?.pharmacyProfile?.id;

    // 6. Duplicate pharmacy profile rejected
    const dupPharmCreate = await request("POST", "/api/pharmacy/profile", {
      pharmacyName: `Another Pharmacy ${rand}`,
      licenseNumber: `LIC-DUP-${rand}`,
      phone: "1112223339",
      addressLine1: "456 Health Ave",
      city: "Metropolis",
      state: "NY",
      country: "USA",
      postalCode: "10002",
    }, pharmacy1Token);
    assert(dupPharmCreate.status === 409, "6. Duplicate pharmacy profile rejected (409)", dupPharmCreate.data);

    // 7. Unverified pharmacy not publicly listed
    const pubList1 = await request("GET", `/api/pharmacy/all?city=Metropolis`);
    const foundUnverified = pubList1.data?.pharmacies?.some((p) => p.id === pharmacy1ProfileId);
    assert(pubList1.status === 200 && !foundUnverified, "7. Unverified pharmacy not publicly listed (hidden)", pubList1.data);

    // 8. Admin can verify pharmacy
    const verifyPharmRes = await request("PUT", `/api/admin/pharmacies/${pharmacy1ProfileId}/verify`, {}, adminToken);
    assert(verifyPharmRes.status === 200 && verifyPharmRes.data?.pharmacyProfile?.verified === true, "8. Admin can verify pharmacy (200, verified: true)", verifyPharmRes.data);

    // Also verify Pharmacy 2 for testing
    await request("PUT", `/api/admin/pharmacies/${pharmacy2ProfileId}/verify`, {}, adminToken);

    // 9. Verified pharmacy appears publicly
    const pubList2 = await request("GET", `/api/pharmacy/all?city=Metropolis`);
    const foundVerified = pubList2.data?.pharmacies?.some((p) => p.id === pharmacy1ProfileId);
    assert(pubList2.status === 200 && foundVerified, "9. Verified pharmacy appears publicly in GET /api/pharmacy/all", pubList2.data);

    // Admin creates master medicines for testing
    const medAmoxRes = await request("POST", "/api/admin/medicines", {
      name: `Amoxicillin ${rand}`,
      genericName: "Amoxicillin Trihydrate",
      brandName: `Amoxil ${rand}`,
      strength: "500mg",
      dosageForm: "CAPSULE",
      manufacturer: "GlaxoSmithKline",
      prescriptionRequired: true,
      active: true,
    }, adminToken);
    const medicineAmoxId = medAmoxRes.data?.medicine?.id;

    const medParacetamolRes = await request("POST", "/api/admin/medicines", {
      name: `Paracetamol ${rand}`,
      genericName: "Acetaminophen",
      brandName: `Calpol ${rand}`,
      strength: "500mg",
      dosageForm: "TABLET",
      manufacturer: "GSK",
      prescriptionRequired: false,
      active: true,
    }, adminToken);
    const medicineParaId = medParacetamolRes.data?.medicine?.id;

    // 10. Patient cannot modify pharmacy inventory
    const patAddInv = await request("POST", "/api/pharmacy/inventory", {
      medicineId: medicineAmoxId,
      sellingPrice: 15.5,
      stockQuantity: 100,
    }, patient1Token);
    assert(patAddInv.status === 403, "10. Patient cannot modify pharmacy inventory (403)", patAddInv.data);

    // 11. Pharmacy can create inventory
    const pharm1AddInv = await request("POST", "/api/pharmacy/inventory", {
      medicineId: medicineAmoxId,
      sku: "AMX-500",
      sellingPrice: 20.0,
      stockQuantity: 50,
    }, pharmacy1Token);
    const inv1Id = pharm1AddInv.data?.inventory?.id;
    assert(pharm1AddInv.status === 201 && pharm1AddInv.data?.inventory?.stockQuantity === 50 && pharm1AddInv.data?.inventory?.availableQuantity === 50, "11. Pharmacy can create inventory (201, stock 50)", pharm1AddInv.data);

    // Pharmacy 1 also adds Paracetamol
    await request("POST", "/api/pharmacy/inventory", {
      medicineId: medicineParaId,
      sellingPrice: 5.0,
      stockQuantity: 100,
    }, pharmacy1Token);

    // Pharmacy 2 adds Amoxicillin to its own inventory
    const pharm2AddInv = await request("POST", "/api/pharmacy/inventory", {
      medicineId: medicineAmoxId,
      sellingPrice: 22.0,
      stockQuantity: 30,
    }, pharmacy2Token);
    const inv2Id = pharm2AddInv.data?.inventory?.id;

    // 12. Pharmacy cannot modify another pharmacy inventory
    const crossPharmEdit = await request("PUT", `/api/pharmacy/inventory/${inv1Id}`, {
      sellingPrice: 99.0,
    }, pharmacy2Token);
    assert(crossPharmEdit.status === 403, "12. Pharmacy cannot modify another pharmacy inventory (403)", crossPharmEdit.data);

    // 13. Duplicate pharmacy+medicine inventory rejected
    const dupInv = await request("POST", "/api/pharmacy/inventory", {
      medicineId: medicineAmoxId,
      sellingPrice: 25.0,
      stockQuantity: 10,
    }, pharmacy1Token);
    assert(dupInv.status === 409, "13. Duplicate pharmacy+medicine inventory rejected (409)", dupInv.data);

    // 14. Medicine search returns active medicines
    const medSearch = await request("GET", `/api/medicine/search?name=Amoxicillin%20${rand}`);
    assert(medSearch.status === 200 && medSearch.data?.medicines?.some((m) => m.id === medicineAmoxId), "14. Medicine search returns active medicines (200)", medSearch.data);

    // 15. Inactive medicines hidden
    const inactiveMed = await request("POST", "/api/admin/medicines", {
      name: `Banned Drug ${rand}`,
      dosageForm: "TABLET",
      active: false,
    }, adminToken);
    const inactiveSearch = await request("GET", `/api/medicine/search?name=Banned%20Drug%20${rand}`);
    assert(inactiveSearch.status === 200 && !inactiveSearch.data?.medicines?.some((m) => m.id === inactiveMed.data?.medicine?.id), "15. Inactive medicines hidden from public search (filtered out)", inactiveSearch.data);

    // Create confirmed appointment for Patient 1 with Doctor 1
    const apptDate = new Date(Date.now() + 86400000 * 3);
    const confirmedAppt = await prisma.appointment.create({
      data: {
        patientId: patient1Id,
        doctorId: doctor1Id,
        appointmentDate: apptDate,
        symptoms: "Bacterial respiratory infection",
        status: "CONFIRMED",
      },
    });
    const appointmentId = confirmedAppt.id;

    // Doctor creates DRAFT prescription
    const draftPrescRes = await request("POST", "/api/prescriptions", {
      appointmentId,
      diagnosis: "Acute Bronchitis",
      status: "DRAFT",
      items: [
        {
          medicineName: `Amoxicillin ${rand}`,
          dosage: "1 capsule",
          frequency: "3 times daily",
          duration: 5,
          durationUnit: "DAYS",
          quantity: 15,
        },
      ],
    }, doctor1Token);
    const prescriptionId = draftPrescRes.data?.prescription?.id;

    // 19. Patient cannot order from DRAFT prescription
    const draftOrderRes = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: medicineAmoxId, quantity: 10 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(draftOrderRes.status === 400 && draftOrderRes.data?.message?.includes("ISSUED"), "19. Patient cannot order from DRAFT prescription (400)", draftOrderRes.data);

    // Doctor issues prescription
    await request("POST", `/api/prescriptions/${prescriptionId}/issue`, {}, doctor1Token);

    // 16. Patient cannot order from unverified pharmacy
    const unverifiedPharmUser = await request("POST", "/api/auth/register", {
      name: `Shady Meds ${rand}`,
      email: `m5_unver_${rand}@test.com`,
      phone: `87${rand.toString().padStart(8, "0")}`.slice(0, 10),
      password: testPassword,
      role: "PHARMACY",
    });
    const loginUnver = await request("POST", "/api/auth/login", { email: `m5_unver_${rand}@test.com`, password: testPassword });
    const unverProf = await request("POST", "/api/pharmacy/profile", {
      pharmacyName: `Unverified Care ${rand}`,
      licenseNumber: `LIC-UNV-${rand}`,
      phone: "9991112223",
      addressLine1: "Unverified Ave",
      city: "Metropolis",
      state: "NY",
      country: "USA",
      postalCode: "10001",
    }, loginUnver.data?.token);
    const unverifiedPharmId = unverProf.data?.pharmacyProfile?.id;

    const unverifiedOrderRes = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: unverifiedPharmId,
      items: [{ medicineId: medicineAmoxId, quantity: 5 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(unverifiedOrderRes.status === 400 && unverifiedOrderRes.data?.message?.includes("not verified"), "16. Patient cannot order from unverified pharmacy (400)", unverifiedOrderRes.data);

    // 17. Patient cannot order from inactive pharmacy
    await prisma.pharmacyProfile.update({
      where: { id: unverifiedPharmId },
      data: { verified: true, active: false },
    });
    const inactiveOrderRes = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: unverifiedPharmId,
      items: [{ medicineId: medicineAmoxId, quantity: 5 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(inactiveOrderRes.status === 400 && inactiveOrderRes.data?.message?.includes("inactive"), "17. Patient cannot order from inactive pharmacy (400)", inactiveOrderRes.data);

    // 18. Patient cannot order using another patient's prescription
    const pat2OrderOtherRx = await request("POST", "/api/orders", {
      prescriptionId, // belongs to patient 1
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: medicineAmoxId, quantity: 5 }],
      delivery: {
        name: "Jane Doe",
        phone: "5559876543",
        addressLine1: "789 Maple St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient2Token);
    assert(pat2OrderOtherRx.status === 403, "18. Patient cannot order using another patient's prescription (403)", pat2OrderOtherRx.data);

    // 21. Invalid medicine not allowed
    const invalidMedOrder = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: "invalid-med-id-123", quantity: 5 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(invalidMedOrder.status === 400, "21. Invalid medicine not allowed (400)", invalidMedOrder.data);

    // 22. Medicine not in prescription not allowed (create another Rx-required drug)
    const otherRxMed = await request("POST", "/api/admin/medicines", {
      name: `Ciprofloxacin ${rand}`,
      dosageForm: "TABLET",
      prescriptionRequired: true,
      active: true,
    }, adminToken);
    await request("POST", "/api/pharmacy/inventory", {
      medicineId: otherRxMed.data?.medicine?.id,
      sellingPrice: 30.0,
      stockQuantity: 50,
    }, pharmacy1Token);

    const unprescribedMedOrder = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: otherRxMed.data?.medicine?.id, quantity: 5 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(unprescribedMedOrder.status === 400 && unprescribedMedOrder.data?.message?.includes("requires a prescription"), "22. Medicine not in prescription not allowed (400)", unprescribedMedOrder.data);

    // 23. Quantity above prescription limit rejected (prescribed is 15, request 20)
    const overQtyOrder = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: medicineAmoxId, quantity: 20 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(overQtyOrder.status === 400 && overQtyOrder.data?.message?.includes("exceeds prescribed limit"), "23. Quantity above prescription limit rejected (400)", overQtyOrder.data);

    // 24. Insufficient inventory rejected (set stock to 2)
    const tightMed = await request("POST", "/api/admin/medicines", {
      name: `Tight Stock Med ${rand}`,
      dosageForm: "TABLET",
      prescriptionRequired: false,
      active: true,
    }, adminToken);
    await request("POST", "/api/pharmacy/inventory", {
      medicineId: tightMed.data?.medicine?.id,
      sellingPrice: 10.0,
      stockQuantity: 2,
    }, pharmacy1Token);

    const tightOrder = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: tightMed.data?.medicine?.id, quantity: 5 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    assert(tightOrder.status === 409 && tightOrder.data?.message?.includes("Insufficient stock"), "24. Insufficient inventory rejected (409)", tightOrder.data);

    // 20. Patient can create valid prescription-based order
    // 35. Server calculates totals correctly
    // 36. Client cannot manipulate price
    const validOrderRes = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: medicineAmoxId, quantity: 10 }],
      subtotal: 1.0, // Client tries to forge low price
      totalAmount: 1.0,
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    const order1 = validOrderRes.data?.order;
    const order1Id = order1?.id;
    assert(validOrderRes.status === 201 && order1Id, "20. Patient can create valid prescription-based order (201)", validOrderRes.data);

    // Verify calculated totals: unitPrice was 20.0, quantity 10 -> subtotal 200.0, deliveryFee 50.0 -> totalAmount 250.0
    assert(order1.subtotal === 200.0 && order1.deliveryFee === 50.0 && order1.totalAmount === 250.0, "35. Server calculates totals correctly (subtotal: 200, fee: 50, total: 250)", order1);
    assert(order1.subtotal !== 1.0 && order1.totalAmount !== 1.0, "36. Client cannot manipulate price (forged amounts ignored)", order1);

    // 25. Stock reservation is atomic
    const invAfterOrder = await prisma.inventory.findUnique({
      where: { id: inv1Id },
    });
    assert(invAfterOrder.reservedQuantity === 10 && invAfterOrder.stockQuantity === 50, "25. Stock reservation is atomic (stock 50, reserved 10)", invAfterOrder);

    // 26. Duplicate concurrent orders cannot oversell stock
    // Create a special test medicine with stock = 10
    const concMed = await request("POST", "/api/admin/medicines", {
      name: `Concurrent Test Med ${rand}`,
      dosageForm: "TABLET",
      prescriptionRequired: false,
      active: true,
    }, adminToken);
    const concInv = await request("POST", "/api/pharmacy/inventory", {
      medicineId: concMed.data?.medicine?.id,
      sellingPrice: 10.0,
      stockQuantity: 10,
    }, pharmacy1Token);

    // Fire 3 simultaneous orders each asking for 5 items (5 * 3 = 15 > 10)
    // Exactly 2 must succeed (5 + 5 = 10), and 1 must fail with 409
    const concurrentRequests = [1, 2, 3].map(() =>
      request("POST", "/api/orders", {
        prescriptionId,
        pharmacyId: pharmacy1ProfileId,
        items: [{ medicineId: concMed.data?.medicine?.id, quantity: 5 }],
        delivery: {
          name: "Concurrent Buyer",
          phone: "5550001111",
          addressLine1: "123 Fast Lane",
          city: "Metropolis",
          state: "NY",
          country: "USA",
          postalCode: "10001",
        },
      }, patient1Token)
    );

    const concurrentResults = await Promise.all(concurrentRequests);
    const successCount = concurrentResults.filter((r) => r.status === 201).length;
    const conflictCount = concurrentResults.filter((r) => r.status === 409).length;
    assert(successCount === 2 && conflictCount === 1, `26. Duplicate concurrent orders cannot oversell stock (Success: ${successCount}, Conflicts: ${conflictCount})`, concurrentResults.map((r) => r.status));

    // Check DB inventory to confirm reservedQuantity is exactly 10 and stock is 10
    const concInvInDb = await prisma.inventory.findUnique({
      where: { id: concInv.data?.inventory?.id },
    });
    assert(concInvInDb.reservedQuantity === 10 && concInvInDb.stockQuantity === 10, "26b. Database reservedQuantity perfectly matches capacity (10/10)", concInvInDb);

    // 27. Patient can view own orders
    const myOrdersRes = await request("GET", "/api/orders/my-orders", null, patient1Token);
    assert(myOrdersRes.status === 200 && myOrdersRes.data?.orders?.some((o) => o.id === order1Id), "27. Patient can view own orders (200)", myOrdersRes.data);

    // 28. Other patient cannot view order
    const pat2ViewOrder = await request("GET", `/api/orders/${order1Id}`, null, patient2Token);
    assert(pat2ViewOrder.status === 403, "28. Other patient cannot view order (403)", pat2ViewOrder.data);

    // 29. Pharmacy can view own orders
    const pharmOrdersRes = await request("GET", "/api/orders/pharmacy", null, pharmacy1Token);
    assert(pharmOrdersRes.status === 200 && pharmOrdersRes.data?.orders?.some((o) => o.id === order1Id), "29. Pharmacy can view own incoming orders (200)", pharmOrdersRes.data);

    // 30. Other pharmacy cannot view order
    const pharm2ViewOrder = await request("GET", `/api/orders/${order1Id}`, null, pharmacy2Token);
    assert(pharm2ViewOrder.status === 403, "30. Other pharmacy cannot view order (403)", pharm2ViewOrder.data);

    // 31. Pharmacy can update valid order status
    // Sequence: PENDING -> ACCEPTED -> PACKED -> OUT_FOR_DELIVERY -> DELIVERED
    const accRes = await request("PUT", `/api/orders/${order1Id}/status`, { status: "ACCEPTED" }, pharmacy1Token);
    assert(accRes.status === 200 && accRes.data?.order?.status === "ACCEPTED", "31a. Order moved to ACCEPTED (200)", accRes.data);

    const packRes = await request("PUT", `/api/orders/${order1Id}/status`, { status: "PACKED" }, pharmacy1Token);
    assert(packRes.status === 200 && packRes.data?.order?.status === "PACKED", "31b. Order moved to PACKED (200)", packRes.data);

    const outRes = await request("PUT", `/api/orders/${order1Id}/status`, { status: "OUT_FOR_DELIVERY" }, pharmacy1Token);
    assert(outRes.status === 200 && outRes.data?.order?.status === "OUT_FOR_DELIVERY", "31c. Order moved to OUT_FOR_DELIVERY (200)", outRes.data);

    const delivRes = await request("PUT", `/api/orders/${order1Id}/status`, { status: "DELIVERED" }, pharmacy1Token);
    assert(delivRes.status === 200 && delivRes.data?.order?.status === "DELIVERED", "31d. Order moved to DELIVERED (200)", delivRes.data);

    // Stock consumption check upon DELIVERY: stock was 50, reserved was 10 -> stock should now be 40, reserved 0
    const invAfterDeliv = await prisma.inventory.findUnique({
      where: { id: inv1Id },
    });
    assert(invAfterDeliv.stockQuantity === 40 && invAfterDeliv.reservedQuantity === 0, "31e. Stock consumed upon delivery (stock 40, reserved 0)", invAfterDeliv);

    // 32. Invalid order status transition rejected (cannot move DELIVERED -> PENDING, or DELIVERED -> CANCELLED)
    const invTrans1 = await request("PUT", `/api/orders/${order1Id}/status`, { status: "PENDING" }, pharmacy1Token);
    assert(invTrans1.status === 400, "32a. Invalid transition DELIVERED -> PENDING rejected (400)", invTrans1.data);

    const invTrans2 = await request("PUT", `/api/orders/${order1Id}/status`, { status: "CANCELLED" }, pharmacy1Token);
    assert(invTrans2.status === 400, "32b. Invalid transition DELIVERED -> CANCELLED rejected (400)", invTrans2.data);

    // 34. Delivered order cannot be cancelled by patient
    const patCancelDelivered = await request("PUT", `/api/orders/${order1Id}/cancel`, {}, patient1Token);
    assert(patCancelDelivered.status === 400 && patCancelDelivered.data?.message?.includes("DELIVERED"), "34. Delivered order cannot be cancelled by patient (400)", patCancelDelivered.data);

    // 33. Cancel/reject releases reserved stock correctly
    // Patient creates Order 2 (5 items of Paracetamol, stock 100)
    const order2Res = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: medicineParaId, quantity: 5 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    const order2Id = order2Res.data?.order?.id;

    // Check reserved stock was incremented to 5
    const paraInvBeforeCancel = await prisma.inventory.findUnique({
      where: {
        pharmacyId_medicineId: {
          pharmacyId: pharmacy1ProfileId,
          medicineId: medicineParaId,
        },
      },
    });
    assert(paraInvBeforeCancel.reservedQuantity === 5, "33a. Reserved stock is 5 for Order 2", paraInvBeforeCancel);

    // Patient cancels Order 2
    const cancelOrder2Res = await request("PUT", `/api/orders/${order2Id}/cancel`, {}, patient1Token);
    assert(cancelOrder2Res.status === 200 && cancelOrder2Res.data?.order?.status === "CANCELLED", "33b. Patient cancels PENDING order (200, CANCELLED)", cancelOrder2Res.data);

    // Check reserved stock was released back to 0
    const paraInvAfterCancel = await prisma.inventory.findUnique({
      where: {
        pharmacyId_medicineId: {
          pharmacyId: pharmacy1ProfileId,
          medicineId: medicineParaId,
        },
      },
    });
    assert(paraInvAfterCancel.reservedQuantity === 0 && paraInvAfterCancel.stockQuantity === 100, "33c. Reserved stock safely released to 0 upon cancellation", paraInvAfterCancel);

    // Now test Pharmacy Rejection releases stock
    const order3Res = await request("POST", "/api/orders", {
      prescriptionId,
      pharmacyId: pharmacy1ProfileId,
      items: [{ medicineId: medicineParaId, quantity: 8 }],
      delivery: {
        name: "John Doe",
        phone: "5551234567",
        addressLine1: "123 Elm St",
        city: "Metropolis",
        state: "NY",
        country: "USA",
        postalCode: "10001",
      },
    }, patient1Token);
    const order3Id = order3Res.data?.order?.id;

    // Pharmacy rejects Order 3
    const rejectOrder3Res = await request("PUT", `/api/orders/${order3Id}/status`, { status: "REJECTED" }, pharmacy1Token);
    assert(rejectOrder3Res.status === 200 && rejectOrder3Res.data?.order?.status === "REJECTED", "33d. Pharmacy rejects PENDING order (200, REJECTED)", rejectOrder3Res.data);

    const paraInvAfterReject = await prisma.inventory.findUnique({
      where: {
        pharmacyId_medicineId: {
          pharmacyId: pharmacy1ProfileId,
          medicineId: medicineParaId,
        },
      },
    });
    assert(paraInvAfterReject.reservedQuantity === 0 && paraInvAfterReject.stockQuantity === 100, "33e. Reserved stock safely released to 0 upon pharmacy rejection", paraInvAfterReject);

    // 37. Audit events recorded
    const pharmAuditCount = await prisma.pharmacyAuditLog.count({
      where: { pharmacyId: pharmacy1ProfileId },
    });
    const orderAuditCount = await prisma.orderAuditLog.count({
      where: { orderId: order1Id },
    });
    assert(pharmAuditCount >= 2, `37a. Pharmacy audit events recorded (${pharmAuditCount} events found)`, { pharmAuditCount });
    assert(orderAuditCount >= 4, `37b. Order audit events recorded (${orderAuditCount} events found for order 1)`, { orderAuditCount });

    console.log(`\n=== MILESTONE 5 SUITE RESULT: ${passed} PASSED, ${failed} FAILED ===\n`);
    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error("Milestone 5 Test Error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runMilestone5Tests();
