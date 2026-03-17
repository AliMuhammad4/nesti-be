/**
 * Role-specific chat flow handlers.
 */

import { agentFlow } from './agentFlow.js';
import { mortgageBrokerFlow } from './mortgageBrokerFlow.js';
import { lawyerFlow } from './lawyerFlow.js';

export { agentFlow, mortgageBrokerFlow, lawyerFlow };

export const getFlowForRole = (professionalType) => {
  if (professionalType === 'mortgage_broker') return mortgageBrokerFlow;
  if (professionalType === 'lawyer') return lawyerFlow;
  return agentFlow;
};
