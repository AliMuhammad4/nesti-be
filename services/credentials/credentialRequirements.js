import { USER_ROLE } from '../../constants/roles.js';
import {
  CREDENTIAL_COUNTRY,
  CREDENTIAL_DOC_LABELS,
  CREDENTIAL_DOC_TYPE,
} from '../../constants/credentialDocuments.js';

const SHARED_REQUIRED = [
  CREDENTIAL_DOC_TYPE.GOV_ID_FRONT,
  CREDENTIAL_DOC_TYPE.GOV_ID_BACK,
  CREDENTIAL_DOC_TYPE.SELFIE,
  CREDENTIAL_DOC_TYPE.LICENSE_PROOF,
];

/**
 * Role + country document checklist for professional credential verification.
 * `required: true` blocks submit; recommended docs are optional in MVP.
 */
export function getRequiredCredentialDocs({ role, country } = {}) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedCountry = String(country || '').trim().toUpperCase();
  const docs = SHARED_REQUIRED.map((type) => ({
    type,
    label: CREDENTIAL_DOC_LABELS[type],
    required: true,
  }));

  if (normalizedRole === USER_ROLE.AGENT || normalizedRole === USER_ROLE.MORTGAGE_BROKER) {
    docs.push({
      type: CREDENTIAL_DOC_TYPE.AFFILIATION_PROOF,
      label:
        normalizedRole === USER_ROLE.AGENT
          ? 'Brokerage affiliation proof'
          : 'Firm / company sponsorship proof',
      required: true,
    });
  }

  if (normalizedRole === USER_ROLE.MORTGAGE_BROKER && normalizedCountry === CREDENTIAL_COUNTRY.US) {
    docs.push({
      type: CREDENTIAL_DOC_TYPE.NMLS_SCREENSHOT,
      label: CREDENTIAL_DOC_LABELS[CREDENTIAL_DOC_TYPE.NMLS_SCREENSHOT],
      required: true,
    });
  }

  docs.push({
    type: CREDENTIAL_DOC_TYPE.EO_INSURANCE,
    label: CREDENTIAL_DOC_LABELS[CREDENTIAL_DOC_TYPE.EO_INSURANCE],
    required: false,
  });

  return docs;
}

export function getRequiredCredentialDocTypes(params) {
  return getRequiredCredentialDocs(params)
    .filter((doc) => doc.required)
    .map((doc) => doc.type);
}

export function describeCredentialRequirements({ role, country, audience = 'professional' } = {}) {
  const normalizedRole = String(role || '').trim().toLowerCase();
  const normalizedCountry = String(country || '').trim().toUpperCase();
  const forAdmin = audience === 'admin';

  if (normalizedRole === USER_ROLE.LAWYER) {
    return normalizedCountry === CREDENTIAL_COUNTRY.US
      ? (forAdmin
        ? 'Expected: government ID, selfie, and active state bar / good-standing proof.'
        : 'Upload your government ID, selfie, and active state bar / good-standing proof.')
      : (forAdmin
        ? 'Expected: government ID, selfie, and Law Society membership / good-standing proof.'
        : 'Upload your government ID, selfie, and Law Society membership / good-standing proof.');
  }
  if (normalizedRole === USER_ROLE.MORTGAGE_BROKER) {
    return normalizedCountry === CREDENTIAL_COUNTRY.US
      ? (forAdmin
        ? 'Expected: government ID, selfie, mortgage license proof, company sponsorship, and NMLS screenshot.'
        : 'Upload your government ID, selfie, mortgage license proof, company sponsorship, and NMLS screenshot.')
      : (forAdmin
        ? 'Expected: government ID, selfie, provincial mortgage license proof, and firm sponsorship.'
        : 'Upload your government ID, selfie, provincial mortgage license proof, and firm sponsorship.');
  }
  return normalizedCountry === CREDENTIAL_COUNTRY.US
    ? (forAdmin
      ? 'Expected: government ID, selfie, state real-estate license proof, and sponsoring broker proof.'
      : 'Upload your government ID, selfie, state real-estate license proof, and sponsoring broker proof.')
    : (forAdmin
      ? 'Expected: government ID, selfie, provincial real-estate license proof, and brokerage affiliation.'
      : 'Upload your government ID, selfie, provincial real-estate license proof, and brokerage affiliation.');
}
