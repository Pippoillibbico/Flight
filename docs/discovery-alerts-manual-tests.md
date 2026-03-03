# Discovery + Alerts Manual Test Checklist

## 1) Discovery just-go (free vs paid package count)
1. Create/login a free user.
2. Call `POST /api/discovery/just-go` with:
   - `origin`, `budget`, `mood`, `region`, `dateFrom`, `dateTo`.
3. Verify response:
   - `ai_included` is `false`.
   - `items.length` is `3` max.
4. Upgrade same user to `pro` or `creator`.
5. Call endpoint again with same payload.
6. Verify `items.length` is `4` max.

## 2) Discovery subscription save + list + delete
1. `POST /api/discovery/subscriptions` with:
   - `origin`, `budget`, `mood`, `region`, `dateFrom`, `dateTo`.
2. Verify `201` and returned `item.id`.
3. `GET /api/discovery/subscriptions`.
4. Verify created subscription is present.
5. `DELETE /api/discovery/subscriptions/:id`.
6. Verify `204` and item disappears from list.

## 3) Dedupe/idempotency on worker
1. Create one discovery subscription.
2. Ingest one qualifying observation (great/scream + under budget).
3. Run discovery worker once.
4. Verify one notification created (`type=discovery_alert`).
5. Run worker again without new observations.
6. Verify no additional notification is created (same `dedupeKey`).
7. Re-ingest same observation payload (same fingerprint).
8. Run worker again.
9. Verify no duplicate notification (idempotent).

## 4) Upgrade path behavior
1. Free user with same query + data:
   - confirm 3 packages max.
2. Upgrade to paid:
   - confirm 4 packages max.
3. Ensure old subscriptions continue to trigger notifications after upgrade.

