export const CREDENTIAL_STATUS = Object.freeze({
  NOT_STARTED: 'not_started',
  PENDING_DOCS: 'pending_docs',
  PENDING_REVIEW: 'pending_review',
  APPROVED: 'approved',
  REJECTED: 'rejected',
});

export const CREDENTIAL_STATUS_VALUES = Object.freeze(Object.values(CREDENTIAL_STATUS));

export const CREDENTIAL_COUNTRY = Object.freeze({
  CA: 'CA',
  US: 'US',
});

export const CREDENTIAL_COUNTRY_VALUES = Object.freeze(Object.values(CREDENTIAL_COUNTRY));

// Same lists as the verification form (frontend/src/lib/credentialJurisdictions.js).
export const CREDENTIAL_JURISDICTIONS = Object.freeze({
  CA: Object.freeze(['AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT']),
  US: Object.freeze([
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY',
    'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
    'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
  ]),
});

export function isValidCredentialJurisdiction(country, jurisdiction) {
  const list = CREDENTIAL_JURISDICTIONS[String(country || '').trim().toUpperCase()];
  return Boolean(list && list.includes(String(jurisdiction || '').trim().toUpperCase()));
}

export const CREDENTIAL_DOC_TYPE = Object.freeze({
  GOV_ID_FRONT: 'gov_id_front',
  GOV_ID_BACK: 'gov_id_back',
  SELFIE: 'selfie',
  LICENSE_PROOF: 'license_proof',
  AFFILIATION_PROOF: 'affiliation_proof',
  NMLS_SCREENSHOT: 'nmls_screenshot',
  EO_INSURANCE: 'eo_insurance',
});

export const CREDENTIAL_DOC_TYPE_VALUES = Object.freeze(Object.values(CREDENTIAL_DOC_TYPE));

export const CREDENTIAL_DOC_LABELS = Object.freeze({
  [CREDENTIAL_DOC_TYPE.GOV_ID_FRONT]: 'Government ID (front)',
  [CREDENTIAL_DOC_TYPE.GOV_ID_BACK]: 'Government ID (back)',
  [CREDENTIAL_DOC_TYPE.SELFIE]: 'Selfie / liveness photo',
  [CREDENTIAL_DOC_TYPE.LICENSE_PROOF]: 'License / registry proof',
  [CREDENTIAL_DOC_TYPE.AFFILIATION_PROOF]: 'Brokerage / firm affiliation proof',
  [CREDENTIAL_DOC_TYPE.NMLS_SCREENSHOT]: 'NMLS Consumer Access screenshot',
  [CREDENTIAL_DOC_TYPE.EO_INSURANCE]: 'E&O / professional liability certificate',
});

export const CREDENTIAL_EVENT_TYPE = Object.freeze({
  SUBMITTED: 'submitted',
  RESUBMITTED: 'resubmitted',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  DOC_UPLOADED: 'doc_uploaded',
  DOC_DELETED: 'doc_deleted',
});

export const CREDENTIAL_EVENT_TYPE_VALUES = Object.freeze(Object.values(CREDENTIAL_EVENT_TYPE));
