export const ADMIN_PERMISSION = Object.freeze({
  ALL: '*',
  USERS_WRITE: 'users.write',
  PROFESSIONALS_READ: 'professionals.read',
  PROFESSIONALS_WRITE: 'professionals.write',
  CLIENTS_READ: 'clients.read',
  CLIENTS_WRITE: 'clients.write',
  LEADS_READ: 'leads.read',
  LEADS_WRITE: 'leads.write',
  PROPERTIES_READ: 'properties.read',
  PROPERTIES_WRITE: 'properties.write',
  SUBSCRIPTIONS_READ: 'subscriptions.read',
  SUBSCRIPTIONS_WRITE: 'subscriptions.write',
  REFERRALS_READ: 'referrals.read',
  REFERRALS_WRITE: 'referrals.write',
  VERIFICATIONS_READ: 'verifications.read',
  VERIFICATIONS_APPROVE: 'verifications.approve',
  DOCUMENTS_READ: 'documents.read',
  ANALYTICS_READ: 'analytics.read',
});

export const ADMIN_PERMISSION_VALUES = Object.freeze(Object.values(ADMIN_PERMISSION));

/** Empty / missing permissions on an admin means full access (backward compatible). */
export function adminHasPermission(user, permission) {
  if (!user || user.role !== 'admin') return false;
  const list = Array.isArray(user.admin_permissions) ? user.admin_permissions : [];
  if (!list.length || list.includes(ADMIN_PERMISSION.ALL) || list.includes('*')) return true;
  return list.includes(permission);
}
