import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activateFreePlanAction,
  createApplyLocalPlanChange,
  createMultiCityLocalActions,
  handleClearLocalTravelDataAction,
  handleTrackedRoutesLimitReachedAction,
  handleUntrackedRouteFromHubAction,
  saveRecentItineraryWithPlanGateAction,
  viewDealsForTrackedRouteAction
} from '../../src/features/app-shell/domain/app-local-actions.js';

test('createMultiCityLocalActions updates segments and clears retry visibility', () => {
  let retryVisible = true;
  let segments = [{ id: 'a', origin: 'MXP' }];
  const calls = [];
  const actions = createMultiCityLocalActions({
    setMultiCitySegments: (updater) => {
      segments = updater(segments);
      calls.push('setSegments');
    },
    setMultiCityRetryVisible: (value) => {
      retryVisible = value;
      calls.push('setRetry');
    },
    updateMultiCitySegmentField: (prev, idx, field, value) => prev.map((s, i) => (i === idx ? { ...s, [field]: value } : s)),
    addMultiCitySegment: (prev) => [...prev, { id: 'b', origin: '' }],
    removeMultiCitySegment: (prev, idx) => prev.filter((_, i) => i !== idx),
    buildMultiCitySearchPayload: () => ({ ok: true }),
    multiCitySegments: segments,
    searchForm: {
      origin: 'MXP',
      destinationQuery: 'tokyo',
      region: 'all',
      country: '',
      cheapOnly: true,
      maxBudget: '1000',
      connectionType: 'all',
      maxStops: '1',
      travelTime: 'all',
      minComfortScore: '50',
      travellers: '2',
      cabinClass: 'economy'
    },
    canonicalDestinationQuery: (v) => String(v || '').trim(),
    canonicalCountryFilter: (v) => String(v || '').trim(),
    asOptionalPositiveInt: (v) => Number(v),
    asOptionalBoundedInt: (v) => Number(v)
  });

  actions.setMultiCitySegmentValue(0, 'origin', 'FCO');
  assert.equal(segments[0].origin, 'FCO');
  assert.equal(retryVisible, false);

  actions.appendMultiCitySegment();
  assert.equal(segments.length, 2);

  actions.deleteMultiCitySegment(1);
  assert.equal(segments.length, 1);

  const payload = actions.buildCurrentMultiCityPayload();
  assert.deepEqual(payload, { ok: true });
  assert.ok(calls.includes('setSegments'));
  assert.ok(calls.includes('setRetry'));
});

test('createMultiCityLocalActions build payload forwards normalized form values', () => {
  let capturedPayload = null;
  const actions = createMultiCityLocalActions({
    setMultiCitySegments: () => {},
    setMultiCityRetryVisible: () => {},
    updateMultiCitySegmentField: (prev) => prev,
    addMultiCitySegment: (prev) => prev,
    removeMultiCitySegment: (prev) => prev,
    buildMultiCitySearchPayload: (_segments, payload) => {
      capturedPayload = payload;
      return payload;
    },
    multiCitySegments: [{ id: 'a', origin: 'MXP', destination: 'NRT', date: '2026-08-01' }],
    searchForm: {
      origin: 'mxp',
      destinationQuery: '  tokyo  ',
      region: 'asia',
      country: '  japan ',
      cheapOnly: false,
      maxBudget: '1200',
      connectionType: 'direct',
      maxStops: '0',
      travelTime: 'day',
      minComfortScore: '70',
      travellers: '3',
      cabinClass: 'business'
    },
    canonicalDestinationQuery: (v) => String(v || '').trim().toUpperCase(),
    canonicalCountryFilter: (v) => String(v || '').trim().toLowerCase(),
    asOptionalPositiveInt: (v) => Number(v),
    asOptionalBoundedInt: (v) => Number(v)
  });

  const payload = actions.buildCurrentMultiCityPayload();
  assert.equal(payload.originFallback, 'mxp');
  assert.equal(payload.destinationQueryFallback, 'TOKYO');
  assert.equal(payload.country, 'japan');
  assert.equal(payload.maxStops, 0);
  assert.equal(payload.travellers, 3);
  assert.equal(capturedPayload.cabinClass, 'business');
});

test('createApplyLocalPlanChange normalizes and updates user + message', () => {
  let localPlan = 'free';
  let user = { planType: 'free', plan_type: 'free', isPremium: false };
  let message = '';
  const apply = createApplyLocalPlanChange({
    normalizeUserPlan: (p) => (p === 'elite' ? 'elite' : p === 'pro' ? 'pro' : 'free'),
    resolveEffectivePlan: (_current, requested) => requested,
    userPlanType: 'free',
    setLocalUserPlan: (p) => {
      localPlan = p;
    },
    setUser: (updater) => {
      user = updater(user);
    },
    setSubMessage: (m) => {
      message = m;
    },
    t: (k) => k
  });

  apply('pro');
  assert.equal(localPlan, 'pro');
  assert.equal(user.planType, 'pro');
  assert.equal(user.isPremium, true);
  assert.equal(message, 'planProActivated');
});

test('saveRecentItineraryWithPlanGateAction blocks when limit is reached', () => {
  const out = saveRecentItineraryWithPlanGateAction({
    item: { id: 'x' },
    createSavedItineraryFromOpportunity: () => ({ key: 'k1' }),
    readSavedItineraries: () => [{ key: 'k0' }],
    evaluateUsageLimit: () => ({ used: 1, limit: 1, reached: true }),
    planEntitlements: { savedItinerariesLimit: 1 },
    saveRecentItinerary: () => {
      throw new Error('must not be called');
    }
  });
  assert.equal(out.saved, false);
  assert.equal(out.limitReached, true);
});

test('saveRecentItineraryWithPlanGateAction saves when already saved even at limit', () => {
  const saved = [];
  const out = saveRecentItineraryWithPlanGateAction({
    item: { id: 'x' },
    createSavedItineraryFromOpportunity: () => ({ key: 'k1' }),
    readSavedItineraries: () => [{ key: 'k1' }],
    evaluateUsageLimit: () => ({ used: 1, limit: 1, reached: true }),
    planEntitlements: { savedItinerariesLimit: 1 },
    saveRecentItinerary: (entry, limit) => {
      saved.push([entry, limit]);
    }
  });
  assert.equal(out.saved, true);
  assert.equal(out.limitReached, false);
  assert.equal(saved.length, 1);
  assert.equal(saved[0][0].key, 'k1');
  assert.equal(saved[0][1], 1);
});

test('saveRecentItineraryWithPlanGateAction returns not saved when entry cannot be built', () => {
  const out = saveRecentItineraryWithPlanGateAction({
    item: null,
    createSavedItineraryFromOpportunity: () => null,
    readSavedItineraries: () => [{ key: 'k0' }],
    evaluateUsageLimit: (used, limit) => ({ used, limit, reached: false }),
    planEntitlements: { savedItinerariesLimit: 3 },
    saveRecentItinerary: () => {
      throw new Error('must not be called');
    }
  });
  assert.equal(out.saved, false);
  assert.equal(out.limitReached, false);
  assert.deepEqual(out.usage, { used: 1, limit: 3, reached: false });
});

test('activateFreePlanAction triggers auth flow when unauthenticated', () => {
  let called = null;
  activateFreePlanAction({
    isAuthenticated: false,
    beginAuthFlow: (payload) => {
      called = payload;
    },
    applyLocalPlanChange: () => {
      throw new Error('must not be called');
    }
  });
  assert.equal(called?.targetSection, 'premium');
});

test('activateFreePlanAction applies free plan when authenticated', () => {
  let applied = null;
  activateFreePlanAction({
    isAuthenticated: true,
    beginAuthFlow: () => {
      throw new Error('must not be called');
    },
    applyLocalPlanChange: (plan) => {
      applied = plan;
    }
  });
  assert.equal(applied, 'free');
});

test('createApplyLocalPlanChange keeps null user unchanged and emits free message', () => {
  let localPlan = 'pro';
  let user = null;
  let message = '';
  const apply = createApplyLocalPlanChange({
    normalizeUserPlan: () => 'free',
    resolveEffectivePlan: () => 'free',
    userPlanType: 'pro',
    setLocalUserPlan: (plan) => {
      localPlan = plan;
    },
    setUser: (updater) => {
      user = updater(user);
    },
    setSubMessage: (next) => {
      message = next;
    },
    t: (key) => key
  });

  apply('free');
  assert.equal(localPlan, 'free');
  assert.equal(user, null);
  assert.equal(message, 'planFreeActivated');
});

test('handleTrackedRoutesLimitReachedAction sets upgrade message from trigger content', () => {
  let message = '';
  handleTrackedRoutesLimitReachedAction({
    meta: { used: 5, limit: 5 },
    evaluateUsageLimit: () => ({ used: 5, limit: 5, reached: true }),
    planEntitlements: { trackedRoutesLimit: 5 },
    getUpgradeTriggerContent: () => ({ message: 'upgrade now' }),
    userPlanType: 'free',
    setSubMessage: (m) => {
      message = m;
    }
  });
  assert.equal(message, 'upgrade now');
});

test('handleUntrackedRouteFromHubAction clears selected cluster only on same slug', () => {
  let selected = 'tokyo';
  handleUntrackedRouteFromHubAction({
    slug: 'TOKYO',
    selectedOpportunityCluster: selected,
    setSelectedOpportunityCluster: (next) => {
      selected = next;
    }
  });
  assert.equal(selected, '');

  selected = 'rome';
  handleUntrackedRouteFromHubAction({
    slug: 'tokyo',
    selectedOpportunityCluster: selected,
    setSelectedOpportunityCluster: (next) => {
      selected = next;
    }
  });
  assert.equal(selected, 'rome');
});

test('handleUntrackedRouteFromHubAction is a no-op with empty slug', () => {
  let selected = 'rome';
  handleUntrackedRouteFromHubAction({
    slug: '  ',
    selectedOpportunityCluster: selected,
    setSelectedOpportunityCluster: () => {
      throw new Error('must not be called');
    }
  });
  assert.equal(selected, 'rome');
});

test('handleClearLocalTravelDataAction resets state and sets success message', () => {
  const calls = [];
  let message = '';
  handleClearLocalTravelDataAction({
    clearLocalTravelData: () => ({ failedKeys: [] }),
    setRadarSessionActivated: (v) => calls.push(['radar', v]),
    setSelectedOpportunityCluster: (v) => calls.push(['cluster', v]),
    setOpportunityDetail: (v) => calls.push(['detail', v]),
    setOpportunityDetailUpgradePrompt: (v) => calls.push(['prompt', v]),
    clearBookingHandoffError: () => calls.push(['bookingError']),
    clearOpportunityBookingError: () => calls.push(['oppBookingError']),
    setSubMessage: (v) => {
      message = v;
    }
  });
  assert.ok(calls.some((c) => c[0] === 'radar' && c[1] === false));
  assert.ok(calls.some((c) => c[0] === 'cluster' && c[1] === ''));
  assert.equal(message, 'Local travel data cleared on this device.');
});

test('handleClearLocalTravelDataAction requests account hint cleanup', () => {
  let receivedArg = null;
  handleClearLocalTravelDataAction({
    clearLocalTravelData: (arg) => {
      receivedArg = arg;
      return { failedKeys: [] };
    },
    setRadarSessionActivated: () => {},
    setSelectedOpportunityCluster: () => {},
    setOpportunityDetail: () => {},
    setOpportunityDetailUpgradePrompt: () => {},
    clearBookingHandoffError: () => {},
    clearOpportunityBookingError: () => {},
    setSubMessage: () => {}
  });
  assert.deepEqual(receivedArg, { includeAccountHints: true });
});

test('handleClearLocalTravelDataAction sets warning message when some keys fail', () => {
  let message = '';
  handleClearLocalTravelDataAction({
    clearLocalTravelData: () => ({ failedKeys: ['x'] }),
    setRadarSessionActivated: () => {},
    setSelectedOpportunityCluster: () => {},
    setOpportunityDetail: () => {},
    setOpportunityDetailUpgradePrompt: () => {},
    clearBookingHandoffError: () => {},
    clearOpportunityBookingError: () => {},
    setSubMessage: (v) => {
      message = v;
    }
  });
  assert.equal(message, 'Some local data could not be cleared due to browser restrictions.');
});

test('viewDealsForTrackedRouteAction updates section and cluster and scrolls into view', () => {
  let section = '';
  let cluster = '';
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  globalThis.window = {
    requestAnimationFrame: (cb) => {
      cb();
    }
  };
  let scrolled = false;
  globalThis.document = {
    querySelector: (selector) => {
      assert.equal(selector, '[data-testid="opportunity-feed-panel"]');
      return {
        scrollIntoView: () => {
          scrolled = true;
        }
      };
    }
  };

  try {
    viewDealsForTrackedRouteAction({
      slug: 'Tokyo',
      setActiveMainSection: (v) => {
        section = v;
      },
      setSelectedOpportunityCluster: (v) => {
        cluster = v;
      }
    });
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }

  assert.equal(section, 'home');
  assert.equal(cluster, 'tokyo');
  assert.equal(scrolled, true);
});

test('viewDealsForTrackedRouteAction is a no-op with empty slug', () => {
  let calls = 0;
  viewDealsForTrackedRouteAction({
    slug: '',
    setActiveMainSection: () => {
      calls += 1;
    },
    setSelectedOpportunityCluster: () => {
      calls += 1;
    }
  });
  assert.equal(calls, 0);
});
