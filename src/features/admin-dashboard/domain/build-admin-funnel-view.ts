import type { AdminBackofficeReport, AdminFunnelStep } from '../types/index.ts';

export interface AdminFunnelView {
  steps: AdminFunnelStep[];
  strongestDropOff: AdminFunnelStep | null;
}

function normalizeStep(step: AdminFunnelStep): AdminFunnelStep {
  return {
    ...step,
    count: Math.max(0, Math.round(Number(step?.count || 0))),
    conversionPct: Math.max(0, Math.min(100, Number(step?.conversionPct || 0))),
    dropOffPct: Math.max(0, Math.min(100, Number(step?.dropOffPct || 0)))
  };
}

export function buildAdminFunnelView(report: AdminBackofficeReport | null | undefined): AdminFunnelView {
  const steps = Array.isArray(report?.funnel?.steps) ? report.funnel.steps.map(normalizeStep) : [];
  if (steps.length <= 1) {
    return {
      steps,
      strongestDropOff: null
    };
  }
  const strongestDropOff = steps.slice(1).sort((left, right) => right.dropOffPct - left.dropOffPct)[0] || null;
  return {
    steps,
    strongestDropOff
  };
}
