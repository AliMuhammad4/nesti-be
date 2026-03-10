import User from './User.js';
import ChatConversation from './ChatConversation.js';
import ProfessionalProfile from './ProfessionalProfile.js';
import LeadMatch from './LeadMatch.js';
import Referral from './Referral.js';
import SellerProfile from './SellerProfile.js';
import NurtureLog from './NurtureLog.js';
import EnterpriseInquiry from './EnterpriseInquiry.js';
import ChatMessage from './ChatMessage.js';
import ChatbotEmbedUrl from './ChatbotEmbedUrl.js';
import CalendarIntegration from './CalendarIntegration.js';
import BuyerProfile from './BuyerProfile.js';
import CalculatorRun from './CalculatorRun.js';

// Export all models so they can be easily imported elsewhere,
// and to ensure Mongoose registers them immediately on startup.
export {
  User,
  ChatConversation,
  ProfessionalProfile,
  LeadMatch,
  Referral,
  SellerProfile,
  NurtureLog,
  EnterpriseInquiry,
  ChatMessage,
  ChatbotEmbedUrl,
  CalendarIntegration,
  BuyerProfile,
  CalculatorRun
};
