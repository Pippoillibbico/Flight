import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { buildBillingRouter } from '../server/routes/billing.js';

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

function createAuthGuard(user = { id: 'user_1', sub: 'user_1' }) {
  return (req, _res, next) => {
    req.user = user;
    req.authSource = 'bearer';
    next();
  };
}

function createApp({ deps }) {
  const app = express();
  app.use(express.json());
  app.use(
    '/api/billing',
    buildBillingRouter(
      {
        authGuard: createAuthGuard(),
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
