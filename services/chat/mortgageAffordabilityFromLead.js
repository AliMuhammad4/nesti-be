import { partitionBuyerBudgetInputs, parseMaxBudget } from '../agent/propertyMatch/parsing.js';
import { getMortgageBrokerActionFlow } from './config/mortgageBrokerActionFlow.js';
const DEFAULT_RATE = 5.5;
const DEFAULT_AMORT_YEARS = 25;
const AFFORDABILITY_DISCLAIMER =
  'Illustrative only — not a pre-approval, rate guarantee, or financial advice.';
const INCOME_MIDPOINT = {
  '200k_plus': 250_000,
  '150k_200k': 175_000,
  '100k_150k': 125_000,
  '70k_100k': 85_000,
  under_70k: 55_000,
};
const DOWN_PCT_MID = {
  '20_plus': 20,
  '10_19': 15,
  '5_9': 7,
  under_5: 3,
  no_savings: 0,
};

function monthlyPI(principal, annualRatePct, years) {
  const n = Math.max(1, years) * 12;
  const r = annualRatePct / 1200;
  if (principal <= 0) return 0;
  if (r <= 0) return principal / n;
  return (principal * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
}

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return null;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

function incomeAndDownBands(formQualification) {
  const fq = formQualification || {};
  const incomeKey = fq.household_income || '';
  const downKey = fq.down_payment_readiness || '';
  return {
    incomeKey,
    downKey,
    grossMid: INCOME_MIDPOINT[incomeKey] ?? null,
    downPct: DOWN_PCT_MID[downKey] ?? 10,
  };
}

function actionFlowSlice(leadGrade) {
  if (leadGrade == null || leadGrade === '') return null;
  const f = getMortgageBrokerActionFlow(leadGrade);
  return {
    tier: f.tier,
    tier_label: f.tierLabel,
    goal: f.goal,
    calendly_option_labels: f.calendlyOptions,
  };
}

function resolvePriceFromBudget(formQualification, seedSignals) {
  const fq = formQualification || {};
  const { budgetStr } = partitionBuyerBudgetInputs(fq.budget, seedSignals?.budget);
  let priceFromBudget = budgetStr ? parseMaxBudget(budgetStr) : null;
  if (priceFromBudget == null || !Number.isFinite(priceFromBudget)) {
    priceFromBudget = null;
  }
  return { budgetStr, priceFromBudget };
}

export function buildMortgageAffordabilitySnapshot(formQualification = {}, seedSignals = {}, leadGrade) {
  const fq = formQualification || {};
  const { incomeKey, downKey, grossMid, downPct } = incomeAndDownBands(fq);
  const { priceFromBudget } = resolvePriceFromBudget(fq, seedSignals);
  let assumedPrice = priceFromBudget;
  if (assumedPrice == null && grossMid != null) {
    assumedPrice = Math.round(grossMid * 3.2);
  }
  const flowMeta = actionFlowSlice(leadGrade);
  const flowSpread = flowMeta ? { action_flow: flowMeta } : {};
  if (assumedPrice == null || assumedPrice <= 0) {
    return {
      ...flowSpread,
      household_income_band: incomeKey || null,
      estimated_gross_annual_income: grossMid,
      down_payment_readiness_band: downKey || null,
      estimated_down_payment_percent: downPct,
      price_from_budget: priceFromBudget,
      assumed_purchase_price: null,
      loan_amount: null,
      assumed_interest_rate_percent: DEFAULT_RATE,
      amortization_years: DEFAULT_AMORT_YEARS,
      estimated_monthly_pi: null,
      rough_max_housing_payment_monthly:
        grossMid != null ? Math.round((grossMid / 12) * 0.32) : null,
      affordability_note:
        'Not enough price or income data for a payment estimate. Add a budget or complete household income.',
      disclaimer: AFFORDABILITY_DISCLAIMER,
    };
  }

  const loan = assumedPrice * (1 - downPct / 100);
  const pi = monthlyPI(loan, DEFAULT_RATE, DEFAULT_AMORT_YEARS);
  const roughMaxHousing = grossMid != null ? Math.round((grossMid / 12) * 0.32) : null;
  let note = `Illustrative principal & interest at ${DEFAULT_RATE}% over ${DEFAULT_AMORT_YEARS} years with ~${downPct}% down.`;
  if (roughMaxHousing != null && pi > roughMaxHousing * 1.15) {
    note +=
      ' Estimated payment is above a rough 32% gross-income housing guideline — your broker will confirm affordability.';
  } else if (roughMaxHousing != null) {
    note += ' Roughly within a simple gross-income housing guideline (not a lender rule).';
  }

  return {
    ...flowSpread,
    household_income_band: incomeKey || null,
    estimated_gross_annual_income: grossMid,
    down_payment_readiness_band: downKey || null,
    estimated_down_payment_percent: downPct,
    property_budget_clarity: fq.property_budget || null,
    price_from_budget: priceFromBudget,
    assumed_purchase_price: Math.round(assumedPrice),
    loan_amount: Math.round(loan),
    assumed_interest_rate_percent: DEFAULT_RATE,
    amortization_years: DEFAULT_AMORT_YEARS,
    estimated_monthly_pi: Math.round(pi),
    rough_max_housing_payment_monthly: roughMaxHousing,
    estimated_down_payment_dollars: Math.round(assumedPrice * (downPct / 100)),
    affordability_note: note,
    disclaimer: AFFORDABILITY_DISCLAIMER,
    formatted: {
      assumed_purchase_price: fmtMoney(assumedPrice),
      estimated_monthly_pi: fmtMoney(pi),
      estimated_down_payment_dollars: fmtMoney(assumedPrice * (downPct / 100)),
    },
  };
}
