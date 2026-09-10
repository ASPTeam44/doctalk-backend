const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const crypto = require("crypto");

const region = process.env.AWS_REGION || "us-east-1";
const bucket = process.env.AWS_S3_BUCKET || "doctalk-medical-reports-private";

// Initialize S3 client.
// If explicit credentials are provided, use them. Otherwise rely on AWS SDK default chain (IAM roles).
const clientConfig = { region };

if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
  clientConfig.credentials = {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  };
}

const s3Client = new S3Client(clientConfig);

/**
 * Generate a server-controlled, deterministic private S3 key.
 * medical-reports/{patientId}/{reportId}/{randomHex}.{ext}
 */
const generateS3Key = (patientId, reportId, extension) => {
  const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
  const randomHex = crypto.randomBytes(16).toString("hex");
  return `medical-reports/${patientId}/${reportId}/${randomHex}${safeExt}`;
};

/**
 * Generate a short-lived presigned PUT URL for client-side direct upload.
 */
const getPresignedUploadUrl = async (s3Key, mimeType, expiresIn = 900) => {
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ContentType: mimeType,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Generate a short-lived presigned GET URL for authorized downloads.
 */
const getPresignedDownloadUrl = async (s3Key, originalFileName, expiresIn = 900) => {
  // Sanitize filename for HTTP header Content-Disposition
  const safeDownloadName = (originalFileName || "medical-report")
    .replace(/[^a-zA-Z0-9._-]/g, "_");

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: s3Key,
    ResponseContentDisposition: `attachment; filename="${safeDownloadName}"`,
  });

  return await getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Safely delete an S3 object when a report is removed.
 */
const deleteS3Object = async (s3Key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });
    await s3Client.send(command);
  } catch (error) {
    // Log deletion error but don't fail database cleanup if S3 object was already absent
    console.error(`[S3 Deletion Notice] Key ${s3Key}:`, error.message);
  }
};

/**
 * Check whether an S3 object exists.
 */
const checkS3ObjectExists = async (s3Key) => {
  try {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: s3Key,
    });
    await s3Client.send(command);
    return true;
  } catch (error) {
    return false;
  }
};

module.exports = {
  s3Client,
  bucket,
  generateS3Key,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  deleteS3Object,
  checkS3ObjectExists,
};
