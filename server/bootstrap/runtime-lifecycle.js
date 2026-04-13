import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cron from 'node-cron';

export function startRuntimeLifecycle({
  app,
  port,
  buildVersion,
  logger,
  pgPool,
  closeCacheClient,
  shutdownTimeoutMs,
  cronRetryAttempts,
  cronRetryDelayMs,
  cronAllowOverlapJobsCsv,
  runStartupTasks,
  bootstrapSeedImportFile,
  bootstrapSeedImportDryRun,
  schedules,
  flags,
  limits,
  jobs,
  getDataFoundationStatus
}) {
  const httpServer = app.listen(port, () => {
    logger.info({ port, version: buildVersion }, 'server_started');
  });

  const cronTasks = [];
  const cronRunningJobs = new Set();
  const CRON_ALLOW_OVERLAP_JOBS = new Set(
    String(cronAllowOverlapJobsCsv || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
  );

  function scheduleCronJob(name, expression, jobFn, options = {}) {
    const task = cron.schedule(
      expression,
      async () => {
        const overlapAllowed = CRON_ALLOW_OVERLAP_JOBS.has(name);
        if (!overlapAllowed && cronRunningJobs.has(name)) {
          logger.warn(
            {
              job: name,
              schedule: expression,
              timezone: options?.timezone || 'system'
            },
            'cron_job_skipped_overlap'
          );
          return;
        }
        if (!overlapAllowed) cronRunningJobs.add(name);
        const startedAt = Date.now();
        try {
          let attempt = 0;
          while (true) {
            try {
              await jobFn();
              if (attempt > 0) {
                logger.info({ job: name, retries: attempt }, 'cron_job_recovered_after_retry');
              }
              break;
            } catch (error) {
              if (attempt >= cronRetryAttempts) throw error;
              attempt += 1;
              logger.warn({ job: name, attempt, retryDelayMs: cronRetryDelayMs, err: error }, 'cron_job_retry_scheduled');
              await new Promise((resolveDelay) => setTimeout(resolveDelay, cronRetryDelayMs));
            }
          }
          logger.info(
            {
              job: name,
              schedule: expression,
              timezone: options?.timezone || 'system',
              durationMs: Date.now() - startedAt
            },
            'cron_job_completed'
          );
        } catch (error) {
          logger.error(
            {
              job: name,
              schedule: expression,
              timezone: options?.timezone || 'system',
              durationMs: Date.now() - startedAt,
              err: error
            },
            'cron_job_failed'
          );
        } finally {
          if (!overlapAllowed) cronRunningJobs.delete(name);
        }
      },
      options
    );
    cronTasks.push({ name, task });
    return task;
  }

  async function runStartupTask(name, taskFn) {
    const startedAt = Date.now();
    try {
      await taskFn();
      logger.info({ task: name, durationMs: Date.now() - startedAt }, 'startup_task_completed');
    } catch (error) {
      logger.error({ task: name, durationMs: Date.now() - startedAt, err: error }, 'startup_task_failed');
    }
  }

  async function bootstrapOpportunitySeedIfEmpty() {
    const status = await getDataFoundationStatus();
    const priceObservations = Number(status?.totals?.priceObservations || 0);
    if (priceObservations > 0) {
      logger.info({ priceObservations }, 'opportunity_seed_bootstrap_skipped_existing_data');
      return { skipped: true, reason: 'existing_data', priceObservations };
    }

    const defaultSeedFile = resolve(process.cwd(), 'data', 'price-observations.template.csv');
    if (!existsSync(defaultSeedFile)) {
      logger.warn({ defaultSeedFile }, 'opportunity_seed_bootstrap_skipped_missing_seed_file');
      return { skipped: true, reason: 'missing_seed_file' };
    }

    const seeded = await jobs.runSeedImportOnce({ filePath: defaultSeedFile, dryRun: false });
    await jobs.runNightlyRouteBaselineJob({ reason: 'opportunity_seed_bootstrap' });
    await jobs.runOpportunityPipelineOnce();
    logger.info({ seeded }, 'opportunity_seed_bootstrap_completed');
    return { skipped: false, seeded };
  }

  scheduleCronJob('notifications_scan', schedules.cronSchedule, () => jobs.scanSubscriptionsOnce());
  scheduleCronJob(
    'ai_pricing',
    schedules.aiPricingCron,
    () => jobs.monitorAndUpdateSubscriptionPricing({ reason: 'scheduled' }),
    { timezone: schedules.aiPricingTimezone }
  );
  scheduleCronJob('free_precompute', schedules.freePrecomputeCron, () => jobs.runNightlyFreePrecompute({ reason: 'scheduled' }), {
    timezone: schedules.freeJobsTimezone
  });
  scheduleCronJob('free_alert_worker', schedules.freeAlertWorkerCron, () => jobs.runFreeAlertWorkerOnce(), { timezone: schedules.freeJobsTimezone });
  scheduleCronJob('route_baseline', schedules.dealBaselineCron, () => jobs.runNightlyRouteBaselineJob({ reason: 'scheduled' }), {
    timezone: schedules.dealBaselineTimezone
  });
  scheduleCronJob('baseline_recompute_worker', schedules.dealBaselineCron, () => jobs.runBaselineRecomputeOnce(), {
    timezone: schedules.dealBaselineTimezone
  });
  scheduleCronJob('discovery_alert_worker', schedules.discoveryAlertWorkerCron, () => jobs.runDiscoveryAlertWorkerOnce(), {
    timezone: schedules.discoveryAlertWorkerTimezone
  });
  scheduleCronJob('price_ingestion_worker', schedules.priceIngestWorkerCron, () => jobs.runPriceIngestionWorkerOnce({ maxJobs: 500 }), {
    timezone: schedules.priceIngestWorkerTimezone
  });
  scheduleCronJob('opportunity_pipeline_worker', schedules.opportunityPipelineCron, () => jobs.runOpportunityPipelineOnce(), {
    timezone: schedules.opportunityPipelineTimezone
  });
  scheduleCronJob('ingestion_jobs_maintenance', schedules.ingestionJobsMaintenanceCron, () => jobs.runIngestionJobsMaintenance({ force: true }), {
    timezone: schedules.ingestionJobsMaintenanceTimezone
  });
  if (flags.routePriceStatsEnabled) {
    scheduleCronJob('route_price_stats_worker', schedules.routePriceStatsCron, () => jobs.runRoutePriceStatsWorkerOnce(), {
      timezone: schedules.routePriceStatsTimezone
    });
  }
  if (flags.detectedDealsEnabled) {
    scheduleCronJob('detected_deals_worker', schedules.detectedDealsCron, () => jobs.runDetectedDealsWorkerOnce(), {
      timezone: schedules.detectedDealsTimezone
    });
  }
  if (flags.dealsContentEnabled) {
    scheduleCronJob('deals_content_worker', schedules.dealsContentCron, () => jobs.runDealsContentWorkerOnce(), {
      timezone: schedules.dealsContentTimezone
    });
  }
  if (flags.priceAlertsEnabled) {
    scheduleCronJob('price_alerts_worker', schedules.priceAlertsCron, () => jobs.runPriceAlertsWorkerOnce({ limit: limits.priceAlertsWorkerLimit }), {
      timezone: schedules.priceAlertsTimezone
    });
  }
  scheduleCronJob('radar_match_precompute_worker', schedules.radarMatchPrecomputeCron, () => jobs.runRadarMatchPrecomputeOnce(), {
    timezone: schedules.radarMatchPrecomputeTimezone
  });
  if (flags.flightScanEnabled) {
    scheduleCronJob('flight_scan_scheduler', schedules.flightScanSchedulerCron, () => jobs.runFlightScanSchedulerOnce({ enabled: true }), {
      timezone: schedules.flightScanTimezone
    });
    scheduleCronJob('flight_scan_worker', schedules.flightScanWorkerCron, () => jobs.runFlightScanWorkerOnce({ enabled: true }), {
      timezone: schedules.flightScanTimezone
    });
  }
  if (flags.providerCollectionEffectiveEnabled) {
    scheduleCronJob('provider_collection_worker', schedules.providerCollectionCron, () => jobs.runProviderCollectionOnce(), {
      timezone: schedules.providerCollectionTimezone
    });
  }

  if (runStartupTasks) {
    runStartupTask('ai_pricing_startup_check', () => jobs.monitorAndUpdateSubscriptionPricing({ reason: 'startup' }));
    runStartupTask('free_precompute_startup', () => jobs.runNightlyFreePrecompute({ reason: 'startup' }));
    runStartupTask('route_baseline_startup', () => jobs.runNightlyRouteBaselineJob({ reason: 'startup' }));
    runStartupTask('baseline_recompute_startup', () => jobs.runBaselineRecomputeOnce());
    runStartupTask('discovery_alert_worker_startup', () => jobs.runDiscoveryAlertWorkerOnce({ limit: 200 }));
    runStartupTask('price_ingestion_worker_startup', () => jobs.runPriceIngestionWorkerOnce({ maxJobs: 500 }));
    runStartupTask('ingestion_jobs_maintenance_startup', () => jobs.runIngestionJobsMaintenance({ force: true }));
    runStartupTask('opportunity_seed_bootstrap_startup', () => bootstrapOpportunitySeedIfEmpty());
    runStartupTask('opportunity_pipeline_startup', () => jobs.runOpportunityPipelineOnce());
    if (flags.routePriceStatsEnabled) {
      runStartupTask('route_price_stats_startup', () => jobs.runRoutePriceStatsWorkerOnce());
    }
    if (flags.detectedDealsEnabled) {
      runStartupTask('detected_deals_startup', () => jobs.runDetectedDealsWorkerOnce());
    }
    if (flags.dealsContentEnabled && flags.dealsContentRunOnStartup) {
      runStartupTask('deals_content_startup', () => jobs.runDealsContentWorkerOnce());
    }
    if (flags.priceAlertsEnabled) {
      runStartupTask('price_alerts_startup', () => jobs.runPriceAlertsWorkerOnce({ limit: limits.priceAlertsWorkerLimit }));
    }
    runStartupTask('radar_match_precompute_startup', () => jobs.runRadarMatchPrecomputeOnce());
    if (flags.flightScanEnabled) {
      runStartupTask('flight_scan_scheduler_startup', () => jobs.runFlightScanSchedulerOnce({ enabled: true }));
      runStartupTask('flight_scan_worker_startup', () => jobs.runFlightScanWorkerOnce({ enabled: true }));
    }
    if (flags.providerCollectionEffectiveEnabled) {
      runStartupTask('provider_collection_startup', () => jobs.runProviderCollectionOnce());
    }
    if (bootstrapSeedImportFile) {
      runStartupTask('seed_import_startup', () =>
        jobs.runSeedImportOnce({ filePath: bootstrapSeedImportFile, dryRun: bootstrapSeedImportDryRun })
      );
    }
  } else {
    logger.info({ runStartupTasks: false }, 'startup_tasks_skipped_disabled');
  }

  let shuttingDown = false;
  async function gracefulShutdown(signal, { exitCode = 0 } = {}) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.warn({ signal }, 'shutdown_started');

    for (const entry of cronTasks) {
      try {
        entry.task.stop();
      } catch (error) {
        logger.warn({ err: error, job: entry.name }, 'cron_job_stop_failed');
      }
    }

    await Promise.race([
      new Promise((resolveClose) => {
        httpServer.close((error) => {
          if (error) logger.error({ err: error }, 'http_server_close_failed');
          else logger.info({}, 'http_server_closed');
          resolveClose();
        });
      }),
      new Promise((resolveTimeout) => {
        setTimeout(() => {
          logger.warn({ timeoutMs: shutdownTimeoutMs }, 'http_server_close_timeout');
          resolveTimeout();
        }, shutdownTimeoutMs);
      })
    ]);

    if (pgPool) {
      try {
        await pgPool.end();
        logger.info({}, 'pg_pool_closed');
      } catch (error) {
        logger.error({ err: error }, 'pg_pool_close_failed');
      }
    }
    try {
      await closeCacheClient();
    } catch (error) {
      logger.warn({ err: error }, 'cache_client_close_failed');
    }

    logger.info({ signal }, 'shutdown_completed');
    process.exit(exitCode);
  }

  process.on('SIGINT', () => {
    gracefulShutdown('SIGINT').catch((error) => {
      logger.fatal({ err: error }, 'shutdown_failed');
      process.exit(1);
    });
  });

  process.on('SIGTERM', () => {
    gracefulShutdown('SIGTERM').catch((error) => {
      logger.fatal({ err: error }, 'shutdown_failed');
      process.exit(1);
    });
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'unhandled_rejection');
    if (process.env.NODE_ENV === 'production') {
      gracefulShutdown('UNHANDLED_REJECTION', { exitCode: 1 }).catch((error) => {
        logger.fatal({ err: error }, 'shutdown_failed_after_unhandled_rejection');
        process.exit(1);
      });
    }
  });

  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught_exception');
    gracefulShutdown('UNCAUGHT_EXCEPTION', { exitCode: 1 }).catch((shutdownError) => {
      logger.fatal({ err: shutdownError }, 'shutdown_failed_after_uncaught_exception');
      process.exit(1);
    });
  });

  return { httpServer, gracefulShutdown };
}
