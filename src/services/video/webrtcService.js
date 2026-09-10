/**
 * WebRTC and STUN/TURN Configuration Service
 * Provides sanitized ICE server configuration to authorized consultation participants.
 */

const getIceServers = () => {
  const stunUrl = process.env.STUN_SERVER_URL || "stun:stun.l.google.com:19302";

  const iceServers = [
    {
      urls: [stunUrl],
    },
  ];

  // Optional TURN configuration via environment variables
  const turnUrl = process.env.TURN_SERVER_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL || process.env.TURN_SECRET;

  if (turnUrl) {
    const turnConfig = {
      urls: Array.isArray(turnUrl) ? turnUrl : [turnUrl],
    };

    if (turnUsername) {
      turnConfig.username = turnUsername;
    }
    if (turnCredential) {
      turnConfig.credential = turnCredential;
    }

    iceServers.push(turnConfig);
  }

  return iceServers;
};

module.exports = {
  getIceServers,
};
