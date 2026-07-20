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
