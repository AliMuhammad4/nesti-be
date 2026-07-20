/**
 * Public call registry API. Implementation is split by concern:
 *  - callRegistryShared.js: constants + helpers shared across the modules below
 *  - callRegistryLifecycle.js: creating/inviting a call before anyone has joined media
 *  - callRegistryJoin.js: joining, activating, and rechecking an in-progress call
 *  - callRegistryTermination.js: declining, leaving, and ending a call
 * This file only re-exports so existing imports of callRegistry.js keep working.
 */
import ProfessionalCall from '../../models/ProfessionalCall.js';

export { createPendingCall, markCallInvited } from './callRegistryLifecycle.js';
export {
  authorizeCallJoin,
  markCallActive,
  recheckCallJoin,
} from './callRegistryJoin.js';
export { declineCall, endCall, leaveCall } from './callRegistryTermination.js';

export async function clearCallRegistryForTests() {
  await ProfessionalCall.deleteMany({});
}
