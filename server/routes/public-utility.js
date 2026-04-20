import express from 'express';

export function buildPublicUtilityRouter({
  buildAllAffiliateLinks,
  authGuard,
  csrfGuard,
  premiumGuard,
  requireApiScope,
  quotaGuard,
  destinationInsightSchema,
  buildDestinationInsights,
  searchFlights
}) {
  const router = express.Router();

  router.get('/api/affiliate/links', async (req, res) => {
    const { origin, destination, dateFrom, dateTo, travellers = '1', cabin = 'economy' } = req.query;
    if (!origin || !destination || !dateFrom) {
      return res.status(400).json({ error: 'origin, destination and dateFrom are required.' });
    }
    const links = buildAllAffiliateLinks({
      origin: String(origin).toUpperCase().slice(0, 3),
      destinationIata: String(destination).toUpperCase().slice(0, 3),
      dateFrom: String(dateFrom).slice(0, 10),
      dateTo: dateTo ? String(dateTo).slice(0, 10) : null,
      travellers: Math.min(9, Math.max(1, Number(travellers) || 1)),
      cabinClass: ['economy', 'premium', 'business'].includes(String(cabin)) ? cabin : 'economy'
    });
    return res.json({ links });
  });

  router.post(
    '/api/insights/destination',
    authGuard,
    csrfGuard,
    premiumGuard,
    requireApiScope('search'),
    quotaGuard({ counter: 'decision', amount: 1 }),
    async (req, res) => {
      const parsed = destinationInsightSchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid payload.' });

      const result = buildDestinationInsights(parsed.data, { searchFlights });
      return res.json(result);
    }
  );

  return router;
}
