export interface RoiInputs {
  averageServiceCents: number;
  variableExpensePct: number; // 0–100
  monthlyFeeCents: number;
  setupFeeCents: number;
  additionalAppointmentsPerMonth: number; // GENUINELY incremental — not every AI-booked appointment
}

export interface RoiResult {
  contributionPerAppointmentCents: number;
  breakEvenAppointmentsPerMonth: number;
  incrementalRevenueMonthlyCents: number;
  incrementalProfitMonthlyCents: number;
  annualCostCents: number;
  annualIncrementalProfitCents: number; // after subscription + setup
  annualRoiPct: number | null; // null when cost is 0
}

export const TCUTZ_ROI_DEFAULTS: RoiInputs = {
  averageServiceCents: 3000,
  variableExpensePct: 15,
  monthlyFeeCents: 14900,
  setupFeeCents: 0,
  additionalAppointmentsPerMonth: 10,
};

export function calculateRoi(i: RoiInputs): RoiResult {
  const contribution = Math.round(i.averageServiceCents * (1 - i.variableExpensePct / 100));
  const breakEven = contribution > 0 ? Math.ceil(i.monthlyFeeCents / contribution) : Infinity;
  const revenue = i.additionalAppointmentsPerMonth * i.averageServiceCents;
  const grossContribution = i.additionalAppointmentsPerMonth * contribution;
  const annualCost = i.monthlyFeeCents * 12 + i.setupFeeCents;
  const annualNet = grossContribution * 12 - annualCost;
  return {
    contributionPerAppointmentCents: contribution,
    breakEvenAppointmentsPerMonth: breakEven,
    incrementalRevenueMonthlyCents: revenue,
    incrementalProfitMonthlyCents: grossContribution - i.monthlyFeeCents,
    annualCostCents: annualCost,
    annualIncrementalProfitCents: annualNet,
    annualRoiPct: annualCost > 0 ? Math.round((annualNet / annualCost) * 1000) / 10 : null,
  };
}
