import { v2 as cloudinary } from 'cloudinary';
import logger from '../../utils/logger.js';

let configured = false;

export function configureCloudinary() {
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    logger.warn('Cloudinary env missing: set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET');
    return false;
  }
  cloudinary.config({ cloud_name, api_key, api_secret });
  configured = true;
  return true;
}

export function isCloudinaryConfigured() {
  if (!configured) {
    return configureCloudinary();
  }
  return true;
}

export { cloudinary };
