export function normalizePlanType(plan) {
  if (!plan) return 'free';

  const normalized = String(plan).toLowerCase().trim();

  const map = {
    free: 'free',
    pro: 'pro',
    creator: 'creator',
    elite: 'creator'
  };

  return map[normalized] || 'free';
}
