import assert from 'node:assert/strict';
import test from 'node:test';

import {
  closeUpgradeFlow,
  createUpgradeFlowState,
  createUpgradeIntentTracker,
  getUpgradePlanContent,
  openUpgradeFlow,
  persistUpgradeInterest,
  submitUpgradeFlow
} from '../../src/features/upgrade-flow/index.ts';

test('getUpgradePlanContent returns distinct PRO and ELITE content', () => {
  const pro = getUpgradePlanContent('pro');
  const elite = getUpgradePlanContent('elite');

  assert.equal(pro.planType, 'pro');
  assert.equal(elite.planType, 'elite');
  assert.notEqual(pro.title, elite.title);
  assert.notEqual(pro.primaryCtaLabel, elite.primaryCtaLabel);
  assert.equal(pro.benefits.length, 4);
  assert.equal(elite.benefits.length, 4);
});

test('upgrade flow state transitions are deterministic', () => {
  const initial = createUpgradeFlowState();
  assert.equal(initial.isOpen, false);
  assert.equal(initial.planType, null);
  assert.equal(initial.step, 'details');

  const opened = openUpgradeFlow(initial, 'elite', 'premium_page');
  assert.equal(opened.isOpen, true);
  assert.equal(opened.planType, 'elite');
  assert.equal(opened.step, 'details');
  assert.equal(opened.source, 'premium_page');

  const submitted = submitUpgradeFlow(opened);
  assert.equal(submitted.step, 'submitted');

  const closed = closeUpgradeFlow();
  assert.deepEqual(closed, createUpgradeFlowState());
});

test('createUpgradeIntentTracker emits upgrade events through dispatcher', () => {
  const dispatched: Array<{
    eventName: string;
    detail: {
      eventType?: string;
      planType?: string;
      source?: string;
      at?: string;
      sourceContext?: string;
      schemaVersion?: number;
      eventVersion?: number;
      eventId?: string;
    };
  }> = [];
  const tracker = createUpgradeIntentTracker({
    dispatchEvent(eventName, detail) {
      dispatched.push({
        eventName,
        detail: {
          eventType: detail.eventType,
          planType: detail.planType,
          source: detail.source,
          at: detail.at,
          sourceContext: detail.sourceContext,
          schemaVersion: detail.schemaVersion,
          eventVersion: detail.eventVersion,
          eventId: detail.eventId
        }
      });
    }
  });

  tracker.track('upgrade_cta_clicked', 'pro', 'opportunity_feed_prompt');

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.eventName, 'flight_upgrade_event');
  assert.equal(dispatched[0]?.detail.eventType, 'upgrade_cta_clicked');
  assert.equal(dispatched[0]?.detail.planType, 'pro');
  assert.equal(dispatched[0]?.detail.source, 'opportunity_feed_prompt');
  assert.ok(typeof dispatched[0]?.detail.at === 'string' && String(dispatched[0]?.detail.at).length > 0);
  assert.equal(dispatched[0]?.detail.sourceContext, 'web_app');
  assert.equal(dispatched[0]?.detail.schemaVersion, 2);
  assert.equal(dispatched[0]?.detail.eventVersion, 1);
  assert.equal(/^[a-z0-9_-]{8,80}$/i.test(String(dispatched[0]?.detail.eventId || '')), true);
});

test('createUpgradeIntentTracker sanitizes unsafe tracking source values', () => {
  const dispatched: Array<{
    eventName: string;
    detail: { source?: string };
  }> = [];
  const tracker = createUpgradeIntentTracker({
    dispatchEvent(eventName, detail) {
      dispatched.push({ eventName, detail: { source: detail.source } });
    }
  });

  tracker.track('upgrade_modal_opened', 'pro', 'contact user@example.com now');

  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0]?.eventName, 'flight_upgrade_event');
  assert.equal(dispatched[0]?.detail.source, undefined);
});

test('createUpgradeIntentTracker swallows dispatcher failures', () => {
  const tracker = createUpgradeIntentTracker({
    dispatchEvent() {
      throw new Error('dispatch failed');
    }
  });

  assert.doesNotThrow(() => tracker.track('elite_modal_opened', 'elite', 'radar_prompt'));
});

test('persistUpgradeInterest returns a durable record even without window context', () => {
  const record = persistUpgradeInterest('pro', 'premium_page', 'u-1', 'user@example.com');

  assert.equal(record.planType, 'pro');
  assert.equal(record.source, 'premium_page');
  assert.match(String(record.userId || ''), /^usr_[a-z0-9]+$/);
  assert.equal('userEmail' in record, false);
  assert.ok(typeof record.submittedAt === 'string' && record.submittedAt.length > 0);
});

test('persistUpgradeInterest keeps only recent records and omits email hash', () => {
  const previousWindow = (globalThis as { window?: unknown }).window;
  const store = new Map<string, string>();
  const localStorage = {
    getItem(key: string) {
      return store.has(key) ? String(store.get(key)) : null;
    },
    setItem(key: string, value: string) {
      store.set(String(key), String(value));
    },
    removeItem(key: string) {
      store.delete(String(key));
    }
  };
  (globalThis as { window: { localStorage: typeof localStorage } }).window = { localStorage };

  try {
    localStorage.setItem(
      'flight_cookie_consent_v1',
      JSON.stringify({
        functional: true,
        analytics: false,
        version: 1,
        ts: Date.now()
      })
    );
    const staleDate = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    localStorage.setItem(
      'flight_upgrade_interest_records',
      JSON.stringify([
        {
          planType: 'pro',
          source: 'legacy_source',
          submittedAt: staleDate,
          userId: 'usr_old',
          userEmail: 'mail_old'
        }
      ])
    );

    const record = persistUpgradeInterest('elite', 'premium_page', 'u-99', 'person@example.com');
    const raw = localStorage.getItem('flight_upgrade_interest_records');
    assert.ok(raw);
    const parsed = JSON.parse(String(raw || '[]'));
    assert.equal(Array.isArray(parsed), true);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.planType, 'elite');
    assert.equal(parsed[0]?.source, 'premium_page');
    assert.equal(parsed[0]?.userEmail, undefined);
    assert.equal(record.planType, 'elite');
  } finally {
    (globalThis as { window?: unknown }).window = previousWindow;
  }
});
