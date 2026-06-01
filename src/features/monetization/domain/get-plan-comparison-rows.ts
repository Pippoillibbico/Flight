import type { PlanComparisonRow } from '../types/index.ts';

type Translator = (key: string) => string;

function label(t: Translator | undefined, key: string, fallback: string): string {
  const translated = typeof t === 'function' ? t(key) : '';
  return translated && translated !== key ? translated : fallback;
}

export function getPlanComparisonRows(t?: Translator): PlanComparisonRow[] {
  return [
  {
    feature: label(t, 'upgradeFlowTrackedRoutes', 'Tracked routes'),
    free: label(t, 'upgradeFlowUpToOne', 'Up to 1'),
    pro: label(t, 'upgradeFlowUpToTen', 'Up to 10'),
    elite: label(t, 'upgradeFlowUnlimited', 'Unlimited')
  },
  {
    feature: label(t, 'upgradeFlowSavedItineraries', 'Saved itineraries'),
    free: label(t, 'upgradeFlowUpToThree', 'Up to 3'),
    pro: label(t, 'upgradeFlowUpToTen', 'Up to 10'),
    elite: label(t, 'upgradeFlowUnlimited', 'Unlimited')
  },
  {
    feature: label(t, 'upgradeFlowRadarLevel', 'Radar level'),
    free: label(t, 'upgradeFlowBasic', 'Basic'),
    pro: label(t, 'upgradeFlowAdvanced', 'Advanced'),
    elite: label(t, 'upgradeFlowPriority', 'Priority')
  },
  {
    feature: label(t, 'upgradeFlowAiTravelSuggestions', 'AI Travel suggestions'),
    free: label(t, 'upgradeFlowNotIncluded', 'Not included'),
    pro: label(t, 'upgradeFlowFullGeneration', 'Full generation'),
    elite: label(t, 'upgradeFlowFullPriorityIntelligence', 'Full + priority intelligence')
  }
  ];
}
