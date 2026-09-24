/**
 * One-shot: set admin_permissions=['*'] for admin users with empty/missing permissions.
 * Run: node scripts/backfillAdminPermissionsAll.js
 * Requires MONGO_URI.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { USER_ROLE } from '../constants/roles.js';
import { ADMIN_PERMISSION } from '../constants/adminPermissions.js';

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const filter = {
    role: USER_ROLE.ADMIN,
    $or: [
      { admin_permissions: { $exists: false } },
      { admin_permissions: null },
      { admin_permissions: { $size: 0 } },
    ],
  };

  const result = await User.updateMany(filter, {
    $set: { admin_permissions: [ADMIN_PERMISSION.ALL] },
  });

  console.log(
    `Updated ${result.modifiedCount} admin user(s) to admin_permissions=['${ADMIN_PERMISSION.ALL}'] ` +
      `(matched ${result.matchedCount}).`,
  );

  await mongoose.disconnect();
}

run().catch(async (err) => {
  console.error(err);
  try {
    await mongoose.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
