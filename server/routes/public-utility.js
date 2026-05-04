import express from 'express';
import { z } from 'zod';

const affiliateLinksQuerySchema = z
  .object({
    origin: z.string().trim().regex(/^[A-Za-z]{3}$/),
    destination: z.string().trim().regex(/^[A-Za-z]{3}$/),
    dateFrom: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    dateTo: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    travellers: z.coerce.number().int().min(1).max(9).optional().default(1),
    cabin: z.enum(['economy', 'premium', 'business']).optional().default('economy')
  })
  .strict();

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
    const parsed = affiliateLinksQuerySchema.safeParse(req.query || {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid query.' });
    const { origin, destination, dateFrom, dateTo, travellers, cabin } = parsed.data;
    const links = buildAllAffiliateLinks({
      origin: origin.toUpperCase(),
      destinationIata: destination.toUpperCase(),
      dateFrom,
      dateTo: dateTo || null,
      travellers,
      cabinClass: cabin
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
