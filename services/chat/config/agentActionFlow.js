/**
 * Agent lead action flow – grade + intent → recommended appointment, prompt, Calendly options.
 * BUYER: Hot (80–100), Warm (60–79), Early (0–59)
 * SELLER: Hot (80–100), Warm (60–79), Early (0–59)
 */

const mapGradeToTier = (grade) => {
  if (grade === 'hot') return 'hot';
  if (grade === 'warm' || grade === 'lukewarm') return 'warm';
  return 'early';
};

export const getAgentActionFlow = (leadGrade, intent) => {
  const tier = mapGradeToTier(leadGrade || 'cold');
  const isBuyer = intent !== 'sell';

  const flows = {
    buy: {
      hot: {
        goal: 'Get them into a showing or strategy call immediately',
        recommendedAppointment: ['Buyer Consultation (15–20 min)', 'Property Showing Tour'],
        prompt: "Based on your answers, you're ready to start viewing homes. Choose a time below to schedule your home buying consultation or book a showing.",
        calendlyOptions: ['Buyer Strategy Call', 'Property Showing Tour', 'Virtual Home Tour'],
        aiSupportAfterBooking: ['Property matches sent automatically', 'Showing itinerary created', 'Map route of homes'],
      },
      warm: {
        goal: 'Consultation first',
        recommendedAppointment: ['Buyer Strategy Call'],
        prompt: "You're getting close to buying. Book a quick strategy session so we can plan your next steps.",
        calendlyOptions: ['Home Buying Consultation', 'Mortgage Planning Call'],
        aiSupportAfterBooking: ['Budget analysis', 'Property alerts activated'],
      },
      early: {
        goal: 'Education call',
        recommendedAppointment: ['First Time Buyer Consultation', 'Market Overview Session'],
        prompt: "Buying a home can feel overwhelming. Book a short call and we'll walk you through the process.",
        calendlyOptions: ['First Time Buyer Consultation', 'Market Overview Session'],
        aiSupportAfterBooking: [],
      },
    },
    sell: {
      hot: {
        goal: 'Get the listing appointment booked',
        recommendedAppointment: ['Home Valuation Appointment', 'Listing Consultation (in person or virtual)'],
        prompt: "Your home may be ready for the market. Choose a time below for a listing consultation and professional valuation.",
        calendlyOptions: ['Home Valuation Appointment', 'Listing Consultation (in person or virtual)'],
        aiSupportAfterBooking: ['Instant home valuation report', 'Local sales comparables', 'Seller preparation checklist'],
      },
      warm: {
        goal: 'Listing strategy session',
        recommendedAppointment: ['Seller Strategy Call', 'Home Value Review'],
        prompt: "You're getting close to selling. Book a strategy session to review your home's value and plan your next steps.",
        calendlyOptions: ['Seller Strategy Call', 'Home Value Review'],
        aiSupportAfterBooking: ['Market report', 'Recent neighbourhood sales'],
      },
      early: {
        goal: 'Market education',
        recommendedAppointment: ['Market Timing Consultation', 'Future Selling Strategy Call'],
        prompt: "Selling a home can feel overwhelming. Book a short call and we'll walk you through the market and your options.",
        calendlyOptions: ['Market Timing Consultation', 'Future Selling Strategy Call'],
        aiSupportAfterBooking: [],
      },
    },
  };

  const key = isBuyer ? 'buy' : 'sell';
  return flows[key][tier] || flows[key].early;
};
