/**
 * Property Service - handles property listings for clients
 */
import LeadProfile from '../../models/LeadProfile.js';
import LeadMatch from '../../models/LeadMatch.js';

/**
 * Get available properties (seller leads) excluding closed ones
 */
export async function getAvailableProperties(req, res) {
  try {
    const { limit = 12, skip = 0, location, min_price, max_price, bedrooms, property_type } = req.query;

    // Find all seller leads (properties)
    const query = {
      intent: 'sell',
      'lifecycle.status': { $nin: ['closed', 'sold', 'withdrawn'] },
    };

    // Add filters if provided
    if (location) {
      query.$or = [
        { 'property.location': new RegExp(location, 'i') },
        { 'property.address': new RegExp(location, 'i') },
      ];
    }

    if (bedrooms) {
      query['property.bedrooms'] = bedrooms;
    }

    if (property_type) {
      query['property.property_type'] = new RegExp(property_type, 'i');
    }

    // Get seller leads
    let properties = await LeadProfile.find(query)
      .select('property identity lifecycle createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();

    // Get all lead match IDs for these properties to check if they're closed
    const propertyIds = properties.map(p => p._id);
    
    // Find all matches for these properties that are closed/converted
    const closedMatches = await LeadMatch.find({
      lead_profile_id: { $in: propertyIds },
      match_status: { $in: ['converted', 'closed_lost'] },
    }).select('lead_profile_id').lean();

    const closedPropertyIds = new Set(closedMatches.map(m => String(m.lead_profile_id)));

    // Filter out properties with closed matches
    properties = properties.filter(p => !closedPropertyIds.has(String(p._id)));

    // Apply price filtering if specified (after fetching, since it's stored as string)
    if (min_price || max_price) {
      properties = properties.filter(p => {
        const price = parseFloat(p.property?.expected_price?.replace(/[^0-9.]/g, '')) || 0;
        if (min_price && price < parseFloat(min_price)) return false;
        if (max_price && price > parseFloat(max_price)) return false;
        return true;
      });
    }

    // Get total count for pagination
    const total = await LeadProfile.countDocuments(query);

    // Format properties for client display
    const formattedProperties = properties.map(p => ({
      id: p._id,
      address: p.property?.address || 'Address not provided',
      location: p.property?.location || '',
      price: p.property?.expected_price || p.property?.budget || 'Price upon request',
      bedrooms: p.property?.bedrooms || '',
      bathrooms: p.property?.bathrooms || '',
      squareFootage: p.property?.square_footage || '',
      propertyType: p.property?.property_type || 'Property',
      images: p.property?.images || [],
      features: p.property?.must_have_features || '',
      parking: p.property?.parking_required || '',
      backyard: p.property?.backyard_needed || '',
      timeline: p.property?.timeline || '',
      listedDate: p.createdAt,
      updatedDate: p.updatedAt,
    }));

    res.status(200).json({
      success: true,
      data: {
        properties: formattedProperties,
        pagination: {
          total,
          limit: parseInt(limit),
          skip: parseInt(skip),
          hasMore: parseInt(skip) + formattedProperties.length < total,
        },
      },
    });
  } catch (error) {
    console.error('Error fetching available properties:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch available properties',
      error: error.message,
    });
  }
}

/**
 * Get property details by ID
 */
export async function getPropertyById(req, res) {
  try {
    const { id } = req.params;

    const property = await LeadProfile.findOne({
      _id: id,
      intent: 'sell',
    })
      .select('property identity lifecycle createdAt updatedAt')
      .lean();

    if (!property) {
      return res.status(404).json({
        success: false,
        message: 'Property not found',
      });
    }

    // Check if this property has any closed matches
    const closedMatch = await LeadMatch.findOne({
      lead_profile_id: id,
      match_status: { $in: ['converted', 'closed_lost'] },
    });

    if (closedMatch) {
      return res.status(404).json({
        success: false,
        message: 'This property is no longer available',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        id: property._id,
        address: property.property?.address || 'Address not provided',
        location: property.property?.location || '',
        price: property.property?.expected_price || property.property?.budget || 'Price upon request',
        bedrooms: property.property?.bedrooms || '',
        bathrooms: property.property?.bathrooms || '',
        squareFootage: property.property?.square_footage || '',
        propertyType: property.property?.property_type || 'Property',
        images: property.property?.images || [],
        features: property.property?.must_have_features || '',
        parking: property.property?.parking_required || '',
        backyard: property.property?.backyard_needed || '',
        schoolDistrict: property.property?.school_district_important || '',
        timeline: property.property?.timeline || '',
        listedDate: property.createdAt,
        updatedDate: property.updatedAt,
      },
    });
  } catch (error) {
    console.error('Error fetching property:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch property details',
      error: error.message,
    });
  }
}
