/**
 * Ephemeral In-Memory WebRTC Signaling Store
 * Transiently holds SDP offers, SDP answers, and ICE candidates during session setup.
 * Payloads are NOT permanently stored in PostgreSQL.
 */

const MAX_PAYLOAD_BYTES = 65536; // 64 KB limit

class SignalingStore {
  constructor() {
    this.sessions = new Map();
  }

  _getOrCreateSession(sessionId) {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        offer: null,
        answer: null,
        candidates: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return this.sessions.get(sessionId);
  }

  validatePayload(payload) {
    if (!payload || typeof payload !== "object") {
      const err = new Error("Signaling payload must be a valid JSON object");
      err.statusCode = 400;
      throw err;
    }

    const payloadStr = JSON.stringify(payload);
    if (Buffer.byteLength(payloadStr, "utf8") > MAX_PAYLOAD_BYTES) {
      const err = new Error(`Signaling payload exceeds maximum size limit of ${MAX_PAYLOAD_BYTES} bytes`);
      err.statusCode = 400;
      throw err;
    }

    return payload;
  }

  setOffer(sessionId, senderId, offer) {
    this.validatePayload(offer);
    const session = this._getOrCreateSession(sessionId);
    session.offer = {
      senderId,
      payload: offer,
      timestamp: Date.now(),
    };
    session.updatedAt = Date.now();
    return session.offer;
  }

  getOffer(sessionId) {
    const session = this.sessions.get(sessionId);
    return session?.offer || null;
  }

  setAnswer(sessionId, senderId, answer) {
    this.validatePayload(answer);
    const session = this._getOrCreateSession(sessionId);
    session.answer = {
      senderId,
      payload: answer,
      timestamp: Date.now(),
    };
    session.updatedAt = Date.now();
    return session.answer;
  }

  getAnswer(sessionId) {
    const session = this.sessions.get(sessionId);
    return session?.answer || null;
  }

  addIceCandidate(sessionId, senderId, candidate) {
    this.validatePayload(candidate);
    const session = this._getOrCreateSession(sessionId);
    const candidateItem = {
      senderId,
      payload: candidate,
      timestamp: Date.now(),
    };
    session.candidates.push(candidateItem);
    // Limit stored candidates per session to 100 to prevent unbounded growth
    if (session.candidates.length > 100) {
      session.candidates.shift();
    }
    session.updatedAt = Date.now();
    return candidateItem;
  }

  getIceCandidates(sessionId, excludeSenderId = null) {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    if (excludeSenderId) {
      return session.candidates.filter((c) => c.senderId !== excludeSenderId);
    }
    return session.candidates;
  }

  clearSession(sessionId) {
    this.sessions.delete(sessionId);
  }
}

const signalingStore = new SignalingStore();

module.exports = signalingStore;
