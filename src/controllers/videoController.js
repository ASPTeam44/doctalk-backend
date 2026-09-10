const videoSessionService = require("../services/video/videoSessionService");

const createSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { appointmentId } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.createOrGetSession({
      appointmentId,
      userId,
      ipAddress,
      userAgent,
    });

    const statusCode = result.isExisting ? 200 : 201;
    res.status(statusCode).json({
      message: result.isExisting
        ? "Existing video consultation session retrieved"
        : "Video consultation session created successfully",
      session: result.session,
    });
  } catch (error) {
    next(error);
  }
};

const getSessionById = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const session = await videoSessionService.getSessionById({
      sessionId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json({ session });
  } catch (error) {
    next(error);
  }
};

const joinSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.joinSession({
      sessionId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json({
      message: "Joined consultation session successfully",
      session: result.session,
      iceServers: result.iceServers,
    });
  } catch (error) {
    next(error);
  }
};

const leaveSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.leaveSession({
      sessionId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const endSession = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.endSession({
      sessionId,
      userId,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getIceServers = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const result = await videoSessionService.getIceServersForSession({
      sessionId,
      userId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const submitOffer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const { offer } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.submitOffer({
      sessionId,
      userId,
      offer,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getOffer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const result = await videoSessionService.getOffer({
      sessionId,
      userId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const submitAnswer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const { answer } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.submitAnswer({
      sessionId,
      userId,
      answer,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getAnswer = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;

    const result = await videoSessionService.getAnswer({
      sessionId,
      userId,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const submitIceCandidate = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const { candidate } = req.body;
    const ipAddress = req.ip || req.headers["x-forwarded-for"] || null;
    const userAgent = req.headers["user-agent"] || null;

    const result = await videoSessionService.submitIceCandidate({
      sessionId,
      userId,
      candidate,
      ipAddress,
      userAgent,
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getIceCandidates = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const { sessionId } = req.params;
    const { excludeOwn } = req.query;

    const result = await videoSessionService.getIceCandidates({
      sessionId,
      userId,
      excludeOwn: excludeOwn !== "false",
    });

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createSession,
  getSessionById,
  joinSession,
  leaveSession,
  endSession,
  getIceServers,
  submitOffer,
  getOffer,
  submitAnswer,
  getAnswer,
  submitIceCandidate,
  getIceCandidates,
};
