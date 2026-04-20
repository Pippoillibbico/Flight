#!/usr/bin/env node
import dotenv from 'dotenv';
import Stripe from 'stripe';
import { PLANS } from '../server/lib/saas-db.js';

dotenv.config();
const STRIPE_API_VERSION = '2026-02-25.clover';

function fail(message) {
  console.error(`[stripe-sync-plans] ERROR: ${message}`);
  process.exit(1);
}

function normalizeCurrency(rawValue) {
  const normalized = String(rawValue || 'EUR').trim().toLowerCase();
  return /^[a-z]{3}$/.test(normalized) ? normalized : 'eur';
}

function toMinorUnits(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

async function findProductByMetadata(stripe, planId) {
  const query = `active:'true' AND metadata['app']:'flight_suite' AND metadata['plan_id']:'${planId}'`;
  try {
    if (typeof stripe.products.search === 'function') {
      const result = await stripe.products.search({ query, limit: 1 });
      return result?.data?.[0] || null;
    }
  } catch {
    // Some accounts do not have Search API enabled; fallback to list.
  }

  const listed = await stripe.products.list({ active: true, limit: 100 });
  return (
    (listed?.data || []).find(
      (product) =>
        String(product?.metadata?.app || '').trim() === 'flight_suite' &&
        String(product?.metadata?.plan_id || '').trim() === planId
    ) || null
  );
}

async function ensureProduct(stripe, { planId, name }) {
  const existing = await findProductByMetadata(stripe, planId);
  if (existing?.id) return existing;

  return stripe.products.create({
    name,
    metadata: {
      app: 'flight_suite',
      plan_id: planId,
      billing_interval: 'month'
    }
  });
}

async function findPriceByLookupKey(stripe, lookupKey) {
  const query = `active:'true' AND lookup_key:'${lookupKey}'`;
  try {
    if (typeof stripe.prices.search === 'function') {
      const result = await stripe.prices.search({ query, limit: 1 });
      return result?.data?.[0] || null;
    }
  } catch {
    // Some accounts do not have Search API enabled; fallback to list.
  }

  const listed = await stripe.prices.list({ active: true, limit: 100 });
  return (listed?.data || []).find((price) => String(price?.lookup_key || '').trim() === lookupKey) || null;
}

async function ensurePrice(stripe, { productId, lookupKey, currency, unitAmount, planId }) {
  const existing = await findPriceByLookupKey(stripe, lookupKey);
  if (existing?.id) {
    const sameCurrency = String(existing.currency || '').toLowerCase() === currency;
    const sameAmount = Number(existing.unit_amount || 0) === unitAmount;
    const monthly = String(existing.recurring?.interval || '') === 'month';
    if (!sameCurrency || !sameAmount || !monthly) {
      console.warn(
        `[stripe-sync-plans] WARNING: existing price ${existing.id} for ${lookupKey} has different config (currency/amount/interval).`
      );
    }
    return existing;
  }

  return stripe.prices.create({
    product: productId,
    currency,
    unit_amount: unitAmount,
    recurring: {
      interval: 'month'
    },
    lookup_key: lookupKey,
    metadata: {
      app: 'flight_suite',
      plan_id: planId
    }
  });
}

async function run() {
  const secretKey = String(process.env.STRIPE_SECRET_KEY || '').trim();
  if (!secretKey) fail('STRIPE_SECRET_KEY is missing.');

  const stripe = new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION });
  const currency = normalizeCurrency(process.env.STRIPE_PRICE_CURRENCY || 'EUR');
  const lookupKeyPro = String(process.env.STRIPE_PRICE_LOOKUP_KEY_PRO || 'flight_pro_monthly').trim();
  const lookupKeyCreator = String(process.env.STRIPE_PRICE_LOOKUP_KEY_CREATOR || 'flight_creator_monthly').trim();

  const proAmount = toMinorUnits(PLANS.pro?.priceEur);
  const creatorAmount = toMinorUnits(PLANS.creator?.priceEur);
  if (!proAmount || !creatorAmount) fail('Invalid PLANS.pro/PLANS.creator price values.');

  console.log('[stripe-sync-plans] Sync started...');

  const productPro = await ensureProduct(stripe, { planId: 'pro', name: 'Flight Suite Pro' });
  const productCreator = await ensureProduct(stripe, { planId: 'creator', name: 'Flight Suite Creator' });

  const pricePro = await ensurePrice(stripe, {
    productId: productPro.id,
    lookupKey: lookupKeyPro,
    currency,
    unitAmount: proAmount,
    planId: 'pro'
  });
  const priceCreator = await ensurePrice(stripe, {
    productId: productCreator.id,
    lookupKey: lookupKeyCreator,
    currency,
    unitAmount: creatorAmount,
    planId: 'creator'
  });

  console.log('[stripe-sync-plans] Sync completed.');
  console.log('');
  console.log('Set these values in your .env:');
  console.log(`STRIPE_PRICE_PRO=${pricePro.id}`);
  console.log(`STRIPE_PRICE_CREATOR=${priceCreator.id}`);
  console.log('');
  console.log('Optional lookup keys used by this script:');
  console.log(`STRIPE_PRICE_LOOKUP_KEY_PRO=${lookupKeyPro}`);
  console.log(`STRIPE_PRICE_LOOKUP_KEY_CREATOR=${lookupKeyCreator}`);
  console.log('');
  console.log('Products:');
  console.log(`PRO: ${productPro.id}`);
  console.log(`CREATOR: ${productCreator.id}`);
}

run().catch((error) => {
  console.error('[stripe-sync-plans] Unhandled error:', error?.message || error);
  process.exit(1);
});
