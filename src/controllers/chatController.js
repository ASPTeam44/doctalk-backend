const conversationService = require("../services/chat/conversationService");
const messageService = require("../services/chat/messageService");

const createConversation = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { appointmentId } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await conversationService.getOrCreateConversation({
      appointmentId,
      userId,
      ipAddress,
      userAgent,
    });

    const statusCode = result.isNew ? 201 : 200;
    res.status(statusCode).json({
      message: result.isNew ? "Conversation created successfully" : "Existing conversation retrieved",
      conversation: result.conversation,
    });
  } catch (error) {
    next(error);
  }
};

const getMyConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;
    const { page, limit } = req.query;

    const result = await conversationService.listUserConversations({
      userId,
      role,
      page,
      limit,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getConversationById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const conversation = await conversationService.getConversationById({
      conversationId: id,
      userId,
      userRole,
    });

    res.status(200).json({ conversation });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { id: conversationId } = req.params;
    const senderId = req.user.id;
    const { content, attachmentId, replyToMessageId, messageType } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const message = await messageService.sendMessage({
      conversationId,
      senderId,
      content,
      attachmentId,
      replyToMessageId,
      messageType,
      ipAddress,
      userAgent,
    });

    res.status(201).json({
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    next(error);
  }
};

const listMessages = async (req, res, next) => {
  try {
    const { id: conversationId } = req.params;
    const userId = req.user.id;
    const { page, limit } = req.query;

    const result = await messageService.listMessages({
      conversationId,
      userId,
      page,
      limit,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const editMessage = async (req, res, next) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user.id;
    const { content } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const updated = await messageService.editMessage({
      messageId,
      userId,
      content,
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      message: "Message edited successfully",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

const deleteMessage = async (req, res, next) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user.id;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await messageService.deleteMessage({
      messageId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const markConversationRead = async (req, res, next) => {
  try {
    const { id: conversationId } = req.params;
    const userId = req.user.id;
    const { lastReadMessageId } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await messageService.markConversationRead({
      conversationId,
      userId,
      lastReadMessageId,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getUnreadCount = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    const result = await conversationService.getUserTotalUnreadCount({
      userId,
      role,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const createAttachmentUploadUrl = async (req, res, next) => {
  try {
    const { id: conversationId } = req.params;
    const userId = req.user.id;
    const { fileName, mimeType, fileSize } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await messageService.createAttachmentUploadUrl({
      conversationId,
      userId,
      fileName,
      mimeType,
      fileSize,
      ipAddress,
      userAgent,
    });

    res.status(201).json({
      message: "Attachment upload URL generated successfully",
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

const completeAttachmentUpload = async (req, res, next) => {
  try {
    const { id: attachmentId } = req.params;
    const userId = req.user.id;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await messageService.completeAttachmentUpload({
      attachmentId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      message: "Attachment upload completed successfully",
      attachment: result,
    });
  } catch (error) {
    next(error);
  }
};

const getAttachmentDownloadUrl = async (req, res, next) => {
  try {
    const { id: attachmentId } = req.params;
    const userId = req.user.id;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await messageService.getAttachmentDownloadUrl({
      attachmentId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const deleteAttachment = async (req, res, next) => {
  try {
    const { id: attachmentId } = req.params;
    const userId = req.user.id;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await messageService.deleteAttachment({
      attachmentId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createConversation,
  getMyConversations,
  getConversationById,
  sendMessage,
  listMessages,
  editMessage,
  deleteMessage,
  markConversationRead,
  getUnreadCount,
  createAttachmentUploadUrl,
  completeAttachmentUpload,
  getAttachmentDownloadUrl,
  deleteAttachment,
};
