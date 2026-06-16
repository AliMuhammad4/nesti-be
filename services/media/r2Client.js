import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import logger from '../../utils/logger.js';

let configured = false;
let r2Client = null;
let r2Config = null;

function trimSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

function sanitizeKey(key) {
  return String(key || '')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\s+/g, '_');
}

function encodeKeyForUrl(key) {
  return sanitizeKey(key)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolvePublicBaseUrl(config) {
  const explicit = trimSlash(config.publicBaseUrl);
  if (explicit) return explicit;
  const endpoint = trimSlash(config.endpoint);
  if (!endpoint || !config.bucket) return '';
  return `${endpoint}/${encodeURIComponent(config.bucket)}`;
}

export function configureR2() {
  const accountId = String(process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = String(process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = String(process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = String(process.env.R2_BUCKET_PUBLIC || '').trim();
  const endpoint = trimSlash(process.env.R2_S3_ENDPOINT);
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !endpoint) {
    logger.warn(
      'R2 env missing: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_PUBLIC, R2_S3_ENDPOINT',
    );
    return false;
  }

  r2Config = {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    endpoint,
    publicBaseUrl: trimSlash(publicBaseUrl),
  };

  r2Client = new S3Client({
    region: 'auto',
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });

  configured = true;
  return true;
}

export function isR2Configured() {
  if (!configured) {
    return configureR2();
  }
  return true;
}

export function getR2PublicUrl(key) {
  if (!isR2Configured()) return '';
  const objectKey = sanitizeKey(key);
  if (!objectKey) return '';
  const base = resolvePublicBaseUrl(r2Config);
  if (!base) return '';
  return `${base}/${encodeKeyForUrl(objectKey)}`;
}

export async function uploadBufferToR2(
  buffer,
  {
    key,
    mimeType,
    cacheControl = 'public, max-age=31536000',
    contentDisposition,
    metadata,
  } = {},
) {
  if (!isR2Configured()) {
    throw new Error('R2 is not configured');
  }
  if (!buffer) {
    throw new Error('Missing file buffer for R2 upload');
  }
  const objectKey = sanitizeKey(key);
  if (!objectKey) {
    throw new Error('Missing upload object key');
  }

  await r2Client.send(
    new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: objectKey,
      Body: buffer,
      ContentType: mimeType || undefined,
      CacheControl: cacheControl || undefined,
      ContentDisposition: contentDisposition || undefined,
      Metadata: metadata || undefined,
    }),
  );

  const url = getR2PublicUrl(objectKey);
  return {
    key: objectKey,
    url,
    secure_url: url,
    public_id: objectKey,
    bytes: typeof buffer.length === 'number' ? Number(buffer.length) : null,
  };
}

export async function createSignedReadUrl(
  key,
  { expiresIn = 60 * 60 * 24 * 7, download = false, filename, responseContentType } = {},
) {
  if (!isR2Configured()) return null;
  const objectKey = sanitizeKey(key);
  if (!objectKey) return null;

  const maxExpires = 60 * 60 * 24 * 7;
  const safeExpires = Math.max(60, Math.min(Number(expiresIn) || maxExpires, maxExpires));
  const dispositionType = download ? 'attachment' : 'inline';
  const responseContentDisposition = filename
    ? `${dispositionType}; filename="${String(filename).replace(/"/g, '')}"`
    : dispositionType;

  const command = new GetObjectCommand({
    Bucket: r2Config.bucket,
    Key: objectKey,
    ResponseContentDisposition: responseContentDisposition,
    ResponseContentType: responseContentType || undefined,
  });
  return getSignedUrl(r2Client, command, { expiresIn: safeExpires });
}
