export const determineTrafficSource = (referrer) => {
  if (!referrer) {
    return 'direct';
  }

  const lowerRef = referrer.toLowerCase();

  const socialDomains = [
    'facebook.com',
    'twitter.com',
    'linkedin.com',
    'instagram.com',
    'youtube.com',
    'pinterest.com',
    'tiktok.com',
  ];

  const searchEngines = [
    'google.com',
    'bing.com',
    'yahoo.com',
    'duckduckgo.com',
    'baidu.com',
  ];

  for (const domain of socialDomains) {
    if (lowerRef.includes(domain)) {
      return 'social';
    }
  }

  for (const engine of searchEngines) {
    if (lowerRef.includes(engine)) {
      return 'search';
    }
  }

  if (lowerRef.includes(process.env.FRONTEND_URL?.toLowerCase() || 'localhost')) {
    return 'direct';
  }

  return 'referral';
};

export const categorizeEvent = (eventType) => {
  const trafficEvents = ['profile_view'];
  const engagementEvents = ['listing_view', 'service_click', 'social_click'];
  const conversionEvents = [
    'cta_click',
    'chatbot_open',
    'consultation_request',
    'contact_click',
  ];

  if (trafficEvents.includes(eventType)) return 'traffic';
  if (engagementEvents.includes(eventType)) return 'engagement';
  if (conversionEvents.includes(eventType)) return 'conversion';
  return 'other';
};
