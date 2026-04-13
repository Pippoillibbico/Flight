# Automated Site Test List

This checklist is executed by `npm run test:site` and included in `npm run test:intelligent`.

## Coverage Matrix

1. Landing shell renders with core controls
2. Language switch (EN -> IT) remains functional
3. Auth modal opens and email login/register forms are reachable
4. Dark mode auth surface remains dark (no white bleed)
5. Progressive login: guest can browse feed/detail before sign-in
6. Main navigation sections are available: Home, Explore, Radar, AI Travel, Premium
7. Opportunity feed renders, soft gate appears for guest, detail modal opens
8. Radar preferences can be saved
9. AI Travel query returns only real opportunities from mocked feed
10. Premium page shows 3 plans and featured PRO card
11. Upgrade prompts appear correctly by plan type
12. Cluster selection filters opportunities deterministically
13. Mobile landing has no horizontal overflow
14. Runtime guard catches:
   - console errors
   - page JS exceptions
   - failed app requests
   - API 5xx responses

## Learning Loop

1. Run `npm run test:intelligent`
2. Check `docs/testing/regression-memory.json`
3. Check `docs/testing/regression-latest.md`
4. For every real bug:
   - add a regression assertion/test
   - re-run the suite
   - keep status green before merge

This keeps regression memory and learning history inside the repository.
