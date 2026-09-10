const express = require("express");
const chatController = require("../controllers/chatController");
const authMiddleware = require("../middleware/authMiddleware");
const { authorizeRoles } = require("../middleware/authMiddleware");

const router = express.Router();

// All chat routes require JWT authentication and are restricted exclusively to PATIENT and DOCTOR
// (Pharmacy and Admin have no chat access)
router.use(authMiddleware);
router.use(authorizeRoles("PATIENT", "DOCTOR"));

// Unread count (across all conversations)
router.get("/unread-count", chatController.getUnreadCount);

// Conversation management
router.post("/conversations", chatController.createConversation);
router.get("/conversations", chatController.getMyConversations);
router.get("/conversations/:id", chatController.getConversationById);

// Messaging endpoints
router.post("/conversations/:id/messages", chatController.sendMessage);
router.get("/conversations/:id/messages", chatController.listMessages);
router.put("/messages/:id", chatController.editMessage);
router.delete("/messages/:id", chatController.deleteMessage);

// Read state
router.post("/conversations/:id/read", chatController.markConversationRead);

// Secure S3 attachment endpoints
router.post("/conversations/:id/attachments/upload-url", chatController.createAttachmentUploadUrl);
router.post("/attachments/:id/complete-upload", chatController.completeAttachmentUpload);
router.get("/attachments/:id/download-url", chatController.getAttachmentDownloadUrl);
router.delete("/attachments/:id", chatController.deleteAttachment);

module.exports = router;
