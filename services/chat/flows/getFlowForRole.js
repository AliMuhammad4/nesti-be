import { agentFlow } from '../agent/agentFlow.js';
import { mortgageBrokerFlow } from '../mortgageBroker/mortgageBrokerFlow.js';
import { lawyerFlow } from '../lawyer/lawyerFlow.js';
import { PROFESSIONAL_TYPE } from '../../../constants/roles.js';

export function getFlowForRole(professionalType) {
  if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return mortgageBrokerFlow;
  if (professionalType === PROFESSIONAL_TYPE.LAWYER) return lawyerFlow;
  return agentFlow;
}
