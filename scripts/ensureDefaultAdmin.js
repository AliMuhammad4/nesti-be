/**
 * Creates the platform admin if that email is not already in the connected database.
 * Local and deployed servers use different MONGO_URI values, so the local user
 * is not copied on deploy. The API calls this after connecting.
 *
 * Run by hand against the deployed database:
 *   node scripts/ensureDefaultAdmin.js
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { USER_ROLE } from '../constants/roles.js';
import { ADMIN_PERMISSION } from '../constants/adminPermissions.js';

const ADMIN_EMAIL = String(process.env.ADMIN_EMAIL || 'admin@nesti.ca').trim().toLowerCase();
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || 'Admin@12345');

export async function ensureDefaultAdmin() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD are required');
  }

  const existing = await User.findOne({ email: ADMIN_EMAIL });
  if (existing) {
    let changed = false;
    if (existing.role !== USER_ROLE.ADMIN) {
      existing.role = USER_ROLE.ADMIN;
      changed = true;
    }
    if (!existing.is_verified) {
      existing.is_verified = true;
      changed = true;
    }
    if (existing.is_active === false) {
      existing.is_active = true;
      existing.suspended_at = null;
      existing.suspended_reason = '';
      changed = true;
    }
    const permissions = Array.isArray(existing.admin_permissions) ? existing.admin_permissions : [];
    if (!permissions.includes(ADMIN_PERMISSION.ALL)) {
      existing.admin_permissions = [ADMIN_PERMISSION.ALL];
      changed = true;
    }
    if (!existing.password) {
      existing.password = ADMIN_PASSWORD;
      changed = true;
    }
    if (changed) await existing.save();
    return { created: false, updated: changed, email: ADMIN_EMAIL };
  }

  await User.create({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    first_name: 'Platform',
    last_name: 'Admin',
    role: USER_ROLE.ADMIN,
    admin_permissions: [ADMIN_PERMISSION.ALL],
    is_verified: true,
    is_active: true,
    auth_provider: 'local',
  });
  return { created: true, updated: false, email: ADMIN_EMAIL };
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith('ensureDefaultAdmin.js');
if (isDirectRun) {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is required');
    process.exit(1);
  }
  mongoose.connect(process.env.MONGO_URI)
    .then(() => ensureDefaultAdmin())
    .then(async (result) => {
      const action = result.created ? 'Created' : result.updated ? 'Updated' : 'Already present';
      console.log(`${action} admin ${result.email}`);
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error(error);
      try {
        await mongoose.disconnect();
      } catch {
        /* ignore */
      }
      process.exit(1);
    });
}
