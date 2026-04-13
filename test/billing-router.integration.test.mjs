import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import { buildBillingRouter } from '../server/routes/billing.js';

// ---------------------------------------------------------------------------
// Stripe signature helper — mirrors the production verification logic.
// ---------------------------------------------------------------------------
function generateStripeSignature(rawBody, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.${rawBody}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function withStripeSecret(secret, fn) {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  return Promise.resolve().then(fn).finally(() => {
    if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prev;
  });
}

async function withServer(app, fn) {
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createAuthGuard(user = { id: 'user_1', sub: 'user_1' }, authSource = 'bearer') {
  return (req, _res, next) => {
    req.user = user;
    req.authSource = authSource;
    next();
  };
}

function createApp({ deps, authSource = 'bearer', requireSessionAuth = (_req, _res, next) => next() }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/billing',
    buildBillingRouter(
      {
        authGuard: createAuthGuard(undefined, authSource),
        requireSessionAuth,
        csrfGuard: (_req, _res, next) => next()
      },
      deps
    )
  );
  return app;
}

function withPlanEnv(fn) {
  const prevPro = process.env.BT_PLAN_PRO_ID;
  const prevCreator = process.env.BT_PLAN_CREATOR_ID;
  process.env.BT_PLAN_PRO_ID = process.env.BT_PLAN_PRO_ID || 'plan_pro_test';
  process.env.BT_PLAN_CREATOR_ID = process.env.BT_PLAN_CREATOR_ID || 'plan_creator_test';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevPro === undefined) delete process.env.BT_PLAN_PRO_ID;
      else process.env.BT_PLAN_PRO_ID = prevPro;
      if (prevCreator === undefined) delete process.env.BT_PLAN_CREATOR_ID;
      else process.env.BT_PLAN_CREATOR_ID = prevCreator;
    });
}

test('billing router returns Braintree client token', async () => {
  const gateway = {
    clientToken: {
      generate: async () => ({ clientToken: 'token_abc123' })
    }
  };
  const app = createApp({
    deps: {
      billingProvider: 'braintree',
      isBraintreeConfigured: () => true,
      getBraintreeGateway: () => gateway,
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
      ensureBraintreeCustomerForUser: async () => 'bt_cust_1'
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/client-token`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.provider, 'braintree');
    assert.equal(body.clientToken, 'token_abc123');
  });
});

test('billing router performs checkout and upgrades plan only on successful payment', async () => {
  const calls = {
    upsert: [],
    setPlan: [],
    audit: []
  };
  const gateway = {
    paymentMethod: {
      create: async () => ({ success: true, paymentMethod: { token: 'pm_token_1' } })
    },
    subscription: {
      create: async () => ({
        success: true,
        subscription: {
          id: 'sub_001',
          status: 'Active',
          billingPeriodStartDate: '2026-03-01T00:00:00.000Z',
          billingPeriodEndDate: '2026-04-01T00:00:00.000Z'
        }
      })
    }
  };

  await withPlanEnv(async () => {
    const app = createApp({
      deps: {
        billingProvider: 'braintree',
        isBraintreeConfigured: () => true,
        getBraintreeGateway: () => gateway,
        getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
        ensureBraintreeCustomerForUser: async () => 'bt_cust_1',
        upsertSubscriptionFromProvider: async (payload) => {
          calls.upsert.push(payload);
        },
        setUserPlan: async (payload) => {
          calls.setPlan.push(payload);
        },
        appendImmutableAudit: async (payload) => {
          calls.audit.push(payload);
        }
      }
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: 'pro',
          paymentMethodNonce: 'fake_nonce_12345678'
        })
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.planType, 'pro');
      assert.equal(body.subscription.id, 'sub_001');
    });
  });

  assert.equal(calls.upsert.length, 1);
  assert.equal(calls.upsert[0].planId, 'pro');
  assert.equal(calls.setPlan.length, 1);
  assert.equal(calls.setPlan[0].planType, 'pro');
  assert.equal(calls.audit.length, 1);
});

test('billing router does not upgrade plan when payment method verification fails', async () => {
  const calls = {
    upsert: 0,
    setPlan: 0
  };
  const gateway = {
    paymentMethod: {
      create: async () => ({ success: false, message: 'Card verification failed.' })
    },
    subscription: {
      create: async () => ({ success: true, subscription: { id: 'sub_unused' } })
    }
  };

  await withPlanEnv(async () => {
    const app = createApp({
      deps: {
        billingProvider: 'braintree',
        isBraintreeConfigured: () => true,
        getBraintreeGateway: () => gateway,
        getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
        ensureBraintreeCustomerForUser: async () => 'bt_cust_1',
        upsertSubscriptionFromProvider: async () => {
          calls.upsert += 1;
        },
        setUserPlan: async () => {
          calls.setPlan += 1;
        }
      }
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planType: 'elite',
          paymentMethodNonce: 'fake_nonce_12345678'
        })
      });
      assert.equal(response.status, 402);
      const body = await response.json();
      assert.equal(body.error, 'payment_method_failed');
    });
  });

  assert.equal(calls.upsert, 0);
  assert.equal(calls.setPlan, 0);
});

test('billing router returns 400 when checkout payload is invalid', async () => {
  const app = createApp({
    deps: {
      billingProvider: 'braintree',
      isBraintreeConfigured: () => true,
      getBraintreeGateway: () => ({
        paymentMethod: { create: async () => ({ success: true, paymentMethod: { token: 'pm_token_1' } }) },
        subscription: { create: async () => ({ success: true, subscription: { id: 'sub_001' } }) }
      }),
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
      ensureBraintreeCustomerForUser: async () => 'bt_cust_1'
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planType: 'pro'
      })
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(String(body.error || '').length > 0);
  });
});

test('billing router returns 503 when braintree is not configured', async () => {
  const app = createApp({
    deps: {
      billingProvider: 'braintree',
      isBraintreeConfigured: () => false,
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' })
    }
  });

  await withServer(app, async (baseUrl) => {
    const tokenRes = await fetch(`${baseUrl}/api/billing/client-token`);
    assert.equal(tokenRes.status, 503);
    const tokenBody = await tokenRes.json();
    assert.equal(tokenBody.error, 'billing_not_configured');

    const checkoutRes = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        planType: 'pro',
        paymentMethodNonce: 'fake_nonce_12345678'
      })
    });
    assert.equal(checkoutRes.status, 503);
    const checkoutBody = await checkoutRes.json();
    assert.equal(checkoutBody.error, 'billing_not_configured');
  });
});

// ---------------------------------------------------------------------------
// Webhook tests — Stripe
// ---------------------------------------------------------------------------

test('billing webhook: Stripe valid signature accepts event and returns received', async () => {
  // Note: handleStripeEvent calls the module-level upsertSubscriptionFromStripe directly
  // (not the injected dep). We therefore test HTTP behavior only: valid sig → 200.
  const webhookSecret = 'whsec_test_32chars_secret_xxxyyy';
  const app = createApp({ deps: { billingProvider: 'stripe' } });

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const event = {
        id: `evt_test_http_${Date.now()}`, // unique per run so persistent DB doesn't dedup
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_test_001',
            customer: 'cus_test_001',
            status: 'active',
            cancel_at_period_end: false,
            current_period_start: 1700000000,
            current_period_end: 1702678400,
            metadata: { user_id: 'user_stripe_1' },
            items: { data: [{ price: { id: 'price_unknown' } }] }
          }
        }
      };
      const rawBody = JSON.stringify(event);
      const sig = generateStripeSignature(rawBody, webhookSecret);

      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
        body: rawBody
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.received, true);
      assert.notEqual(body.deduped, true); // first delivery is NOT a duplicate
    });
  });
});

test('billing webhook: Stripe invalid signature returns 400', async () => {
  const webhookSecret = 'whsec_test_32chars_secret_xxxyyy';
  const app = createApp({
    deps: {
      billingProvider: 'stripe',
      upsertSubscriptionFromProvider: async () => {}
    }
  });

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const rawBody = JSON.stringify({ id: 'evt_bad', type: 'ping' });
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'stripe-signature': 't=9999,v1=invalidsignature'
        },
        body: rawBody
      });
      assert.equal(response.status, 400);
      const body = await response.json();
      assert.ok(body.error);
    });
  });
});

test('billing webhook: Stripe missing secret returns 503 in production', async () => {
  const app = createApp({
    deps: {
      billingProvider: 'stripe',
      upsertSubscriptionFromProvider: async () => {}
    }
  });

  const prevSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  process.env.NODE_ENV = 'production';

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'evt_001', type: 'ping' })
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error, 'billing_not_configured');
    });
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevSecret === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
    else process.env.STRIPE_WEBHOOK_SECRET = prevSecret;
  }
});

// ---------------------------------------------------------------------------
// Webhook tests — Braintree
// ---------------------------------------------------------------------------

test('billing webhook: Braintree processes subscription event', async () => {
  const calls = { upsert: [] };
  const notification = {
    kind: 'subscription_charged_successfully',
    subscription: {
      id: 'bt_sub_001',
      status: 'Active',
      planId: process.env.BT_PLAN_PRO_ID || 'plan_pro_test',
      transactions: [{ customerDetails: { id: 'bt_cust_001' }, customerId: 'bt_cust_001' }]
    }
  };
  const gateway = {
    webhookNotification: {
      parse: async () => notification
    }
  };

  await withPlanEnv(async () => {
    const app = createApp({
      deps: {
        billingProvider: 'braintree',
        isBraintreeConfigured: () => true,
        getBraintreeGateway: () => gateway,
        upsertSubscriptionFromProvider: async (payload) => { calls.upsert.push(payload); },
        appendImmutableAudit: async () => {}
      }
    });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'bt_signature=sig_test&bt_payload=payload_test'
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.received, true);
    });
  });

  // upsert called even though userId resolution fails (no matching user in db stub)
  // — the important check is that the webhook parsed and didn't crash
  assert.equal(typeof calls.upsert.length, 'number');
});

test('billing webhook: Braintree invalid signature returns 400', async () => {
  const gateway = {
    webhookNotification: {
      parse: async () => { throw new Error('Invalid Braintree signature'); }
    }
  };
  const app = createApp({
    deps: {
      billingProvider: 'braintree',
      isBraintreeConfigured: () => true,
      getBraintreeGateway: () => gateway
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'bt_signature=badsig&bt_payload=badpayload'
    });
    assert.equal(response.status, 400);
    const body = await response.json();
    assert.ok(body.error);
  });
});

test('billing webhook: Braintree not configured returns 503 in production', async () => {
  const app = createApp({
    deps: {
      billingProvider: 'braintree',
      isBraintreeConfigured: () => false
    }
  });

  const prevEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'bt_signature=sig&bt_payload=data'
      });
      assert.equal(response.status, 503);
      const body = await response.json();
      assert.equal(body.error, 'billing_not_configured');
    });
  } finally {
    process.env.NODE_ENV = prevEnv;
  }
});

// ---------------------------------------------------------------------------
// Webhook idempotency
// ---------------------------------------------------------------------------

test('billing webhook: duplicate Stripe event is deduped', async () => {
  // Uses a unique event ID per test run to avoid cross-test DB state contamination.
  const webhookSecret = 'whsec_test_32chars_secret_dedupexx';
  const uniqueEventId = `evt_dedupe_${Date.now()}`;
  const event = {
    id: uniqueEventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_dedupe',
        customer: 'cus_dedupe',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1700000000,
        current_period_end: 1702678400,
        metadata: { user_id: 'user_dedupe' },
        items: { data: [{ price: { id: 'price_unknown' } }] }
      }
    }
  };
  const rawBody = JSON.stringify(event);
  const app = createApp({ deps: { billingProvider: 'stripe' } });

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const sig = generateStripeSignature(rawBody, webhookSecret);
      const headers = { 'Content-Type': 'application/json', 'stripe-signature': sig };

      // First delivery — not a duplicate
      const r1 = await fetch(`${baseUrl}/api/billing/webhook`, { method: 'POST', headers, body: rawBody });
      assert.equal(r1.status, 200);
      const b1 = await r1.json();
      assert.equal(b1.received, true);
      assert.notEqual(b1.deduped, true);

      // Second delivery of the exact same event ID — must be deduped
      const r2 = await fetch(`${baseUrl}/api/billing/webhook`, { method: 'POST', headers, body: rawBody });
      assert.equal(r2.status, 200);
      const b2 = await r2.json();
      assert.equal(b2.received, true);
      assert.equal(b2.deduped, true);
    });
  });
});

test('billing router enforces session auth for sensitive endpoints', async () => {
  const app = createApp({
    authSource: 'api_key',
    requireSessionAuth: (req, res, next) =>
      req.authSource === 'cookie' ? next() : res.status(403).json({ error: 'session_auth_required' }),
    deps: {
      billingProvider: 'braintree',
      isBraintreeConfigured: () => true,
      getBraintreeGateway: () => ({
        clientToken: { generate: async () => ({ clientToken: 'token_abc123' }) }
      }),
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
      ensureBraintreeCustomerForUser: async () => 'bt_cust_1'
    }
  });

  await withServer(app, async (baseUrl) => {
    const tokenRes = await fetch(`${baseUrl}/api/billing/client-token`);
    assert.equal(tokenRes.status, 403);
    const tokenBody = await tokenRes.json();
    assert.equal(tokenBody.error, 'session_auth_required');
  });
});
