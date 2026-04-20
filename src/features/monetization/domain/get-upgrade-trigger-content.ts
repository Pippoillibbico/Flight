import { normalizeUserPlan } from './plan-entitlements.ts';
import type { UpgradeTriggerContent, UpgradeTriggerContext, UserPlan } from '../types/index.ts';

function trackedRoutesMessage(plan: UserPlan, used: number, limit: number | null): string {
  if (limit === null) return 'Track more routes and never miss a drop.';
  if (plan === 'free') {
    return `You are tracking ${used}/${limit} routes. Track more routes and never miss a drop.`;
  }
  return `You are tracking ${used}/${limit} routes. Go ELITE to track unlimited routes and unlock priority deals before others.`;
}

function savedItinerariesMessage(plan: UserPlan, used: number, limit: number | null): string {
  if (limit === null) return 'Save more itineraries and keep your best opportunities in one place.';
  if (plan === 'free') {
    return `You saved ${used}/${limit} itineraries. Unlock more saved itineraries and keep every high-value route in view.`;
  }
  return `You saved ${used}/${limit} itineraries. Go ELITE to save unlimited itineraries and never lose a top opportunity.`;
}

export function getUpgradeTriggerContent(
  plan: unknown,
  context: UpgradeTriggerContext,
  options: { used?: number; limit?: number | null } = {}
): UpgradeTriggerContent {
  const normalizedPlan = normalizeUserPlan(plan);
  const used = Math.max(0, Math.round(Number(options.used) || 0));
  const limit = options.limit === null || Number.isFinite(Number(options.limit)) ? options.limit ?? null : null;

  if (context === 'tracked_routes_limit') {
    return {
      title: 'Tracking limit reached',
      message: trackedRoutesMessage(normalizedPlan, used, limit),
      proLabel: 'Upgrade to PRO',
      eliteLabel: 'Go ELITE'
    };
  }

  if (context === 'saved_itineraries_limit') {
    return {
      title: 'Saved itineraries limit reached',
      message: savedItinerariesMessage(normalizedPlan, used, limit),
      proLabel: 'Upgrade to PRO',
      eliteLabel: 'Go ELITE'
    };
  }

  if (context === 'radar_hot_opened') {
    return {
      title: 'Get notified when this drops',
      message:
        normalizedPlan === 'free'
          ? 'Unlock priority deals before others and activate stronger radar monitoring for hot opportunities.'
          : 'Go ELITE to unlock priority deal visibility and stronger radar messaging for hot opportunities.',
      proLabel: 'Upgrade to PRO',
      eliteLabel: 'Go ELITE'
    };
  }

  if (context === 'ai_travel_limit') {
    return {
      title: 'See more AI-generated itineraries',
      message:
        normalizedPlan === 'free'
          ? 'FREE shows the top 3 suggestions. Upgrade to unlock full AI itinerary generation.'
          : 'Go ELITE to unlock the highest-priority intelligence layer on AI itinerary suggestions.',
      proLabel: 'Upgrade to PRO',
      eliteLabel: 'Go ELITE'
    };
  }

  if (context === 'limited_results_soft') {
    return {
      title: 'Stai vedendo una versione limitata dei risultati',
      message: 'Con PRO puoi sbloccare risultati reali e continuare a cercare senza restrizioni.',
      proLabel: 'Sblocca risultati reali',
      eliteLabel: 'Go ELITE'
    };
  }

  if (context === 'deal_urgency') {
    return {
      title: 'Questo prezzo potrebbe non restare disponibile a lungo',
      message: 'Con PRO puoi verificare più rapidamente i risultati reali e seguire le opportunità migliori.',
      proLabel: 'Verifica disponibilità',
      eliteLabel: 'Go ELITE'
    };
  }

  return {
    title: 'Make your radar smarter',
    message:
      normalizedPlan === 'free'
        ? 'Track more routes, save more itineraries, and unlock stronger radar signals.'
        : 'Go ELITE for unlimited tracking, unlimited saves, and priority opportunity visibility.',
    proLabel: 'Upgrade to PRO',
    eliteLabel: 'Go ELITE'
  };
}
