import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";

function getClient() {
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("AWS credentials are not configured.");
  }
  return new S3Client({
    region: process.env.AWS_REGION ?? "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

const BUCKET = process.env.AWS_S3_BUCKET ?? "infoatuvera";

/**
 * Upload a file buffer to S3.
 * Returns the public URL of the uploaded object.
 */
export async function uploadFile(
  buffer: Buffer,
  mimeType: string,
  folder: "avatars" | "recipes" | "misc" = "misc"
): Promise<string> {
  const ext = mimeType.split("/")[1] ?? "bin";
  const key = `${folder}/${crypto.randomUUID()}.${ext}`;

  await getClient().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    })
  );

  return `https://${BUCKET}.s3.${process.env.AWS_REGION ?? "us-east-1"}.amazonaws.com/${key}`;
}

/**
 * Generate a short-lived pre-signed URL for a private S3 object.
 */
export async function getPresignedUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    getClient(),
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn }
  );
}

/**
 * Delete an object from S3 by its full URL or key.
 */
export async function deleteFile(urlOrKey: string): Promise<void> {
  const key = urlOrKey.startsWith("https://")
    ? urlOrKey.split(".amazonaws.com/")[1]
    : urlOrKey;

  if (!key) return;

  await getClient().send(
    new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
  );
}
