const path = require("path");
const crypto = require("crypto");
const prisma = require("../../config/prisma");
const { logChatAction } = require("../auditService");
const {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteS3Object,
} = require("../s3Service");

const MAX_MESSAGE_LENGTH = 5000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB
const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const ALLOWED_MIME_TYPES = {
  "application/pdf": [".pdf"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
};

// WebSocket / event hooks for real-time delivery
const realTimeHooks = {
  onMessageCreated: (message) => {},
  onMessageUpdated: (message) => {},
  onMessageDeleted: (messageId) => {},
  onMessageRead: (conversationId, userId) => {},
};

const toSafeMessage = (message) => {
  if (!message) return null;

  const isDeleted = Boolean(message.deletedAt);

  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    messageType: message.messageType,
    content: isDeleted ? "[Message deleted]" : message.content,
    attachmentId: isDeleted ? null : message.attachmentId,
    replyToMessageId: message.replyToMessageId,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
    deletedAt: message.deletedAt,
    sender: message.sender
      ? {
          id: message.sender.id,
          name: message.sender.name,
          role: message.sender.role,
        }
      : undefined,
    replyToMessage:
      message.replyToMessage && !isDeleted
        ? {
            id: message.replyToMessage.id,
            senderId: message.replyToMessage.senderId,
            content: message.replyToMessage.deletedAt
              ? "[Message deleted]"
              : message.replyToMessage.content,
          }
        : undefined,
    attachment:
      message.attachment && !isDeleted
        ? {
            id: message.attachment.id,
            fileName: message.attachment.fileName,
            fileSize: message.attachment.fileSize,
            mimeType: message.attachment.mimeType,
            uploadStatus: message.attachment.uploadStatus,
          }
        : undefined,
  };
};

/**
 * Validates whether a user is an active participant in a conversation.
 */
const verifyParticipant = async (conversationId, userId) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
  });

  if (!conversation) {
    const error = new Error("Conversation not found");
    error.statusCode = 404;
    throw error;
  }

  if (conversation.patientId !== userId && conversation.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this conversation");
    error.statusCode = 403;
    throw error;
  }

  return conversation;
};

/**
 * Send a new message (TEXT or ATTACHMENT).
 */
const sendMessage = async ({
  conversationId,
  senderId,
  content = null,
  attachmentId = null,
  replyToMessageId = null,
  messageType = null,
  ipAddress = null,
  userAgent = null,
}) => {
  const conversation = await verifyParticipant(conversationId, senderId);

  // Validate input: must have either content or attachmentId
  const cleanContent = content && typeof content === "string" ? content.trim() : null;

  if (!cleanContent && !attachmentId) {
    const error = new Error("Message must contain text content or an attachment");
    error.statusCode = 400;
    throw error;
  }

  if (cleanContent && cleanContent.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(`Message content exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters`);
    error.statusCode = 400;
    throw error;
  }

  // Validate reply-to message if specified
  if (replyToMessageId) {
    const replyTarget = await prisma.message.findUnique({
      where: { id: replyToMessageId },
    });
    if (!replyTarget || replyTarget.conversationId !== conversation.id) {
      const error = new Error("Referenced replyToMessage does not exist in this conversation");
      error.statusCode = 400;
      throw error;
    }
  }

  // Validate attachment if specified
  let attachment = null;
  if (attachmentId) {
    attachment = await prisma.chatAttachment.findUnique({
      where: { id: attachmentId },
    });
    if (!attachment || attachment.conversationId !== conversation.id) {
      const error = new Error("Referenced attachment does not belong to this conversation");
      error.statusCode = 400;
      throw error;
    }
    if (attachment.uploadStatus !== "UPLOADED") {
      const error = new Error("Attachment upload has not been completed");
      error.statusCode = 400;
      throw error;
    }
    if (attachment.uploaderId !== senderId) {
      const error = new Error("Access forbidden: you cannot attach a file uploaded by another user");
      error.statusCode = 403;
      throw error;
    }
  }

  const determinedType = messageType || (attachmentId ? "ATTACHMENT" : "TEXT");

  const message = await prisma.$transaction(async (tx) => {
    const now = new Date();

    const created = await tx.message.create({
      data: {
        conversationId: conversation.id,
        senderId,
        content: cleanContent,
        attachmentId: attachment?.id || null,
        replyToMessageId: replyToMessageId || null,
        messageType: determinedType,
      },
      include: {
        sender: true,
        replyToMessage: true,
        attachment: true,
      },
    });

    // Update conversation lastMessageAt
    await tx.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now },
    });

    // Update sender's read state to current message
    await tx.conversationRead.upsert({
      where: {
        conversationId_userId: {
          conversationId: conversation.id,
          userId: senderId,
        },
      },
      update: {
        lastReadMessageId: created.id,
        lastReadAt: now,
      },
      create: {
        conversationId: conversation.id,
        userId: senderId,
        lastReadMessageId: created.id,
        lastReadAt: now,
      },
    });

    return created;
  });

  await logChatAction({
    conversationId: conversation.id,
    messageId: message.id,
    userId: senderId,
    action: "MESSAGE_SENT",
    ipAddress,
    userAgent,
    metadata: {
      messageType: determinedType,
      hasAttachment: Boolean(attachmentId),
    },
  });

  const safeMsg = toSafeMessage(message);
  realTimeHooks.onMessageCreated(safeMsg);

  return safeMsg;
};

/**
 * Retrieve paginated message history for a conversation.
 */
const listMessages = async ({
  conversationId,
  userId,
  page = 1,
  limit = 50,
}) => {
  await verifyParticipant(conversationId, userId);

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
  const skip = (pageNum - 1) * limitNum;

  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where: { conversationId },
      include: {
        sender: true,
        replyToMessage: true,
        attachment: true,
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      skip,
      take: limitNum,
    }),
    prisma.message.count({ where: { conversationId } }),
  ]);

  return {
    messages: messages.map(toSafeMessage),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

/**
 * Edit an existing text message within 15 minutes of sending.
 */
const editMessage = async ({
  messageId,
  userId,
  content,
  ipAddress = null,
  userAgent = null,
}) => {
  if (!content || typeof content !== "string" || !content.trim()) {
    const error = new Error("Updated message content is required");
    error.statusCode = 400;
    throw error;
  }

  const cleanContent = content.trim();
  if (cleanContent.length > MAX_MESSAGE_LENGTH) {
    const error = new Error(`Message content exceeds maximum allowed length of ${MAX_MESSAGE_LENGTH} characters`);
    error.statusCode = 400;
    throw error;
  }

  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: { conversation: true },
  });

  if (!message) {
    const error = new Error("Message not found");
    error.statusCode = 404;
    throw error;
  }

  // Only the original sender may edit
  if (message.senderId !== userId) {
    const error = new Error("Access forbidden: you can only edit your own messages");
    error.statusCode = 403;
    throw error;
  }

  if (message.deletedAt) {
    const error = new Error("Cannot edit a deleted message");
    error.statusCode = 400;
    throw error;
  }

  if (message.messageType !== "TEXT") {
    const error = new Error("Only text messages can be edited");
    error.statusCode = 400;
    throw error;
  }

  // 15-minute edit window
  const elapsed = Date.now() - new Date(message.createdAt).getTime();
  if (elapsed > EDIT_WINDOW_MS) {
    const error = new Error("Message can only be edited within 15 minutes of sending");
    error.statusCode = 400;
    throw error;
  }

  const updated = await prisma.message.update({
    where: { id: message.id },
    data: { content: cleanContent },
    include: {
      sender: true,
      replyToMessage: true,
      attachment: true,
    },
  });

  await logChatAction({
    conversationId: message.conversationId,
    messageId: message.id,
    userId,
    action: "MESSAGE_EDITED",
    ipAddress,
    userAgent,
  });

  const safeMsg = toSafeMessage(updated);
  realTimeHooks.onMessageUpdated(safeMsg);

  return safeMsg;
};

/**
 * Soft delete a message.
 */
const deleteMessage = async ({
  messageId,
  userId,
  ipAddress = null,
  userAgent = null,
}) => {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
  });

  if (!message) {
    const error = new Error("Message not found");
    error.statusCode = 404;
    throw error;
  }

  // Only original sender may delete
  if (message.senderId !== userId) {
    const error = new Error("Access forbidden: you can only delete your own messages");
    error.statusCode = 403;
    throw error;
  }

  if (message.deletedAt) {
    return { message: "Message already deleted" };
  }

  await prisma.message.update({
    where: { id: message.id },
    data: { deletedAt: new Date() },
  });

  await logChatAction({
    conversationId: message.conversationId,
    messageId: message.id,
    userId,
    action: "MESSAGE_DELETED",
    ipAddress,
    userAgent,
  });

  realTimeHooks.onMessageDeleted(message.id);

  return { message: "Message deleted successfully" };
};

/**
 * Mark a conversation as read.
 */
const markConversationRead = async ({
  conversationId,
  userId,
  lastReadMessageId = null,
  ipAddress = null,
  userAgent = null,
}) => {
  const conversation = await verifyParticipant(conversationId, userId);

  let targetMessageId = lastReadMessageId;
  if (!targetMessageId) {
    const latestMessage = await prisma.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
    });
    targetMessageId = latestMessage?.id || null;
  }

  const now = new Date();

  await prisma.conversationRead.upsert({
    where: {
      conversationId_userId: {
        conversationId: conversation.id,
        userId,
      },
    },
    update: {
      lastReadMessageId: targetMessageId,
      lastReadAt: now,
    },
    create: {
      conversationId: conversation.id,
      userId,
      lastReadMessageId: targetMessageId,
      lastReadAt: now,
    },
  });

  await logChatAction({
    conversationId: conversation.id,
    userId,
    action: "MESSAGE_READ",
    ipAddress,
    userAgent,
    metadata: { lastReadMessageId: targetMessageId },
  });

  realTimeHooks.onMessageRead(conversation.id, userId);

  return { message: "Conversation marked as read" };
};

/**
 * Request S3 Presigned Upload URL for a chat attachment.
 */
const createAttachmentUploadUrl = async ({
  conversationId,
  userId,
  fileName,
  mimeType,
  fileSize,
  ipAddress = null,
  userAgent = null,
}) => {
  const conversation = await verifyParticipant(conversationId, userId);

  if (!fileName || typeof fileName !== "string" || !fileName.trim()) {
    const error = new Error("fileName is required");
    error.statusCode = 400;
    throw error;
  }

  if (!mimeType || !ALLOWED_MIME_TYPES[mimeType]) {
    const error = new Error(
      `Invalid mimeType. Allowed: ${Object.keys(ALLOWED_MIME_TYPES).join(", ")}`
    );
    error.statusCode = 400;
    throw error;
  }

  const parsedSize = parseInt(fileSize, 10);
  if (isNaN(parsedSize) || parsedSize <= 0 || parsedSize > MAX_ATTACHMENT_SIZE) {
    const error = new Error("fileSize must be greater than 0 and less than or equal to 10 MB");
    error.statusCode = 400;
    throw error;
  }

  const cleanBaseName = path.basename(fileName.trim());
  const ext = path.extname(cleanBaseName).toLowerCase();
  const allowedExts = ALLOWED_MIME_TYPES[mimeType];

  if (!allowedExts.includes(ext)) {
    const error = new Error(`File extension "${ext}" does not match declared MIME type "${mimeType}"`);
    error.statusCode = 400;
    throw error;
  }

  // Generate server-controlled private S3 key
  const randomHex = crypto.randomBytes(16).toString("hex");
  const s3Key = `chat-attachments/${conversation.id}/${randomHex}${ext}`;

  const attachment = await prisma.chatAttachment.create({
    data: {
      conversationId: conversation.id,
      uploaderId: userId,
      fileName: cleanBaseName,
      fileSize: parsedSize,
      mimeType,
      s3Key,
      uploadStatus: "PENDING",
    },
  });

  const uploadUrl = await getPresignedUploadUrl(s3Key, mimeType, 900);

  await logChatAction({
    conversationId: conversation.id,
    userId,
    action: "ATTACHMENT_REQUESTED",
    ipAddress,
    userAgent,
    metadata: {
      attachmentId: attachment.id,
      fileName: cleanBaseName,
      fileSize: parsedSize,
      mimeType,
    },
  });

  return {
    attachmentId: attachment.id,
    uploadUrl,
    s3Key,
    expiresIn: 900,
  };
};

/**
 * Complete an attachment upload.
 */
const completeAttachmentUpload = async ({
  attachmentId,
  userId,
  ipAddress = null,
  userAgent = null,
}) => {
  const attachment = await prisma.chatAttachment.findUnique({
    where: { id: attachmentId },
  });

  if (!attachment) {
    const error = new Error("Attachment not found");
    error.statusCode = 404;
    throw error;
  }

  if (attachment.uploaderId !== userId) {
    const error = new Error("Access forbidden: you can only complete your own uploads");
    error.statusCode = 403;
    throw error;
  }

  const updated = await prisma.chatAttachment.update({
    where: { id: attachment.id },
    data: { uploadStatus: "UPLOADED" },
  });

  await logChatAction({
    conversationId: attachment.conversationId,
    userId,
    action: "ATTACHMENT_UPLOADED",
    ipAddress,
    userAgent,
    metadata: { attachmentId: attachment.id },
  });

  return {
    id: updated.id,
    conversationId: updated.conversationId,
    fileName: updated.fileName,
    fileSize: updated.fileSize,
    mimeType: updated.mimeType,
    uploadStatus: updated.uploadStatus,
  };
};

/**
 * Get presigned download URL for an authorized conversation participant.
 */
const getAttachmentDownloadUrl = async ({
  attachmentId,
  userId,
  ipAddress = null,
  userAgent = null,
}) => {
  const attachment = await prisma.chatAttachment.findUnique({
    where: { id: attachmentId },
    include: { conversation: true },
  });

  if (!attachment) {
    const error = new Error("Attachment not found");
    error.statusCode = 404;
    throw error;
  }

  // Must be a conversation participant
  const conv = attachment.conversation;
  if (conv.patientId !== userId && conv.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this conversation");
    error.statusCode = 403;
    throw error;
  }

  if (attachment.uploadStatus !== "UPLOADED") {
    const error = new Error("Attachment is not in UPLOADED state");
    error.statusCode = 400;
    throw error;
  }

  const downloadUrl = await getPresignedDownloadUrl(attachment.s3Key, attachment.fileName, 900);

  await logChatAction({
    conversationId: conv.id,
    userId,
    action: "ATTACHMENT_REQUESTED",
    ipAddress,
    userAgent,
    metadata: { attachmentId: attachment.id, download: true },
  });

  return {
    downloadUrl,
    expiresIn: 900,
    fileName: attachment.fileName,
    mimeType: attachment.mimeType,
    fileSize: attachment.fileSize,
  };
};

/**
 * Delete attachment.
 */
const deleteAttachment = async ({
  attachmentId,
  userId,
  ipAddress = null,
  userAgent = null,
}) => {
  const attachment = await prisma.chatAttachment.findUnique({
    where: { id: attachmentId },
  });

  if (!attachment) {
    const error = new Error("Attachment not found");
    error.statusCode = 404;
    throw error;
  }

  if (attachment.uploaderId !== userId) {
    const error = new Error("Access forbidden: you can only delete your own attachments");
    error.statusCode = 403;
    throw error;
  }

  await deleteS3Object(attachment.s3Key);

  await prisma.chatAttachment.delete({
    where: { id: attachment.id },
  });

  await logChatAction({
    conversationId: attachment.conversationId,
    userId,
    action: "ATTACHMENT_DELETED",
    ipAddress,
    userAgent,
    metadata: { attachmentId: attachment.id },
  });

  return { message: "Attachment deleted successfully" };
};

module.exports = {
  sendMessage,
  listMessages,
  editMessage,
  deleteMessage,
  markConversationRead,
  createAttachmentUploadUrl,
  completeAttachmentUpload,
  getAttachmentDownloadUrl,
  deleteAttachment,
  toSafeMessage,
  verifyParticipant,
  realTimeHooks,
  MAX_MESSAGE_LENGTH,
  MAX_ATTACHMENT_SIZE,
};
