import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import LeadMatch from '../models/LeadMatch.js';
import LeadProfile from '../models/LeadProfile.js';
import ChatConversation from '../models/ChatConversation.js';
import LeadAttribution from '../models/LeadAttribution.js';
import ChatMessage from '../models/ChatMessage.js';

// GET /api/leads
// Returns leads owned by the authenticated professional, optionally filtered by embedToken/intent/grade/status.
const getLeads = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const {
      embedToken,
      intent,   // "buy" | "sell"
      grade,    // "hot" | "warm" | "cold"
      status,   // match_status
    } = req.query;

    const match = { user_id: userId };

    if (status) {
      match.match_status = status;
    }
    if (grade) {
      // grade is stored inside lead_type as "<grade>_buyer|seller"
      match.lead_type = new RegExp(`^${grade}_`);
    }
    if (intent === 'buy' || intent === 'sell') {
      const suffix = intent === 'sell' ? 'seller' : 'buyer';
      match.lead_type = new RegExp(`${suffix}$`);
    }

    if (embedToken) {
      match['compatibility_factors.embed_token'] = embedToken;
    }

    const leadMatches = await LeadMatch.find(match)
      .sort({ createdAt: -1 })
      .lean();

    if (!leadMatches.length) {
      return res.json({ success: true, leads: [] });
    }

    // Load linked profiles and conversations in bulk
    const profileIds = leadMatches
      .map((m) => m.lead_profile_id)
      .filter(Boolean);
    const convoIds = leadMatches
      .map((m) => m.conversation_id)
      .filter(Boolean);

    const [profiles, conversations] = await Promise.all([
      LeadProfile.find({ _id: { $in: profileIds } }).lean(),
      ChatConversation.find({ _id: { $in: convoIds } }).lean(),
    ]);

    const profileById = new Map(profiles.map((p) => [String(p._id), p]));
    const convoById = new Map(conversations.map((c) => [String(c._id), c]));

    const leads = leadMatches.map((m) => {
      const profile = profileById.get(String(m.lead_profile_id)) || {};
      const convo   = convoById.get(String(m.conversation_id)) || {};

      return {
        id: String(m._id),
        intent: profile.intent || null,
        lead_type: m.lead_type,
        grade: m.lead_type?.split('_')[0] || null,
        score: m.match_score,
        status: m.match_status,
        contact: {
          full_name: profile.full_name || null,
          email: profile.email || null,
          phone: profile.phone || null,
          preferred_contact_method: profile.preferred_contact_method || null,
          best_time_to_contact: profile.best_time_to_contact || null,
        },
        property: {
          location: profile.location || null,
          address: profile.property_address || null,
          budget: profile.budget || profile.expected_price || null,
          timeline: profile.timeline || null,
          bedrooms: profile.bedrooms || null,
          bathrooms: profile.bathrooms || null,
          property_type: profile.property_type || null,
          must_have_features: profile.must_have_features || null,
          parking_required: profile.parking_required || null,
          backyard_needed: profile.backyard_needed || null,
          school_district_important: profile.school_district_important || null,
        },
        qualification: {
          mortgage_status: profile.mortgage_status || null,
          realtor_status: profile.realtor_status || null,
          motivation_reason: profile.motivation_reason || null,
          viewing_readiness: profile.viewing_readiness || null,
          living_situation: profile.living_situation || null,
          urgency_readiness: profile.urgency_readiness || null,
        },
        embed_token: m.compatibility_factors?.embed_token || null,
        session_id: m.compatibility_factors?.session_id || convo.session_id || null,
        conversation_id: String(m.conversation_id || ''),
        created_at: m.createdAt,
        updated_at: m.updatedAt,
      };
    });

    res.json({ success: true, leads });
  } catch (error) {
    next(error);
  }
};

// GET /api/leads/:id
// Returns a single lead (with joined profile + conversation) owned by the authenticated professional.
const getLeadById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const leadMatch = await LeadMatch.findOne({
      _id: id,
      user_id: userId,
    }).lean();

    if (!leadMatch) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const [profile, convo] = await Promise.all([
      leadMatch.lead_profile_id
        ? LeadProfile.findById(leadMatch.lead_profile_id).lean()
        : null,
      leadMatch.conversation_id
        ? ChatConversation.findById(leadMatch.conversation_id).lean()
        : null,
    ]);

    const lead = {
      id: String(leadMatch._id),
      intent: profile?.intent || null,
      lead_type: leadMatch.lead_type,
      grade: leadMatch.lead_type?.split('_')[0] || null,
      score: leadMatch.match_score,
      status: leadMatch.match_status,
      contact: {
        full_name: profile?.full_name || null,
        email: profile?.email || null,
        phone: profile?.phone || null,
        preferred_contact_method: profile?.preferred_contact_method || null,
        best_time_to_contact: profile?.best_time_to_contact || null,
      },
      property: {
        location: profile?.location || null,
        address: profile?.property_address || null,
        budget: profile?.budget || profile?.expected_price || null,
        timeline: profile?.timeline || null,
        bedrooms: profile?.bedrooms || null,
        bathrooms: profile?.bathrooms || null,
        property_type: profile?.property_type || null,
        must_have_features: profile?.must_have_features || null,
        parking_required: profile?.parking_required || null,
        backyard_needed: profile?.backyard_needed || null,
        school_district_important: profile?.school_district_important || null,
      },
      qualification: {
        mortgage_status: profile?.mortgage_status || null,
        realtor_status: profile?.realtor_status || null,
        motivation_reason: profile?.motivation_reason || null,
        viewing_readiness: profile?.viewing_readiness || null,
        living_situation: profile?.living_situation || null,
        urgency_readiness: profile?.urgency_readiness || null,
      },
      embed_token: leadMatch.compatibility_factors?.embed_token || null,
      session_id: leadMatch.compatibility_factors?.session_id || convo?.session_id || null,
      conversation_id: String(leadMatch.conversation_id || ''),
      created_at: leadMatch.createdAt,
      updated_at: leadMatch.updatedAt,
    };

    res.json({ success: true, lead });
  } catch (error) {
    next(error);
  }
};

router.get('/', protect, getLeads);
router.get('/:id', protect, getLeadById);

// GET /api/leads/:id/conversation
// Returns all messages in the lead's conversation (if owned by the professional)
const getLeadConversation = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const leadMatch = await LeadMatch.findOne({
      _id: id,
      user_id: userId,
    }).lean();

    if (!leadMatch) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    if (!leadMatch.conversation_id) {
      return res.json({
        success: true,
        lead_id: id,
        conversation_id: null,
        messages: [],
      });
    }

    const messages = await ChatMessage.find({
      conversation_id: leadMatch.conversation_id,
    })
      .sort({ createdAt: 1 })
      .lean();

    const conversationMessages = messages.map((m) => ({
      id: String(m._id),
      role: m.role,
      content: m.content,
      intent: m.intent || null,
      created_at: m.createdAt,
    }));

    res.json({
      success: true,
      lead_id: id,
      conversation_id: String(leadMatch.conversation_id),
      messages: conversationMessages,
    });
  } catch (error) {
    next(error);
  }
};

router.get('/:id/conversation', protect, getLeadConversation);

// DELETE /api/leads/:id
// Deletes the lead match, its lead profile, attributions, conversation and messages
const deleteLeadById = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const leadMatch = await LeadMatch.findOne({
      _id: id,
      user_id: userId,
    });

    if (!leadMatch) {
      return res.status(404).json({ success: false, message: 'Lead not found' });
    }

    const profileId = leadMatch.lead_profile_id;
    const conversationId = leadMatch.conversation_id;

    // Delete lead match first
    await LeadMatch.deleteOne({ _id: leadMatch._id });

    // Delete associated profile
    if (profileId) {
      await LeadProfile.deleteOne({ _id: profileId });
      await LeadAttribution.deleteMany({ lead_profile_id: profileId });
    }

    // Delete conversation + messages
    if (conversationId) {
      await ChatConversation.deleteOne({ _id: conversationId });
      await ChatMessage.deleteMany({ conversation_id: conversationId });
    }

    res.json({
      success: true,
      message: 'Lead and related conversation were deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

router.delete('/:id', protect, deleteLeadById);

export default router;
