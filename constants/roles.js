export const PROFESSIONAL_TYPE = Object.freeze({
  AGENT: 'agent',
  MORTGAGE_BROKER: 'mortgage_broker',
  LAWYER: 'lawyer',
});

export const USER_ROLE = Object.freeze({
  AGENT: PROFESSIONAL_TYPE.AGENT,
  MORTGAGE_BROKER: PROFESSIONAL_TYPE.MORTGAGE_BROKER,
  LAWYER: PROFESSIONAL_TYPE.LAWYER,
  ADMIN: 'admin',
});

export const PROFESSIONAL_TYPE_VALUES = Object.freeze(Object.values(PROFESSIONAL_TYPE));

export const USER_ROLE_VALUES = Object.freeze([
  USER_ROLE.AGENT,
  USER_ROLE.MORTGAGE_BROKER,
  USER_ROLE.LAWYER,
  USER_ROLE.ADMIN,
]);
export const WIDGET_AGENT_TYPE = Object.freeze({
  AGENT: 'agent',
  BROKER: 'broker',
  LAWYER: 'lawyer',
});

export const WIDGET_AGENT_TYPE_VALUES = Object.freeze(Object.values(WIDGET_AGENT_TYPE));

export function isValidProfessionalType(value) {
  return value != null && PROFESSIONAL_TYPE_VALUES.includes(value);
}

export function resolveFlowTypeFromLegacySignals({ normalizedAgentType, professionalProfile }) {
  const professionalType = professionalProfile?.professional_type || PROFESSIONAL_TYPE.AGENT;
  if (normalizedAgentType === WIDGET_AGENT_TYPE.BROKER) return PROFESSIONAL_TYPE.MORTGAGE_BROKER;
  if (normalizedAgentType === WIDGET_AGENT_TYPE.LAWYER) return PROFESSIONAL_TYPE.LAWYER;
  return professionalType;
}

export function professionalTypeToWidgetAgentType(flowType) {
  if (flowType === PROFESSIONAL_TYPE.MORTGAGE_BROKER) return WIDGET_AGENT_TYPE.BROKER;
  if (flowType === PROFESSIONAL_TYPE.LAWYER) return WIDGET_AGENT_TYPE.LAWYER;
  return WIDGET_AGENT_TYPE.AGENT;
}

export function resolveChatFlowType({ embed, normalizedAgentType, professionalProfile }) {
  if (embed?.widget_role && isValidProfessionalType(embed.widget_role)) {
    return embed.widget_role;
  }
  return resolveFlowTypeFromLegacySignals({ normalizedAgentType, professionalProfile });
}
