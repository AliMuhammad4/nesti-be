import { agentFlow } from './agentFlow.js';
import { mortgageBrokerFlow } from './mortgageBrokerFlow.js';
import { lawyerFlow } from './lawyerFlow.js';
import { PROFESSIONAL_TYPE, USER_ROLE, USER_ROLE_VALUES } from '../../../constants/roles.js';
export { agentFlow, mortgageBrokerFlow, lawyerFlow };
export { PROFESSIONAL_TYPE, USER_ROLE, USER_ROLE_VALUES };
export { FLOW_ROLE } from './flowRoleMeta.js';
export const getFlowForRole = (professionalType) => {
  if (professionalType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return mortgageBrokerFlow;
  if (professionalType === PROFESSIONAL_TYPE.LAWYER) return lawyerFlow;
  return agentFlow;
};
