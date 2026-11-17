import { LOCATION_COUNTRIES, LOCATION_STATES } from '../constants/locationRegions.js';

// Same named regions the frontend picker offers (frontend/src/lib/naLocationData.js).
const METRO_REGIONS = [
  'Greater Toronto Area (GTA)',
  'National Capital Region',
  'Metro Vancouver',
  'Greater Los Angeles',
  'Bay Area',
  'Dallas-Fort Worth',
  'South Florida',
  'Pacific Northwest',
  'New England',
  'New York Metro',
  'Southern Ontario',
  'Northern Ontario',
];

const key = (value) => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

const countryByKey = new Map();
for (const [iso2, name] of LOCATION_COUNTRIES) {
  countryByKey.set(key(name), iso2);
  countryByKey.set(key(iso2), iso2);
}
const statesByCountry = new Map();
const anyStateKeys = new Set();
for (const [iso2, code, name] of LOCATION_STATES) {
  if (!statesByCountry.has(iso2)) statesByCountry.set(iso2, new Set());
  const set = statesByCountry.get(iso2);
  set.add(key(name));
  anyStateKeys.add(key(name));
  if (code) {
    set.add(key(code));
    // Short codes without a country ("Toronto, ON") come from the older North America picker.
    if (iso2 === 'CA' || iso2 === 'US') anyStateKeys.add(key(code));
  }
}
const metroKeys = new Set(METRO_REGIONS.map(key));

const PLACE_NAME = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .'’()&/-]{0,79}$/u;

const countryOf = (part) => countryByKey.get(key(part)) || null;
const isStateOf = (iso2, part) => Boolean(statesByCountry.get(iso2)?.has(key(part)));

/** "City, Province/State, Country" (or "City, Country"), as the location picker writes it. */
export function isKnownServiceCity(label) {
  const parts = String(label || '').split(',').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || !PLACE_NAME.test(parts[0])) return false;
  if (parts.length === 3) {
    const iso2 = countryOf(parts[2]);
    return Boolean(iso2 && isStateOf(iso2, parts[1]));
  }
  return Boolean(countryOf(parts[1]) || anyStateKeys.has(key(parts[1])));
}

/** "Province/State, Country", a plain province/state name, or one of the named metro regions. */
export function isKnownServiceRegion(label) {
  const text = String(label || '').trim();
  if (!text) return false;
  if (metroKeys.has(key(text))) return true;
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length === 1) return anyStateKeys.has(key(parts[0]));
  if (parts.length !== 2) return false;
  const iso2 = countryOf(parts[1]);
  return Boolean(iso2 && isStateOf(iso2, parts[0]));
}

/** Shape only (letters, commas, no links): used for names saved before the list check. */
export function isPlausiblePlaceName(label) {
  const parts = String(label || '').split(',').map((part) => part.trim());
  return parts.length >= 1 && parts.length <= 3 && parts.every((part) => PLACE_NAME.test(part));
}

const SERVICE_AREA_CHECKS = {
  service_area_cities: (label) => isKnownServiceCity(label),
  service_area_regions: (label) => isKnownServiceRegion(label),
  service_area_primary_zones: (label) => isKnownServiceArea(label),
  service_area_secondary_zones: (label) => isKnownServiceArea(label),
};

/**
 * New service-area names must come from the location list; names already saved on the
 * profile are kept as they are (older profiles were saved before the list check).
 * Returns { field: message } for the first unknown new name per field.
 */
export function unknownNewServiceAreas(body = {}, stored = {}) {
  const errors = {};
  for (const [field, check] of Object.entries(SERVICE_AREA_CHECKS)) {
    if (!Array.isArray(body?.[field])) continue;
    const kept = new Set((Array.isArray(stored?.[field]) ? stored[field] : []).map(key));
    const bad = body[field].find((label) => !kept.has(key(label)) && !check(label));
    if (bad) errors[field] = `"${bad}" isn't a recognised ${field === 'service_area_cities' ? 'city' : field === 'service_area_regions' ? 'region' : 'service area'}. Remove it and choose one from the list.`;
  }
  return errors;
}

export const isKnownServiceArea = (label) => isKnownServiceCity(label) || isKnownServiceRegion(label);
