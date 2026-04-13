import type { PlanComparisonRow } from '../types/index.ts';

const PLAN_COMPARISON_ROWS: PlanComparisonRow[] = [
  {
    feature: 'Tracked routes',
    free: 'Up to 3',
    pro: 'Up to 10',
    elite: 'Unlimited'
  },
  {
    feature: 'Saved itineraries',
    free: 'Up to 3',
    pro: 'Up to 10',
    elite: 'Unlimited'
  },
  {
    feature: 'Radar level',
    free: 'Basic',
    pro: 'Advanced',
    elite: 'Priority'
  },
  {
    feature: 'AI Travel suggestions',
    free: 'Top 3 candidates',
    pro: 'Full generation',
    elite: 'Full + priority intelligence'
  }
];

export function getPlanComparisonRows(): PlanComparisonRow[] {
  return PLAN_COMPARISON_ROWS;
}
