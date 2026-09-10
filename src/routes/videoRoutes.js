const express = require("express");
const videoController = require("../controllers/videoController");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

// All video consultation routes require JWT authentication and are restricted strictly to PATIENT and DOCTOR
// (Pharmacy and Admin roles have no access to private consultation sessions)
router.use(authMiddleware);
router.use(authorizeRoles("PATIENT", "DOCTOR"));

// Session Lifecycle
router.post("/sessions", videoController.createSession);
router.get("/sessions/:sessionId", videoController.getSessionById);
router.post("/sessions/:sessionId/join", videoController.joinSession);
router.post("/sessions/:sessionId/leave", videoController.leaveSession);
router.post("/sessions/:sessionId/end", videoController.endSession);

// ICE Configuration
router.get("/sessions/:sessionId/ice-servers", videoController.getIceServers);

// Signaling Endpoints
router.post("/sessions/:sessionId/signaling/offer", videoController.submitOffer);
router.get("/sessions/:sessionId/signaling/offer", videoController.getOffer);
router.post("/sessions/:sessionId/signaling/answer", videoController.submitAnswer);
router.get("/sessions/:sessionId/signaling/answer", videoController.getAnswer);
router.post("/sessions/:sessionId/signaling/ice", videoController.submitIceCandidate);
router.get("/sessions/:sessionId/signaling/ice", videoController.getIceCandidates);

module.exports = router;
