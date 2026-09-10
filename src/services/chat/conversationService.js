const prisma = require("../../config/prisma");
const { logChatAction } = require("../auditService");

const toSafeUser = (user) => {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    doctorProfile: user.doctorProfile
      ? {
          specialization: user.doctorProfile.specialization,
          hospitalName: user.doctorProfile.hospitalName,
          verified: user.doctorProfile.verified,
        }
      : undefined,
  };
};

const toSafeConversation = (conversation, unreadCount = 0) => {
  if (!conversation) return null;
  return {
    id: conversation.id,
    patientId: conversation.patientId,
    doctorId: conversation.doctorId,
    appointmentId: conversation.appointmentId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount,
    patient: toSafeUser(conversation.patient),
    doctor: toSafeUser(conversation.doctor),
    appointment: conversation.appointment
      ? {
          id: conversation.appointment.id,
          appointmentDate: conversation.appointment.appointmentDate,
          status: conversation.appointment.status,
        }
      : undefined,
  };
};

/**
 * Validates doctor-patient relationship based on an established Appointment.
 */
const validateAppointmentRelationship = async (appointmentId, userId) => {
  if (!appointmentId || typeof appointmentId !== "string" || !appointmentId.trim()) {
    const error = new Error("appointmentId is required");
    error.statusCode = 400;
    throw error;
  }

  const appointment = await prisma.appointment.findUnique({
    where: { id: appointmentId.trim() },
    include: {
      doctor: {
        include: { doctorProfile: true },
      },
      patient: true,
    },
  });

  if (!appointment) {
    const error = new Error("Appointment not found");
    error.statusCode = 404;
    throw error;
  }

  // Caller must be either the patient or the doctor of the appointment
  if (appointment.patientId !== userId && appointment.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this appointment");
    error.statusCode = 403;
    throw error;
  }

  // Messaging allowed only for CONFIRMED or COMPLETED appointments
  if (appointment.status === "CANCELLED") {
    const error = new Error("Messaging is not permitted for CANCELLED appointments");
    error.statusCode = 400;
    throw error;
  }

  if (appointment.status !== "CONFIRMED" && appointment.status !== "COMPLETED") {
    const error = new Error(`Messaging requires a CONFIRMED or COMPLETED appointment (current status: ${appointment.status})`);
    error.statusCode = 400;
    throw error;
  }

  // Doctor must be verified
  const doctorProfile = appointment.doctor?.doctorProfile;
  if (!doctorProfile || !doctorProfile.verified) {
    const error = new Error("Doctor is not verified for patient messaging");
    error.statusCode = 400;
    throw error;
  }

  return appointment;
};

/**
 * Creates or retrieves the unique conversation for an appointment.
 */
const getOrCreateConversation = async ({
  appointmentId,
  userId,
  ipAddress = null,
  userAgent = null,
}) => {
  const appointment = await validateAppointmentRelationship(appointmentId, userId);

  // Check if conversation already exists for this appointment
  let conversation = await prisma.conversation.findUnique({
    where: { appointmentId: appointment.id },
    include: {
      patient: { include: { doctorProfile: true } },
      doctor: { include: { doctorProfile: true } },
      appointment: true,
    },
  });

  let isNew = false;
  if (!conversation) {
    isNew = true;
    conversation = await prisma.$transaction(async (tx) => {
      const created = await tx.conversation.create({
        data: {
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          appointmentId: appointment.id,
        },
        include: {
          patient: { include: { doctorProfile: true } },
          doctor: { include: { doctorProfile: true } },
          appointment: true,
        },
      });

      // Initialize read tracking for both participants
      await tx.conversationRead.createMany({
        data: [
          { conversationId: created.id, userId: appointment.patientId },
          { conversationId: created.id, userId: appointment.doctorId },
        ],
        skipDuplicates: true,
      });

      return created;
    });

    await logChatAction({
      conversationId: conversation.id,
      userId,
      action: "CONVERSATION_CREATED",
      ipAddress,
      userAgent,
      metadata: {
        appointmentId: appointment.id,
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
      },
    });
  }

  const unreadCount = await calculateUnreadCount(conversation.id, userId);

  return {
    conversation: toSafeConversation(conversation, unreadCount),
    isNew,
  };
};

/**
 * Calculates unread messages for a specific user in a conversation.
 */
const calculateUnreadCount = async (conversationId, userId) => {
  const readRecord = await prisma.conversationRead.findUnique({
    where: {
      conversationId_userId: {
        conversationId,
        userId,
      },
    },
  });

  const lastReadAt = readRecord?.lastReadAt;

  const whereClause = {
    conversationId,
    senderId: { not: userId },
    deletedAt: null,
  };

  if (lastReadAt) {
    whereClause.createdAt = { gt: lastReadAt };
  }

  return await prisma.message.count({ where: whereClause });
};

/**
 * List all conversations for the authenticated user.
 */
const listUserConversations = async ({ userId, role, page = 1, limit = 20 }) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, Math.min(50, parseInt(limit, 10) || 20));
  const skip = (pageNum - 1) * limitNum;

  const whereClause = role === "PATIENT" ? { patientId: userId } : { doctorId: userId };

  const [conversations, total] = await Promise.all([
    prisma.conversation.findMany({
      where: whereClause,
      include: {
        patient: { include: { doctorProfile: true } },
        doctor: { include: { doctorProfile: true } },
        appointment: true,
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: [
        { lastMessageAt: "desc" },
        { updatedAt: "desc" },
      ],
      skip,
      take: limitNum,
    }),
    prisma.conversation.count({ where: whereClause }),
  ]);

  const items = await Promise.all(
    conversations.map(async (c) => {
      const unreadCount = await calculateUnreadCount(c.id, userId);
      const safeConv = toSafeConversation(c, unreadCount);
      const lastMsg = c.messages[0];
      if (lastMsg) {
        safeConv.lastMessage = {
          id: lastMsg.id,
          senderId: lastMsg.senderId,
          messageType: lastMsg.messageType,
          content: lastMsg.deletedAt ? "[Message deleted]" : lastMsg.content,
          createdAt: lastMsg.createdAt,
        };
      }
      return safeConv;
    })
  );

  return {
    conversations: items,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

/**
 * Get a single conversation by ID with participant authorization check.
 */
const getConversationById = async ({ conversationId, userId, userRole }) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: {
      patient: { include: { doctorProfile: true } },
      doctor: { include: { doctorProfile: true } },
      appointment: true,
    },
  });

  if (!conversation) {
    const error = new Error("Conversation not found");
    error.statusCode = 404;
    throw error;
  }

  // Only the participating patient or doctor has access
  if (conversation.patientId !== userId && conversation.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this conversation");
    error.statusCode = 403;
    throw error;
  }

  const unreadCount = await calculateUnreadCount(conversation.id, userId);
  return toSafeConversation(conversation, unreadCount);
};

/**
 * Calculates global unread count across all active conversations for a user.
 */
const getUserTotalUnreadCount = async ({ userId, role }) => {
  const whereClause = role === "PATIENT" ? { patientId: userId } : { doctorId: userId };

  const conversations = await prisma.conversation.findMany({
    where: whereClause,
    select: { id: true },
  });

  let totalUnread = 0;
  const unreadByConversation = [];

  for (const c of conversations) {
    const count = await calculateUnreadCount(c.id, userId);
    if (count > 0) {
      totalUnread += count;
      unreadByConversation.push({ conversationId: c.id, unreadCount: count });
    }
  }

  return {
    totalUnreadCount: totalUnread,
    unreadByConversation,
  };
};

module.exports = {
  validateAppointmentRelationship,
  getOrCreateConversation,
  calculateUnreadCount,
  listUserConversations,
  getConversationById,
  getUserTotalUnreadCount,
  toSafeConversation,
  toSafeUser,
};
