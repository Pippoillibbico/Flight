import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import { buildBillingRouter } from '../server/routes/billing.js';

function generateStripeSignature(rawBody, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const payload = `${timestamp}.${rawBody}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function withStripeSecret(secret, fn) {
  const prev = process.env.STRIPE_WEBHOOK_SECRET;
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prev === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = prev;
    });
}

function withStripePrices(fn) {
  const prevPro = process.env.STRIPE_PRICE_PRO;
  const prevCreator = process.env.STRIPE_PRICE_CREATOR;
  process.env.STRIPE_PRICE_PRO = process.env.STRIPE_PRICE_PRO || 'price_pro_test_123';
  process.env.STRIPE_PRICE_CREATOR = process.env.STRIPE_PRICE_CREATOR || 'price_creator_test_123';
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (prevPro === undefined) delete process.env.STRIPE_PRICE_PRO;
      else process.env.STRIPE_PRICE_PRO = prevPro;
      if (prevCreator === undefined) delete process.env.STRIPE_PRICE_CREATOR;
      else process.env.STRIPE_PRICE_CREATOR = prevCreator;
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

function createAuthGuard(user = { id: 'user_1', sub: 'user_1', email: 'user@example.com' }, authSource = 'cookie') {
  return (req, _res, next) => {
    req.user = user;
    req.authSource = authSource;
    next();
  };
}

function createApp({ deps = {}, authSource = 'cookie', requireSessionAuth = (_req, _res, next) => next() } = {}) {
  const app = express();
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
    if (Buffer.isBuffer(req.body)) req.rawBody = req.body.toString('utf8');
    next();
  });
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

test('billing webhook accepts a valid Stripe signature', async () => {
  const webhookSecret = 'whsec_test_32chars_secret_xxxyyy';
  const app = createApp();

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const event = {
        id: `evt_test_http_${Date.now()}`,
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
      assert.notEqual(body.deduped, true);
    });
  });
});

test('billing webhook rejects invalid Stripe signature', async () => {
  const webhookSecret = 'whsec_test_32chars_secret_xxxyyy';
  const app = createApp();

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

test('billing webhook returns 503 in production when Stripe webhook secret is missing', async () => {
  const app = createApp();

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

test('billing webhook deduplicates repeated Stripe events', async () => {
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
  const app = createApp();

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const sig = generateStripeSignature(rawBody, webhookSecret);
      const headers = { 'Content-Type': 'application/json', 'stripe-signature': sig };

      const first = await fetch(`${baseUrl}/api/billing/webhook`, { method: 'POST', headers, body: rawBody });
      assert.equal(first.status, 200);
      const firstBody = await first.json();
      assert.equal(firstBody.received, true);
      assert.notEqual(firstBody.deduped, true);

      const second = await fetch(`${baseUrl}/api/billing/webhook`, { method: 'POST', headers, body: rawBody });
      assert.equal(second.status, 200);
      const secondBody = await second.json();
      assert.equal(secondBody.received, true);
      assert.equal(secondBody.deduped, true);
    });
  });
});

test('billing webhook rejects livemode mismatch in production with live Stripe key', async () => {
  const webhookSecret = 'whsec_test_32chars_secret_modecheck';
  const prevEnv = process.env.NODE_ENV;
  const prevKey = process.env.STRIPE_SECRET_KEY;
  process.env.NODE_ENV = 'production';
  process.env.STRIPE_SECRET_KEY = 'sk_live_example_key_1234567890';

  const app = createApp();
  const event = {
    id: `evt_mode_mismatch_${Date.now()}`,
    type: 'customer.subscription.updated',
    livemode: false,
    data: {
      object: {
        id: 'sub_mode',
        customer: 'cus_mode',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1700000000,
        current_period_end: 1702678400,
        metadata: { user_id: 'user_mode' },
        items: { data: [{ price: { id: 'price_unknown' } }] }
      }
    }
  };
  const rawBody = JSON.stringify(event);

  try {
    await withStripeSecret(webhookSecret, async () => {
      await withServer(app, async (baseUrl) => {
        const sig = generateStripeSignature(rawBody, webhookSecret);
        const response = await fetch(`${baseUrl}/api/billing/webhook`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
          body: rawBody
        });
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.error, 'stripe_webhook_mode_mismatch');
      });
    });
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevKey;
  }
});

test('billing webhook syncs subscription state on invoice.payment_succeeded when invoice contains subscription id', async () => {
  const webhookSecret = 'whsec_test_32chars_secret_invoice_sxx';
  const calls = { retrieve: 0 };
  const stripeClient = {
    subscriptions: {
      retrieve: async (subscriptionId) => {
        calls.retrieve += 1;
        return {
          id: subscriptionId,
          customer: 'cus_invoice_sync',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          metadata: { user_id: 'user_invoice_sync', plan_type: 'pro' },
          items: { data: [{ price: { id: 'price_pro_test_123' } }] }
        };
      }
    }
  };
  const app = createApp({
    deps: {
      getStripeClient: () => stripeClient,
      isStripeConfigured: () => true,
      resolveUserIdFromStripeCustomer: async () => 'user_invoice_sync',
      appendImmutableAudit: async () => {}
    }
  });
  const event = {
    id: `evt_invoice_succeeded_${Date.now()}`,
    type: 'invoice.payment_succeeded',
    data: {
      object: {
        id: 'in_test_001',
        customer: 'cus_invoice_sync',
        subscription: 'sub_invoice_sync_001',
        amount_paid: 1299,
        currency: 'eur'
      }
    }
  };
  const rawBody = JSON.stringify(event);

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const sig = generateStripeSignature(rawBody, webhookSecret);
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
        body: rawBody
      });
      assert.equal(response.status, 200);
    });
  });

  assert.equal(calls.retrieve, 1);
});

test('billing webhook syncs subscription state on invoice.payment_failed when invoice contains subscription id', async () => {
  const webhookSecret = 'whsec_test_32chars_secret_invoice_fxx';
  const calls = { retrieve: 0 };
  const stripeClient = {
    subscriptions: {
      retrieve: async (subscriptionId) => {
        calls.retrieve += 1;
        return {
          id: subscriptionId,
          customer: 'cus_invoice_failed_sync',
          status: 'past_due',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          metadata: { user_id: 'user_invoice_failed_sync', plan_type: 'pro' },
          items: { data: [{ price: { id: 'price_pro_test_123' } }] }
        };
      }
    }
  };
  const app = createApp({
    deps: {
      getStripeClient: () => stripeClient,
      isStripeConfigured: () => true,
      resolveUserIdFromStripeCustomer: async () => 'user_invoice_failed_sync',
      appendImmutableAudit: async () => {}
    }
  });
  const event = {
    id: `evt_invoice_failed_${Date.now()}`,
    type: 'invoice.payment_failed',
    data: {
      object: {
        id: 'in_test_002',
        customer: 'cus_invoice_failed_sync',
        subscription: 'sub_invoice_failed_sync_001',
        amount_due: 1299,
        currency: 'eur'
      }
    }
  };
  const rawBody = JSON.stringify(event);

  await withStripeSecret(webhookSecret, async () => {
    await withServer(app, async (baseUrl) => {
      const sig = generateStripeSignature(rawBody, webhookSecret);
      const response = await fetch(`${baseUrl}/api/billing/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'stripe-signature': sig },
        body: rawBody
      });
      assert.equal(response.status, 200);
    });
  });

  assert.equal(calls.retrieve, 1);
});

test('billing checkout creates a Stripe checkout session', async () => {
  const calls = { checkout: [], audit: [] };
  let expectedProPrice = '';
  const stripeClient = {
    checkout: {
      sessions: {
        create: async (payload) => {
          calls.checkout.push(payload);
          return { id: 'cs_test_001', url: 'https://checkout.stripe.com/c/pay/test_session_001' };
        }
      }
    }
  };

  await withStripePrices(async () => {
    expectedProPrice = String(process.env.STRIPE_PRICE_PRO || '');
    const app = createApp({
      deps: {
        isStripeConfigured: () => true,
        getStripeClient: () => stripeClient,
        getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
        ensureStripeCustomerForUser: async () => 'cus_test_001',
        appendImmutableAudit: async (payload) => {
          calls.audit.push(payload);
        }
      }
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType: 'pro' })
      });
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.provider, 'stripe');
      assert.equal(body.planType, 'pro');
      assert.equal(body.sessionId, 'cs_test_001');
    });
  });

  assert.equal(calls.checkout.length, 1);
  assert.equal(calls.checkout[0].mode, 'subscription');
  assert.equal(calls.checkout[0].line_items[0].price, expectedProPrice);
  assert.equal(calls.audit.length, 1);
});

test('billing checkout returns 503 when Stripe is not configured', async () => {
  const app = createApp({
    deps: {
      isStripeConfigured: () => false
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planType: 'pro' })
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'billing_not_configured');
  });
});

test('billing checkout does not allow inline price-data fallback in production', async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevInline = process.env.STRIPE_ALLOW_INLINE_PRICE_DATA;
  const prevPro = process.env.STRIPE_PRICE_PRO;
  const prevCreator = process.env.STRIPE_PRICE_CREATOR;
  process.env.NODE_ENV = 'production';
  process.env.STRIPE_ALLOW_INLINE_PRICE_DATA = 'true';
  delete process.env.STRIPE_PRICE_PRO;
  delete process.env.STRIPE_PRICE_CREATOR;

  const app = createApp({
    deps: {
      isStripeConfigured: () => true,
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' })
    }
  });

  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType: 'pro' })
      });
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.error, 'billing_plan_not_configured');
    });
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevInline === undefined) delete process.env.STRIPE_ALLOW_INLINE_PRICE_DATA;
    else process.env.STRIPE_ALLOW_INLINE_PRICE_DATA = prevInline;
    if (prevPro === undefined) delete process.env.STRIPE_PRICE_PRO;
    else process.env.STRIPE_PRICE_PRO = prevPro;
    if (prevCreator === undefined) delete process.env.STRIPE_PRICE_CREATOR;
    else process.env.STRIPE_PRICE_CREATOR = prevCreator;
  }
});

test('billing portal creates a Stripe customer portal session', async () => {
  const stripeClient = {
    billingPortal: {
      sessions: {
        create: async () => ({ url: 'https://billing.stripe.com/p/session_001' })
      }
    }
  };

  const app = createApp({
    deps: {
      isStripeConfigured: () => true,
      getStripeClient: () => stripeClient,
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
      ensureStripeCustomerForUser: async () => 'cus_test_001'
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/portal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.provider, 'stripe');
    assert.equal(body.url, 'https://billing.stripe.com/p/session_001');
  });
});

test('billing change-plan updates Stripe subscription price and returns normalized subscription', async () => {
  const calls = { update: [] };
  await withStripePrices(async () => {
    const expectedCreatorPrice = String(process.env.STRIPE_PRICE_CREATOR || '');
    const stripeClient = {
      subscriptions: {
        retrieve: async () => ({
          id: 'sub_test_001',
          customer: 'cus_test_001',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          metadata: { user_id: 'user_1', plan_type: 'pro' },
          items: {
            data: [{ id: 'si_test_001', price: { id: String(process.env.STRIPE_PRICE_PRO || '') } }]
          }
        }),
        list: async () => ({ data: [] }),
        update: async (_subscriptionId, payload) => {
          calls.update.push(payload);
          return {
            id: 'sub_test_001',
            customer: 'cus_test_001',
            status: 'active',
            cancel_at_period_end: false,
            current_period_start: 1700000000,
            current_period_end: 1702678400,
            metadata: { user_id: 'user_1', plan_type: 'elite' },
            items: {
              data: [{ id: 'si_test_001', price: { id: expectedCreatorPrice } }]
            }
          };
        }
      }
    };

    const app = createApp({
      deps: {
        isStripeConfigured: () => true,
        getStripeClient: () => stripeClient,
        getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User', stripeCustomerId: 'cus_test_001' }),
        getOrCreateSubscription: async () => ({
          id: 'sub_local_1',
          user_id: 'user_1',
          stripe_subscription_id: 'sub_test_001',
          plan_id: 'pro',
          status: 'active'
        }),
        upsertSubscriptionFromProvider: async () => {},
        setUserPlan: async () => {},
        appendImmutableAudit: async () => {}
      }
    });

    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/subscription/change-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planType: 'elite' })
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.ok, true);
      assert.equal(body.provider, 'stripe');
      assert.equal(body.subscription.planId, 'creator');
      assert.equal(body.subscription.planType, 'elite');
      assert.equal(body.subscription.status, 'active');
    });

    assert.equal(calls.update.length, 1);
    assert.equal(calls.update[0].items[0].price, expectedCreatorPrice);
  });
});

test('billing cancel marks subscription cancel_at_period_end when requested', async () => {
  const calls = { update: [] };
  const stripeClient = {
    subscriptions: {
      retrieve: async () => ({
        id: 'sub_test_001',
        customer: 'cus_test_001',
        status: 'active',
        cancel_at_period_end: false,
        current_period_start: 1700000000,
        current_period_end: 1702678400,
        metadata: { user_id: 'user_1', plan_type: 'pro' },
        items: { data: [{ id: 'si_test_001', price: { id: String(process.env.STRIPE_PRICE_PRO || 'price_pro_test_123') } }] }
      }),
      list: async () => ({ data: [] }),
      update: async (_subscriptionId, payload) => {
        calls.update.push(payload);
        return {
          id: 'sub_test_001',
          customer: 'cus_test_001',
          status: 'active',
          cancel_at_period_end: true,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          metadata: { user_id: 'user_1', plan_type: 'pro' },
          items: { data: [{ id: 'si_test_001', price: { id: String(process.env.STRIPE_PRICE_PRO || 'price_pro_test_123') } }] }
        };
      },
      cancel: async () => {
        throw new Error('cancel should not be called in this test');
      }
    }
  };

  const app = createApp({
    deps: {
      isStripeConfigured: () => true,
      getStripeClient: () => stripeClient,
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User', stripeCustomerId: 'cus_test_001' }),
      getOrCreateSubscription: async () => ({
        id: 'sub_local_1',
        user_id: 'user_1',
        stripe_subscription_id: 'sub_test_001',
        plan_id: 'pro',
        status: 'active'
      }),
      upsertSubscriptionFromProvider: async () => {},
      setUserPlan: async () => {},
      appendImmutableAudit: async () => {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/subscription/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cancelAtPeriodEnd: true })
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.canceledAtPeriodEnd, true);
    assert.equal(body.subscription.cancelAtPeriodEnd, true);
  });

  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].cancel_at_period_end, true);
});

test('billing resume clears cancel_at_period_end', async () => {
  const calls = { update: [] };
  const stripeClient = {
    subscriptions: {
      retrieve: async () => ({
        id: 'sub_test_001',
        customer: 'cus_test_001',
        status: 'active',
        cancel_at_period_end: true,
        current_period_start: 1700000000,
        current_period_end: 1702678400,
        metadata: { user_id: 'user_1', plan_type: 'pro' },
        items: { data: [{ id: 'si_test_001', price: { id: String(process.env.STRIPE_PRICE_PRO || 'price_pro_test_123') } }] }
      }),
      list: async () => ({ data: [] }),
      update: async (_subscriptionId, payload) => {
        calls.update.push(payload);
        return {
          id: 'sub_test_001',
          customer: 'cus_test_001',
          status: 'active',
          cancel_at_period_end: false,
          current_period_start: 1700000000,
          current_period_end: 1702678400,
          metadata: { user_id: 'user_1', plan_type: 'pro' },
          items: { data: [{ id: 'si_test_001', price: { id: String(process.env.STRIPE_PRICE_PRO || 'price_pro_test_123') } }] }
        };
      },
      resume: async () => {
        throw new Error('resume should not be called for active subscription');
      }
    }
  };

  const app = createApp({
    deps: {
      isStripeConfigured: () => true,
      getStripeClient: () => stripeClient,
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User', stripeCustomerId: 'cus_test_001' }),
      getOrCreateSubscription: async () => ({
        id: 'sub_local_1',
        user_id: 'user_1',
        stripe_subscription_id: 'sub_test_001',
        plan_id: 'pro',
        status: 'active'
      }),
      upsertSubscriptionFromProvider: async () => {},
      setUserPlan: async () => {},
      appendImmutableAudit: async () => {}
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/subscription/resume`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.subscription.cancelAtPeriodEnd, false);
  });

  assert.equal(calls.update.length, 1);
  assert.equal(calls.update[0].cancel_at_period_end, false);
});

test('billing client-token endpoint is removed', async () => {
  const app = createApp();

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/client-token`);
    assert.equal(response.status, 410);
    const body = await response.json();
    assert.equal(body.error, 'endpoint_removed');
  });
});

test('billing public-config returns publishable key when configured', async () => {
  const app = createApp();
  const prev = process.env.STRIPE_PUBLISHABLE_KEY;
  process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_1234567890abcdef';
  try {
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/billing/public-config`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.provider, 'stripe');
      assert.equal(body.publishableKey, 'pk_test_1234567890abcdef');
    });
  } finally {
    if (prev === undefined) delete process.env.STRIPE_PUBLISHABLE_KEY;
    else process.env.STRIPE_PUBLISHABLE_KEY = prev;
  }
});

test('billing router enforces session auth for checkout', async () => {
  const app = createApp({
    authSource: 'api_key',
    requireSessionAuth: (req, res, next) =>
      req.authSource === 'cookie' ? next() : res.status(403).json({ error: 'session_auth_required' }),
    deps: {
      isStripeConfigured: () => true,
      getStripeClient: () => ({
        checkout: {
          sessions: {
            create: async () => ({ id: 'cs_test_001', url: 'https://checkout.stripe.com/c/pay/test_session_001' })
          }
        }
      }),
      getUserById: async () => ({ id: 'user_1', email: 'user@example.com', name: 'Test User' }),
      ensureStripeCustomerForUser: async () => 'cus_test_001'
    }
  });

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planType: 'pro' })
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, 'session_auth_required');
  });
});
