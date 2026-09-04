/**
 * Provider boundary for future live storefront blocks. V1 intentionally keeps
 * editable/manual content as the source of truth; these adapters prevent UI
 * blocks from coupling to a specific MLS, rate, reviews, maps, or calendar API.
 */

export const STOREFRONT_PROVIDER = Object.freeze({
  LISTINGS: 'listings',
  MORTGAGE_RATES: 'mortgage_rates',
  REVIEWS: 'reviews',
  CALENDAR: 'calendar',
  MAPS: 'maps',
  SOCIAL: 'social',
});

export function unsupportedProviderResult(provider) {
  return {
    provider,
    status: 'not_configured',
    data: null,
    updated_at: null,
  };
}

export function createStorefrontProviderAdapters(overrides = {}) {
  return Object.fromEntries(
    Object.values(STOREFRONT_PROVIDER).map((provider) => [
      provider,
      overrides[provider] || {
        async get() {
          return unsupportedProviderResult(provider);
        },
      },
    ]),
  );
}

export const storefrontProviderAdapters = createStorefrontProviderAdapters();
