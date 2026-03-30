import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { PROFESSIONAL_TYPE } from '../constants/roles.js';
dotenv.config();
async function migrateLegacyScoringCollection() {
  const legacy = mongoose.connection.collection('propertymatchscorings');
  const count = await legacy.countDocuments();
  if (!count) return 0;
  const { default: ProfessionalProfile } = await import('../models/ProfessionalProfile.js');
  const cursor = legacy.find({});
  let migrated = 0;
  for await (const doc of cursor) {
    if (!doc.user_id || !doc.buyer || !doc.seller) continue;
    const r = await ProfessionalProfile.updateOne(
      { user_id: doc.user_id, professional_type: PROFESSIONAL_TYPE.AGENT },
      {
        $set: {
          property_match_scoring: {
            buyer:           doc.buyer,
            seller:          doc.seller,
            maxDisplayScore: doc.maxDisplayScore,
            maxMatches:      doc.maxMatches,
            inventoryLimit:  doc.inventoryLimit,
          },
        },
      }
    );
    if (r.matchedCount) migrated += 1;
  }
  return migrated;
}

async function main() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    console.error('Set MONGO_URI or MONGODB_URI in .env');
    process.exit(1);
  }

  await mongoose.connect(uri);

  let migrated = 0;
  try {
    migrated = await migrateLegacyScoringCollection();
  } catch (e) {
    if (e.codeName !== 'NamespaceNotFound') console.warn('Legacy scoring migration skipped:', e.message);
  }
  if (migrated) console.log(`Migrated ${migrated} document(s) from propertymatchscorings → ProfessionalProfile.`);

  const { default: ProfessionalProfile } = await import('../models/ProfessionalProfile.js');
  const { ensureAgentPropertyMatchScoring } = await import(
    '../services/agent/propertyMatch/scoringConfig.js'
  );

  const agents = await ProfessionalProfile.find({ professional_type: PROFESSIONAL_TYPE.AGENT }).select('user_id').lean();
  let n = 0;
  for (const a of agents) {
    const ok = await ensureAgentPropertyMatchScoring(a.user_id);
    if (ok) n += 1;
  }
  console.log(`Ensured property_match_scoring on ${n} agent profile(s).`);

  await mongoose.disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
