import mongoose from "mongoose";
import ProfessionalProfile from "../models/ProfessionalProfile.js";

const CANONICAL_LANGUAGES = new Set([
  "english",
  "french",
  "punjabi",
  "mandarin",
  "arabic",
  "spanish",
  "hindi",
  "urdu",
  "portuguese",
  "russian",
  "tagalog",
  "italian",
  "german",
  "korean",
  "japanese",
  "vietnamese",
  "other",
]);

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return String(value)
    .split(/[,/|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/-+/g, "_");
}

function uniqueLimited(values, max) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const clean = String(value || "").trim();
    if (!clean) continue;
    if (seen.has(clean)) continue;
    seen.add(clean);
    output.push(clean);
    if (output.length >= max) break;
  }
  return output;
}

function normalizeLanguage(raw) {
  const token = slugify(raw);
  if (!token) return null;
  if (CANONICAL_LANGUAGES.has(token)) return token;
  if (token.startsWith("mandarin")) return "mandarin";
  if (token.startsWith("punjabi")) return "punjabi";
  if (token.startsWith("french")) return "french";
  if (token.startsWith("spanish")) return "spanish";
  if (token.startsWith("english")) return "english";
  if (token.startsWith("urdu")) return "urdu";
  if (token.startsWith("hindi")) return "hindi";
  if (token.startsWith("arabic")) return "arabic";
  if (token.startsWith("portuguese")) return "portuguese";
  if (token.startsWith("russian")) return "russian";
  if (token.startsWith("tagalog")) return "tagalog";
  if (token.startsWith("italian")) return "italian";
  if (token.startsWith("german")) return "german";
  if (token.startsWith("korean")) return "korean";
  if (token.startsWith("japanese")) return "japanese";
  if (token.startsWith("vietnamese")) return "vietnamese";
  return "other";
}

function shouldFillArray(existing) {
  return !Array.isArray(existing) || existing.length === 0;
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  await mongoose.connect(process.env.MONGO_URI);
  const profiles = await ProfessionalProfile.find({}).lean();
  let scanned = 0;
  let updated = 0;

  for (const profile of profiles) {
    scanned += 1;
    const set = {};

    if (shouldFillArray(profile.core_specialization_tags)) {
      const fallback = uniqueLimited(toArray(profile.specializations), 5);
      if (fallback.length) set.core_specialization_tags = fallback;
    }

    if (shouldFillArray(profile.specialty_strength_tags)) {
      const fallback = uniqueLimited(
        [...toArray(profile.preferred_clients), ...toArray(profile.specializations)],
        5,
      );
      if (fallback.length) set.specialty_strength_tags = fallback;
    }

    if (shouldFillArray(profile.working_style_tags)) {
      const fallback = uniqueLimited(
        [
          profile.working_style_structured,
          profile.support_level,
          profile.sales_approach,
          profile.energy_style,
        ].map(slugify),
        5,
      );
      if (fallback.length) set.working_style_tags = fallback;
    }

    if (shouldFillArray(profile.personality_style_tags)) {
      const fallback = uniqueLimited(
        [profile.personality_tag, profile.energy_style, profile.support_level, profile.sales_approach].map(slugify),
        5,
      );
      if (fallback.length) set.personality_style_tags = fallback;
    }

    if (shouldFillArray(profile.service_area_primary_zones)) {
      const fallback = uniqueLimited(toArray(profile.target_neighborhoods), 8);
      if (fallback.length) set.service_area_primary_zones = fallback;
    }

    if (shouldFillArray(profile.service_area_cities)) {
      const fallback = uniqueLimited(toArray(profile.location), 15);
      if (fallback.length) set.service_area_cities = fallback;
    }

    if (shouldFillArray(profile.languages_spoken)) {
      const normalized = uniqueLimited(toArray(profile.languages_spoken).map(normalizeLanguage).filter(Boolean), 8);
      if (normalized.length) set.languages_spoken = normalized;
    }

    if (Object.keys(set).length === 0) continue;
    await ProfessionalProfile.updateOne({ _id: profile._id }, { $set: set });
    updated += 1;
  }

  // eslint-disable-next-line no-console
  console.log(`Backfill complete. scanned=${scanned} updated=${updated}`);
  await mongoose.disconnect();
}

run().catch(async (error) => {
  // eslint-disable-next-line no-console
  console.error("Backfill failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});

