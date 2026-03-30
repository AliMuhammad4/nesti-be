import mongoose from 'mongoose';
export const BuyerScoringSchema = new mongoose.Schema(
  {
    baseScore: { type: Number, required: true },
    budgetWithinCapMult: { type: Number, required: true },
    budgetWithinPoints: { type: Number, required: true },
    budgetSlightCapMult: { type: Number, required: true },
    budgetSlightPoints: { type: Number, required: true },
    budgetOverPenalty: { type: Number, required: true },
    bedsMatchPoints: { type: Number, required: true },
    bedsClosePoints: { type: Number, required: true },
    bedsUnderPenalty: { type: Number, required: true },
    areaPoints: { type: Number, required: true },
    typePoints: { type: Number, required: true },
    pickMinScore: { type: Number, required: true },
  },
  { _id: false }
);

export const SellerScoringSchema = new mongoose.Schema(
  {
    baseScore: { type: Number, required: true },
    areaPoints: { type: Number, required: true },
    priceTightLowMult: { type: Number, required: true },
    priceTightHighMult: { type: Number, required: true },
    priceTightPoints: { type: Number, required: true },
    priceWideLowMult: { type: Number, required: true },
    priceWideHighMult: { type: Number, required: true },
    priceWidePoints: { type: Number, required: true },
    priceMissPenalty: { type: Number, required: true },
    bedSamePoints: { type: Number, required: true },
    bedClosePoints: { type: Number, required: true },
    typePoints: { type: Number, required: true },
    pickMinScore: { type: Number, required: true },
  },
  { _id: false }
);

export const PropertyMatchSettingsSchema = new mongoose.Schema(
  {
    buyer: { type: BuyerScoringSchema, required: true },
    seller: { type: SellerScoringSchema, required: true },
    maxDisplayScore: { type: Number, required: true },
    maxMatches: { type: Number, required: true },
    inventoryLimit: { type: Number, required: true },
  },
  { _id: false }
);
