const crypto = require("crypto");
const prisma = require("../../config/prisma");
const { logVideoAction } = require("../auditService");
const { getIceServers } = require("./webrtcService");
const signalingStore = require("./signalingStore");

const DEFAULT_SLOT_DURATION_MINUTES = 30;
const EARLY_JOIN_BUFFER_MINUTES = parseInt(process.env.EARLY_JOIN_BUFFER_MINUTES, 10) || 10;
const LATE_JOIN_GRACE_MINUTES = parseInt(process.env.LATE_JOIN_GRACE_MINUTES, 10) || 30;

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
          timezone: user.doctorProfile.timezone,
        }
      : undefined,
  };
};

const toSafeSession = (session) => {
  if (!session) return null;
  return {
    id: session.id,
    appointmentId: session.appointmentId,
    patientId: session.patientId,
    doctorId: session.doctorId,
    roomId: session.roomId,
    roomToken: session.roomToken,
    status: session.status,
    scheduledStartAt: session.scheduledStartAt,
    scheduledEndAt: session.scheduledEndAt,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    patient: toSafeUser(session.patient),
    doctor: toSafeUser(session.doctor),
    appointment: session.appointment
      ? {
          id: session.appointment.id,
          appointmentDate: session.appointment.appointmentDate,
          status: session.appointment.status,
        }
      : undefined,
  };
};

/**
 * Validates appointment relationship and returns appointment with doctor and patient data.
 */
const validateAppointmentForSession = async (appointmentId, userId) => {
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
      videoSession: true,
    },
  });

  if (!appointment) {
    const error = new Error("Appointment not found");
    error.statusCode = 404;
    throw error;
  }

  // Caller must be either the patient or doctor
  if (appointment.patientId !== userId && appointment.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this appointment");
    error.statusCode = 403;
    throw error;
  }

  // Appointment status gating
  if (appointment.status === "CANCELLED") {
    const error = new Error("Video consultation is not permitted for CANCELLED appointments");
    error.statusCode = 400;
    throw error;
  }

  if (appointment.status === "PENDING") {
    const error = new Error("Video consultation requires a CONFIRMED or COMPLETED appointment (current status: PENDING)");
    error.statusCode = 400;
    throw error;
  }

  if (appointment.status !== "CONFIRMED" && appointment.status !== "COMPLETED") {
    const error = new Error(`Video consultation requires a CONFIRMED or COMPLETED appointment (current status: ${appointment.status})`);
    error.statusCode = 400;
    throw error;
  }

  // Doctor must be verified
  const doctorProfile = appointment.doctor?.doctorProfile;
  if (!doctorProfile || !doctorProfile.verified) {
    const error = new Error("Doctor is not verified for video consultations");
    error.statusCode = 400;
    throw error;
  }

  return appointment;
};

/**
 * Creates or retrieves a video consultation session for an appointment.
 */
const createOrGetSession = async ({ appointmentId, userId, ipAddress = null, userAgent = null }) => {
  const appointment = await validateAppointmentForSession(appointmentId, userId);

  // Return existing session idempotently
  if (appointment.videoSession) {
    const existingSession = await prisma.consultationSession.findUnique({
      where: { id: appointment.videoSession.id },
      include: {
        doctor: { include: { doctorProfile: true } },
        patient: true,
        appointment: true,
      },
    });

    return {
      session: toSafeSession(existingSession),
      isExisting: true,
    };
  }

  // Calculate scheduled time window
  const scheduledStartAt = new Date(appointment.appointmentDate);
  const scheduledEndAt = new Date(scheduledStartAt.getTime() + DEFAULT_SLOT_DURATION_MINUTES * 60 * 1000);

  const roomId = crypto.randomUUID();
  const roomToken = crypto.randomBytes(32).toString("hex");

  // Create session with race-condition prevention via unique constraint
  const session = await prisma.consultationSession.create({
    data: {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      roomId,
      roomToken,
      status: "CREATED",
      scheduledStartAt,
      scheduledEndAt,
    },
    include: {
      doctor: { include: { doctorProfile: true } },
      patient: true,
      appointment: true,
    },
  });

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SESSION_CREATED",
    ipAddress,
    userAgent,
    metadata: {
      roomId: session.roomId,
      scheduledStartAt: session.scheduledStartAt,
      scheduledEndAt: session.scheduledEndAt,
    },
  });

  return {
    session: toSafeSession(session),
    isExisting: false,
  };
};

/**
 * Retrieves session by ID with participant authorization.
 */
const getSessionById = async ({ sessionId, userId, ipAddress = null, userAgent = null }) => {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId.trim() },
    include: {
      doctor: { include: { doctorProfile: true } },
      patient: true,
      appointment: true,
    },
  });

  if (!session) {
    const error = new Error("Consultation session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.patientId !== userId && session.doctorId !== userId) {
    await logVideoAction({
      sessionId: session.id,
      appointmentId: session.appointmentId,
      userId,
      action: "VIDEO_UNAUTHORIZED_ACCESS",
      ipAddress,
      userAgent,
      metadata: { targetSessionId: sessionId },
    });
    const error = new Error("Access forbidden: you are not a participant in this consultation session");
    error.statusCode = 403;
    throw error;
  }

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SESSION_ACCESSED",
    ipAddress,
    userAgent,
  });

  return toSafeSession(session);
};

/**
 * Join a video consultation session with timing and lifecycle validation.
 */
const joinSession = async ({ sessionId, userId, ipAddress = null, userAgent = null }) => {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId.trim() },
    include: {
      doctor: { include: { doctorProfile: true } },
      patient: true,
      appointment: true,
    },
  });

  if (!session) {
    const error = new Error("Consultation session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.patientId !== userId && session.doctorId !== userId) {
    await logVideoAction({
      sessionId: session.id,
      appointmentId: session.appointmentId,
      userId,
      action: "VIDEO_UNAUTHORIZED_ACCESS",
      ipAddress,
      userAgent,
      metadata: { actionAttempted: "join" },
    });
    const error = new Error("Access forbidden: you are not a participant in this consultation session");
    error.statusCode = 403;
    throw error;
  }

  // Doctor must still be verified
  const doctorProfile = session.doctor?.doctorProfile;
  if (!doctorProfile || !doctorProfile.verified) {
    const error = new Error("Doctor is not verified for video consultations");
    error.statusCode = 400;
    throw error;
  }

  // Status checks
  if (session.status === "ENDED") {
    const error = new Error("Consultation session has already ended");
    error.statusCode = 400;
    throw error;
  }

  if (session.status === "CANCELLED") {
    const error = new Error("Consultation session has been cancelled");
    error.statusCode = 400;
    throw error;
  }

  if (session.status === "EXPIRED") {
    const error = new Error("Consultation session has expired");
    error.statusCode = 400;
    throw error;
  }

  // Timing rules
  const now = new Date();
  const startTime = new Date(session.scheduledStartAt).getTime();
  const endTime = new Date(session.scheduledEndAt).getTime();
  const earlyWindow = startTime - EARLY_JOIN_BUFFER_MINUTES * 60 * 1000;
  const lateGraceWindow = endTime + LATE_JOIN_GRACE_MINUTES * 60 * 1000;

  if (now.getTime() < earlyWindow) {
    const error = new Error(`Too early to join consultation session. Join window opens ${EARLY_JOIN_BUFFER_MINUTES} minutes before scheduled start time.`);
    error.statusCode = 400;
    throw error;
  }

  if (now.getTime() > lateGraceWindow) {
    // Mark session EXPIRED in DB
    await prisma.consultationSession.update({
      where: { id: session.id },
      data: { status: "EXPIRED" },
    });

    await logVideoAction({
      sessionId: session.id,
      appointmentId: session.appointmentId,
      userId,
      action: "VIDEO_SESSION_EXPIRED",
      ipAddress,
      userAgent,
      metadata: { reason: "Join attempt after late grace period" },
    });

    const error = new Error("Consultation session has expired");
    error.statusCode = 400;
    throw error;
  }

  // Transition to ACTIVE on first join if CREATED
  let updatedSession = session;
  if (session.status === "CREATED") {
    updatedSession = await prisma.consultationSession.update({
      where: { id: session.id },
      data: {
        status: "ACTIVE",
        startedAt: now,
      },
      include: {
        doctor: { include: { doctorProfile: true } },
        patient: true,
        appointment: true,
      },
    });
  }

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SESSION_JOINED",
    ipAddress,
    userAgent,
    metadata: {
      role: userId === session.doctorId ? "DOCTOR" : "PATIENT",
      status: updatedSession.status,
    },
  });

  const iceServers = getIceServers();

  return {
    session: toSafeSession(updatedSession),
    iceServers,
  };
};

/**
 * Leave a video consultation session.
 */
const leaveSession = async ({ sessionId, userId, ipAddress = null, userAgent = null }) => {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId.trim() },
  });

  if (!session) {
    const error = new Error("Consultation session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.patientId !== userId && session.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this consultation session");
    error.statusCode = 403;
    throw error;
  }

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SESSION_LEFT",
    ipAddress,
    userAgent,
    metadata: {
      role: userId === session.doctorId ? "DOCTOR" : "PATIENT",
    },
  });

  return {
    message: "Left consultation session successfully",
    sessionId: session.id,
  };
};

/**
 * End a video consultation session.
 */
const endSession = async ({ sessionId, userId, ipAddress = null, userAgent = null }) => {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId.trim() },
    include: {
      doctor: { include: { doctorProfile: true } },
      patient: true,
      appointment: true,
    },
  });

  if (!session) {
    const error = new Error("Consultation session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.patientId !== userId && session.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this consultation session");
    error.statusCode = 403;
    throw error;
  }

  // Idempotent if already ENDED
  if (session.status === "ENDED") {
    return {
      session: toSafeSession(session),
      message: "Consultation session is already ended",
      isAlreadyEnded: true,
    };
  }

  const endedSession = await prisma.consultationSession.update({
    where: { id: session.id },
    data: {
      status: "ENDED",
      endedAt: new Date(),
    },
    include: {
      doctor: { include: { doctorProfile: true } },
      patient: true,
      appointment: true,
    },
  });

  // Clean up transient signaling store
  signalingStore.clearSession(session.id);

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SESSION_ENDED",
    ipAddress,
    userAgent,
    metadata: {
      endedBy: userId === session.doctorId ? "DOCTOR" : "PATIENT",
    },
  });

  return {
    session: toSafeSession(endedSession),
    message: "Consultation session ended successfully",
    isAlreadyEnded: false,
  };
};

/**
 * Get ICE servers for an authorized participant.
 */
const getIceServersForSession = async ({ sessionId, userId }) => {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId.trim() },
  });

  if (!session) {
    const error = new Error("Consultation session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.patientId !== userId && session.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this consultation session");
    error.statusCode = 403;
    throw error;
  }

  return {
    iceServers: getIceServers(),
  };
};

/**
 * Helper to validate session status for signaling.
 */
const validateSessionForSignaling = async (sessionId, userId) => {
  if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
    const error = new Error("sessionId is required");
    error.statusCode = 400;
    throw error;
  }

  const session = await prisma.consultationSession.findUnique({
    where: { id: sessionId.trim() },
  });

  if (!session) {
    const error = new Error("Consultation session not found");
    error.statusCode = 404;
    throw error;
  }

  if (session.patientId !== userId && session.doctorId !== userId) {
    const error = new Error("Access forbidden: you are not a participant in this consultation session");
    error.statusCode = 403;
    throw error;
  }

  if (session.status === "ENDED" || session.status === "CANCELLED" || session.status === "EXPIRED") {
    const error = new Error(`Signaling is not allowed for session in ${session.status} status`);
    error.statusCode = 400;
    throw error;
  }

  return session;
};

/**
 * WebRTC Signaling Operations
 */
const submitOffer = async ({ sessionId, userId, offer, ipAddress = null, userAgent = null }) => {
  const session = await validateSessionForSignaling(sessionId, userId);
  const storedOffer = signalingStore.setOffer(session.id, userId, offer);

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SIGNALING_ATTEMPT",
    ipAddress,
    userAgent,
    metadata: { signalingType: "offer" },
  });

  return {
    message: "SDP offer submitted successfully",
    offer: storedOffer,
  };
};

const getOffer = async ({ sessionId, userId }) => {
  const session = await validateSessionForSignaling(sessionId, userId);
  const offer = signalingStore.getOffer(session.id);
  return { offer };
};

const submitAnswer = async ({ sessionId, userId, answer, ipAddress = null, userAgent = null }) => {
  const session = await validateSessionForSignaling(sessionId, userId);
  const storedAnswer = signalingStore.setAnswer(session.id, userId, answer);

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SIGNALING_ATTEMPT",
    ipAddress,
    userAgent,
    metadata: { signalingType: "answer" },
  });

  return {
    message: "SDP answer submitted successfully",
    answer: storedAnswer,
  };
};

const getAnswer = async ({ sessionId, userId }) => {
  const session = await validateSessionForSignaling(sessionId, userId);
  const answer = signalingStore.getAnswer(session.id);
  return { answer };
};

const submitIceCandidate = async ({ sessionId, userId, candidate, ipAddress = null, userAgent = null }) => {
  const session = await validateSessionForSignaling(sessionId, userId);
  const storedCandidate = signalingStore.addIceCandidate(session.id, userId, candidate);

  await logVideoAction({
    sessionId: session.id,
    appointmentId: session.appointmentId,
    userId,
    action: "VIDEO_SIGNALING_ATTEMPT",
    ipAddress,
    userAgent,
    metadata: { signalingType: "ice-candidate" },
  });

  return {
    message: "ICE candidate submitted successfully",
    candidate: storedCandidate,
  };
};

const getIceCandidates = async ({ sessionId, userId, excludeOwn = true }) => {
  const session = await validateSessionForSignaling(sessionId, userId);
  const candidates = signalingStore.getIceCandidates(session.id, excludeOwn ? userId : null);
  return { candidates };
};

module.exports = {
  createOrGetSession,
  getSessionById,
  joinSession,
  leaveSession,
  endSession,
  getIceServersForSession,
  submitOffer,
  getOffer,
  submitAnswer,
  getAnswer,
  submitIceCandidate,
  getIceCandidates,
};
