function AdvancedAnalyticsSection({
  t,
  isAuthenticated,
  runFeatureAuditCheck,
  featureAuditLoading,
  featureAuditError,
  featureAudit,
  loadMonetizationReport,
  monetizationLoading,
  monetizationError,
  monetizationReport,
  loadFunnelReport,
  funnelLoading,
  funnelError,
  funnelReport,
  loadOutboundReport,
  outboundReportLoading,
  exportOutboundReportCsv,
  outboundCsvLoading,
  outboundReportError,
  outboundReport,
  runSecurityAuditCheck,
  securityAuditLoading,
  securityAuditError,
  securityAudit,
  refreshSecurityActivity,
  securityInfo,
  securityError,
  securityEvents,
  refreshSearchHistory,
  searchHistory,
  regionLabel,
  applySearchPreset
}) {
  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <h2>{t('featuresAudit')}</h2>
          <button type="button" className="ghost" onClick={runFeatureAuditCheck} disabled={featureAuditLoading}>
            {featureAuditLoading ? `${t('runAudit')}...` : t('runAudit')}
          </button>
        </div>
        {featureAuditError ? <p className="error">{featureAuditError}</p> : null}
        {featureAudit ? (
          <div className="list-stack">
            <div className={featureAudit.summary.readyForMonetization ? 'alert ok' : 'alert warn'}>
              <strong>{featureAudit.summary.readyForMonetization ? t('auditReady') : t('auditNotReady')}</strong>
              <p>
                {t('auditPass')}: {featureAudit.summary.passed}/{featureAudit.summary.total} | {t('auditFail')}: {featureAudit.summary.failed}
              </p>
            </div>
            {featureAudit.checks.map((check) => (
              <div key={check.id} className="watch-item">
                <div>
                  <strong>{check.ok ? `PASS - ${check.label}` : `FAIL - ${check.label}`}</strong>
                  <p>{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{t('auditHelp')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('monetizationHub')}</h2>
          <button className="ghost" type="button" onClick={loadMonetizationReport} disabled={!isAuthenticated || monetizationLoading}>
            {monetizationLoading ? `${t('loadMonetization')}...` : t('loadMonetization')}
          </button>
        </div>
        {monetizationError ? <p className="error">{monetizationError}</p> : null}
        {monetizationReport ? (
          <div className="middle-grid">
            <article className="watch-item">
              <div>
                <strong>{t('leads')}</strong>
                <p>{monetizationReport.sql?.leads ?? 0}</p>
              </div>
            </article>
            <article className="watch-item">
              <div>
                <strong>{t('searches')}</strong>
                <p>{monetizationReport.sql?.searches ?? 0}</p>
              </div>
            </article>
            <article className="watch-item">
              <div>
                <strong>{t('sentEmails')}</strong>
                <p>{monetizationReport.sql?.emailsSent ?? 0}</p>
              </div>
            </article>
            <article className="watch-item">
              <div>
                <strong>{t('conversionSignal')}</strong>
                <p>{monetizationReport.sql?.searchPerLead ?? 0}</p>
              </div>
            </article>
          </div>
        ) : (
          <p className="muted">{t('kpiHelp')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('funnelAnalytics')}</h2>
          <button className="ghost" type="button" onClick={loadFunnelReport} disabled={!isAuthenticated || funnelLoading}>
            {funnelLoading ? `${t('loadFunnel')}...` : t('loadFunnel')}
          </button>
        </div>
        {funnelError ? <p className="error">{funnelError}</p> : null}
        {funnelReport?.channels?.length ? (
          <div className="list-stack">
            {funnelReport.channels.map((row) => (
              <div key={row.channel} className="watch-item">
                <div>
                  <strong>{row.channel}</strong>
                  <p>
                    {t('leads')}: {row.leads} | {t('searches')}: {row.searches} | {t('conversionSignal')}: {row.searchesPerLead}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{t('funnelHelp')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('decisionReport')}</h2>
          <div className="panel-actions">
            <button type="button" className="ghost" onClick={loadOutboundReport} disabled={!isAuthenticated || outboundReportLoading}>
              {outboundReportLoading ? `${t('loadReport')}...` : t('loadReport')}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={exportOutboundReportCsv}
              disabled={!isAuthenticated || outboundCsvLoading}
              title={t('exportCsvTitle')}
            >
              {outboundCsvLoading ? `${t('exportCsv')}...` : t('exportCsv')}
            </button>
          </div>
        </div>
        {outboundReportError ? <p className="error">{outboundReportError}</p> : null}
        {outboundReport ? (
          <div className="list-stack">
            <div className="watch-item">
              <div>
                <strong>{outboundReport.policy?.monetizationModel || 'decision_value'}</strong>
                <p>
                  {t('searches')}: {outboundReport.summary?.searchCount} | {t('clicks')}: {outboundReport.summary?.outboundClicks} | {t('ctr')}:{' '}
                  {outboundReport.summary?.clickThroughRatePct}%
                </p>
              </div>
            </div>
            <div className="middle-grid">
              <article className="panel">
                <h2>{t('byPartner')}</h2>
                <div className="list-stack">
                  {(outboundReport.byPartner || []).map((row) => (
                    <div key={row.partner} className="watch-item">
                      <strong>{row.partner}</strong>
                      <p>{row.clicks} {t('clicks')}</p>
                    </div>
                  ))}
                </div>
              </article>
              <article className="panel">
                <h2>{t('topRoutes')}</h2>
                <div className="list-stack">
                  {(outboundReport.topRoutes || []).map((row) => (
                    <div key={row.route} className="watch-item">
                      <strong>{row.route}</strong>
                      <p>{row.clicks} {t('clicks')}</p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
            <article className="panel">
              <h2>{t('topPatterns')}</h2>
              <div className="list-stack">
                {(outboundReport.topDecisionPatterns || []).map((row) => (
                  <div key={row.pattern} className="watch-item">
                    <strong>{row.pattern}</strong>
                    <p>{row.used} {t('searches').toLowerCase()}</p>
                  </div>
                ))}
              </div>
            </article>
            <div className="middle-grid">
              <article className="panel">
                <h2>{t('topCampaigns')}</h2>
                <div className="list-stack">
                  {(outboundReport.topCampaigns || []).map((row) => (
                    <div key={row.campaign} className="watch-item">
                      <strong>{row.campaign}</strong>
                      <p>{row.clicks} {t('clicks')}</p>
                    </div>
                  ))}
                </div>
              </article>
              <article className="panel">
                <h2>{t('topSources')}</h2>
                <div className="list-stack">
                  {(outboundReport.topSources || []).map((row) => (
                    <div key={`${row.source}:${row.medium}`} className="watch-item">
                      <strong>
                        {row.source} / {row.medium}
                      </strong>
                      <p>{row.clicks} {t('clicks')}</p>
                    </div>
                  ))}
                </div>
              </article>
            </div>
          </div>
        ) : (
          <p className="muted">{t('reportHelp')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('securityAudit')}</h2>
          <button className="ghost" type="button" onClick={runSecurityAuditCheck} disabled={securityAuditLoading}>
            {securityAuditLoading ? `${t('runSecurityAudit')}...` : t('runSecurityAudit')}
          </button>
        </div>
        {securityAuditError ? <p className="error">{securityAuditError}</p> : null}
        {securityAudit ? (
          <div className="list-stack">
            <div className={securityAudit.ok ? 'alert ok' : 'alert warn'}>
              <strong>{securityAudit.ok ? t('securityPass') : t('securityFail')}</strong>
              <p>
                {t('auditPass')}: {securityAudit.summary?.passed}/{securityAudit.summary?.total} | {t('auditFail')}:{' '}
                {securityAudit.summary?.failed}
              </p>
            </div>
            {(securityAudit.checks || []).map((check) => (
              <div key={check.id} className="watch-item">
                <div>
                  <strong>{check.ok ? `PASS - ${check.label}` : `FAIL - ${check.label}`}</strong>
                  <p>{check.detail}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">{t('securityHelp')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('securityActivity')}</h2>
          <button className="ghost" type="button" onClick={refreshSecurityActivity} disabled={!isAuthenticated}>
            {t('refresh')}
          </button>
        </div>
        {isAuthenticated ? (
          <div className="list-stack">
            <div className="watch-item">
              <div>
                <strong>{securityInfo.isLocked ? t('securityLocked') : t('securityUnlocked')}</strong>
                <p>
                  {t('failedAttempts')}: {securityInfo.failedLoginCount || 0}
                  {securityInfo.lockUntil ? ` | ${t('lockUntil')} ${securityInfo.lockUntil}` : ''}
                </p>
              </div>
            </div>
            <details className="advanced-block" open>
              <summary>{t('securityEventsSummary')}</summary>
              {securityError ? <p className="error">{securityError}</p> : null}
              {securityEvents.length === 0 ? <p className="muted">{t('noSecurityActivity')}</p> : null}
              {securityEvents.slice(0, 8).map((event) => (
                <div key={event.id} className="watch-item">
                  <div>
                    <strong>{event.success ? t('loginSuccess') : t('loginFailed')}</strong>
                    <p>
                      {event.type} | {event.at} | {event.ip || t('notAvailable')}
                    </p>
                  </div>
                </div>
              ))}
            </details>
          </div>
        ) : (
          <p className="muted">{t('loginRequiredAlert')}</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{t('searchHistory')}</h2>
          <button className="ghost" type="button" onClick={refreshSearchHistory} disabled={!isAuthenticated}>
            {t('refresh')}
          </button>
        </div>
        <details className="advanced-block" open>
          <summary>{t('searchHistorySummary')}</summary>
          {searchHistory.length === 0 ? <p className="muted">{t('noSearchHistory')}</p> : null}
          <div className="list-stack">
            {searchHistory.map((item) => (
              <div key={item.id} className="watch-item">
                <div>
                  <strong>
                    {item.payload?.origin || '-'} | {regionLabel(item.payload?.region || 'all')}
                  </strong>
                  <p>
                    {item.payload?.country || item.payload?.destinationQuery || t('anyDestination')} | {item.payload?.dateFrom} {t('to')}{' '}
                    {item.payload?.dateTo} | {item.payload?.travellers || 1} {t('travellersShort')}
                  </p>
                </div>
                <button className="ghost" type="button" onClick={() => applySearchPreset(item)}>
                  {t('useSearch')}
                </button>
              </div>
            ))}
          </div>
        </details>
      </section>
    </>
  );
}

export default AdvancedAnalyticsSection;
