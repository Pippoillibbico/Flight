/**
 * Legal pages renderer.
 *
 * Notes:
 * - Content is generated from runtime values where available.
 * - Unknown legal/company details are left as explicit TODO placeholders.
 * - Keep this file aligned with actual data/storage behavior in src/ and server/.
 */

const APP_NAME = String(process.env.APP_NAME || 'Flight').trim();
const APP_URL = String(process.env.FRONTEND_URL || 'http://localhost:8080').trim();
const EFFECTIVE_DATE = String(process.env.LEGAL_EFFECTIVE_DATE || new Date().toISOString().slice(0, 10)).trim();
const COMPANY = String(process.env.LEGAL_COMPANY_NAME || 'Clariter Group').trim();
const ADDRESS = String(process.env.LEGAL_COMPANY_ADDRESS || 'Via del Corso 101, 00186 Roma, Italia').trim();
const PRIVACY_EMAIL = String(process.env.LEGAL_PRIVACY_EMAIL || 'privacy@flightsuite.app').trim();
const DPO_EMAIL = String(process.env.LEGAL_DPO_EMAIL || 'dpo@flightsuite.app').trim();
const AUTH_EVENT_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.DATA_RETENTION_AUTH_EVENTS_DAYS || 90)));
const TELEMETRY_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.DATA_RETENTION_CLIENT_TELEMETRY_DAYS || 180)));
const OUTBOUND_RETENTION_DAYS = Math.max(7, Math.min(3650, Number(process.env.DATA_RETENTION_OUTBOUND_EVENTS_DAYS || 180)));

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function css() {
  return `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f6fb;
      color: #12233f;
      font: 15px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      padding: 24px 12px 48px;
    }
    .wrap {
      max-width: 900px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #dfe8f5;
      border-radius: 14px;
      padding: 28px;
      box-shadow: 0 8px 28px rgba(13, 35, 72, 0.08);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 18px;
      text-decoration: none;
      color: #0f6fff;
      font-weight: 800;
    }
    .back {
      display: inline-block;
      margin: 0 0 22px;
      color: #1f4f9d;
      text-decoration: none;
      font-weight: 600;
      font-size: 13px;
    }
    .back:hover { text-decoration: underline; }
    h1 { margin: 0 0 6px; font-size: 28px; color: #0d2142; }
    h2 { margin: 28px 0 8px; font-size: 20px; color: #0f2f60; }
    h3 { margin: 18px 0 6px; font-size: 16px; color: #184582; }
    p { margin: 0 0 12px; }
    ul { margin: 8px 0 14px 20px; }
    li { margin: 4px 0; }
    code {
      background: #eef4ff;
      border: 1px solid #d5e3ff;
      border-radius: 6px;
      padding: 1px 5px;
      font-size: 12px;
    }
    .meta { color: #516b92; font-size: 13px; margin-bottom: 14px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 12px 0 18px;
      font-size: 14px;
    }
    th, td {
      border: 1px solid #d9e4f6;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th { background: #edf4ff; color: #183f75; }
    tr:nth-child(even) td { background: #f9fbff; }
    footer {
      margin-top: 34px;
      padding-top: 14px;
      border-top: 1px solid #d9e4f6;
      color: #5a7195;
      font-size: 13px;
    }
    @media (max-width: 680px) {
      .wrap { padding: 18px; }
      h1 { font-size: 24px; }
      h2 { font-size: 18px; }
    }
  `;
}

function page(title, body) {
  const safeTitle = escapeHtml(title);
  const safeAppName = escapeHtml(APP_NAME);
  const safeAppUrl = escapeHtml(APP_URL);
  const safeCompany = escapeHtml(COMPANY);
  const safeAddress = escapeHtml(ADDRESS);
  const safePrivacyEmail = escapeHtml(PRIVACY_EMAIL);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle} - ${safeAppName}</title>
  <style>${css()}</style>
</head>
<body>
  <article class="wrap">
    <a class="brand" href="${safeAppUrl}">${safeAppName}</a>
    <a class="back" href="${safeAppUrl}">Back to app</a>
    ${body}
    <footer>
      <p>${safeAppName} is operated by ${safeCompany}, ${safeAddress}.</p>
      <p>Privacy contact: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a></p>
      <p>
        <a href="${safeAppUrl}/privacy-policy">Privacy Policy</a> |
        <a href="${safeAppUrl}/cookie-policy">Cookie Policy</a> |
        <a href="${safeAppUrl}/terms">Terms</a>
      </p>
    </footer>
  </article>
</body>
</html>`;
}

export function renderPrivacyPolicy() {
  const safeDate = escapeHtml(EFFECTIVE_DATE);
  const safeAppName = escapeHtml(APP_NAME);
  const safeCompany = escapeHtml(COMPANY);
  const safeAddress = escapeHtml(ADDRESS);
  const safePrivacyEmail = escapeHtml(PRIVACY_EMAIL);
  const safeDpoEmail = escapeHtml(DPO_EMAIL);

  return page(
    'Privacy Policy',
    `
      <h1>Privacy Policy</h1>
      <p class="meta">Last updated: ${safeDate}</p>

      <h2>1. Titolare del trattamento</h2>
      <p>${safeCompany}<br/>${safeAddress}<br/>Contatti privacy: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a><br/>DPO (se nominato): <a href="mailto:${safeDpoEmail}">${safeDpoEmail}</a></p>

      <h2>2. Dati trattati</h2>
      <ul>
        <li>Dati account e autenticazione (email, credenziali cifrate/hash, metadati di accesso e sicurezza).</li>
        <li>Dati di utilizzo del servizio (ricerche voli, interazioni con radar/offerte, eventi di funnel e telemetria tecnica se consentita).</li>
        <li>Dati operativi e di sicurezza (IP pseudonimizzato, request id, eventi anti-abuso e rate-limit).</li>
        <li>Dati di abbonamento e fatturazione (stato piano, customer/subscription id; i dati carta completi sono gestiti dal payment provider).</li>
        <li>Dati relativi ai click outbound verso partner di prenotazione (per tracking tecnico, anti-frode e analisi economica).</li>
      </ul>

      <h2>3. Finalità e basi giuridiche (art. 6 GDPR)</h2>
      <table>
        <tr><th>Finalità</th><th>Base giuridica</th></tr>
        <tr><td>Erogazione del servizio, autenticazione, gestione account e funzionalità richieste dall'utente</td><td>Esecuzione del contratto / misure precontrattuali (art. 6.1.b)</td></tr>
        <tr><td>Protezione piattaforma, prevenzione abusi/frodi, sicurezza applicativa</td><td>Legittimo interesse (art. 6.1.f)</td></tr>
        <tr><td>Gestione piani premium, checkout e webhook di pagamento</td><td>Contratto (art. 6.1.b) e obblighi legali (art. 6.1.c), ove applicabili</td></tr>
        <tr><td>Memorizzazioni funzionali e analytics non necessari</td><td>Consenso (art. 6.1.a)</td></tr>
      </table>

      <h2>4. Destinatari e responsabili esterni</h2>
      <p>I dati possono essere trattati da fornitori tecnici solo se configurati e censiti nel registro DPA. Nel profilo corrente, database/cache e analytics interni sono trattamenti self-managed del Titolare; Stripe opera come titolare autonomo per il payment processing e come responsabile per limitati servizi sotto Stripe DPA. Provider email, OAuth, viaggio e AI non ricevono dati personali se non configurati e approvati nel registro DPA.</p>
      <p>Quando clicchi un link outbound, vieni reindirizzato a un sito terzo: da quel momento si applicano privacy e cookie policy del relativo provider terzo.</p>

      <h2>5. Conservazione dei dati</h2>
      <table>
        <tr><th>Categoria</th><th>Regola di conservazione</th></tr>
        <tr><td>Eventi auth/sicurezza</td><td>Retention configurata via <code>DATA_RETENTION_AUTH_EVENTS_DAYS</code> (default corrente: ${AUTH_EVENT_RETENTION_DAYS} giorni)</td></tr>
        <tr><td>Telemetria prodotto/funnel</td><td>Retention configurata via <code>DATA_RETENTION_CLIENT_TELEMETRY_DAYS</code> (default corrente: ${TELEMETRY_RETENTION_DAYS} giorni)</td></tr>
        <tr><td>Eventi outbound/click tracking</td><td>Retention configurata via <code>DATA_RETENTION_OUTBOUND_EVENTS_DAYS</code> (default corrente: ${OUTBOUND_RETENTION_DAYS} giorni)</td></tr>
        <tr><td>Dati locali browser</td><td>Conservati nel browser fino a cancellazione utente/revoca consenso</td></tr>
      </table>

      <h2>6. Trasferimenti extra-UE</h2>
      <p>Qualora alcuni fornitori trattino dati fuori dallo SEE, i trasferimenti avvengono con le garanzie previste dal GDPR (es. clausole contrattuali standard o meccanismi equivalenti applicabili).</p>

      <h2>7. Diritti dell'interessato</h2>
      <p>Puoi esercitare i diritti di accesso, rettifica, cancellazione, limitazione, opposizione, portabilità e revoca del consenso scrivendo a <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a>. Le richieste sono gestite entro 30 giorni dal ricevimento, salvo estensione consentita dal GDPR per casi complessi. Hai inoltre diritto di proporre reclamo all'autorità competente (in Italia: Garante per la Protezione dei Dati Personali).</p>

      <h2>8. Minori</h2>
      <p>Il servizio non è destinato intenzionalmente a minori di 16 anni senza il coinvolgimento di un genitore/tutore secondo la normativa applicabile.</p>

      <h2>9. Modifiche all'informativa</h2>
      <p>Questa informativa può essere aggiornata. La data di aggiornamento è indicata in alto. In caso di modifiche sostanziali potrai ricevere un avviso in-app o via email, quando necessario.</p>
    `
  );
}

export function renderCookiePolicy() {
  const safeDate = escapeHtml(EFFECTIVE_DATE);

  return page(
    'Cookie Policy',
    `
      <h1>Cookie Policy</h1>
      <p class="meta">Last updated: ${safeDate}</p>

      <h2>1. Modello di consenso</h2>
      <p>L'app usa un modello di consenso per categorie: <strong>necessari</strong> (sempre attivi), <strong>funzionali</strong> e <strong>analytics</strong> (facoltativi). Le categorie facoltative vengono attivate solo dopo consenso esplicito.</p>

      <h2>2. Cookie/strumenti necessari (sempre attivi)</h2>
      <table>
        <tr><th>Nome/Chiave</th><th>Finalità</th><th>Tipo</th></tr>
        <tr><td><code>flight_access_token</code></td><td>Sessione autenticata a breve durata</td><td>Cookie HttpOnly</td></tr>
        <tr><td><code>flight_refresh_token</code></td><td>Rotazione/rinnovo sessione</td><td>Cookie HttpOnly</td></tr>
        <tr><td><code>flight_cookie_consent_v1</code></td><td>Memorizza la tua scelta di consenso</td><td>localStorage</td></tr>
        <tr><td><code>flight_post_auth_action</code>, <code>flight_post_auth_mode</code>, <code>flight_post_auth_view</code>, <code>flight_post_auth_section</code></td><td>Ripristino flusso utente dopo autenticazione</td><td>localStorage</td></tr>
        <tr><td><code>free_device_id</code></td><td>Controllo quota piano free e anti-abuso</td><td>Cookie HttpOnly</td></tr>
      </table>

      <h2>3. Funzionali (richiedono consenso)</h2>
      <table>
        <tr><th>Nome/Chiave</th><th>Finalità</th><th>Tipo</th></tr>
        <tr><td><code>remembered_email</code></td><td>Precompilazione email login</td><td>localStorage</td></tr>
        <tr><td><code>flight_language</code></td><td>Lingua interfaccia</td><td>localStorage</td></tr>
        <tr><td><code>flight_tracked_routes_v1</code></td><td>Rotte salvate dall'utente</td><td>localStorage</td></tr>
        <tr><td><code>flight_saved_itineraries_v1</code></td><td>Itinerari e preferenze locali</td><td>localStorage</td></tr>
        <tr><td><code>flight_radar_session_active_v1</code></td><td>Stato sessione radar</td><td>localStorage</td></tr>
        <tr><td><code>flight_user_plan_v1</code></td><td>Cache locale del piano utente</td><td>localStorage</td></tr>
        <tr><td><code>flight_upgrade_interest_records</code></td><td>Gestione frequenza prompt upgrade</td><td>localStorage</td></tr>
      </table>

      <h2>4. Analytics (richiedono consenso)</h2>
      <table>
        <tr><th>Voce</th><th>Finalità</th><th>Tipo</th></tr>
        <tr><td>Eventi funnel/prodotto</td><td>Misurazione uso servizio e conversione (es. apertura deal, click outbound, upgrade)</td><td>Eventi server-side con retention configurata</td></tr>
        <tr><td>Metriche qualità ricerca</td><td>Stabilità operativa e ottimizzazione UX</td><td>Eventi server-side con retention configurata</td></tr>
      </table>
      <p>Nei flussi applicativi principali non vengono installati tracker advertising di terze parti lato browser senza consenso.</p>

      <h2>5. Come modificare il consenso</h2>
      <p>Puoi aggiornare in qualsiasi momento le preferenze da "Impostazioni cookie" nell'app. La policy viene applicata anche retroattivamente: le chiavi locali non consentite vengono rimosse.</p>

      <h2>6. Siti terzi e redirect outbound</h2>
      <p>Quando apri un link di prenotazione esterno (es. partner travel), esci dall'app. Cookie e tracciamenti del sito terzo sono regolati dalla sua informativa.</p>

      <h2>7. Base giuridica</h2>
      <p>I cookie/strumenti necessari sono utilizzati per erogare il servizio. Le categorie funzionali e analytics sono attivate su base consenso (art. 122 Codice Privacy + GDPR, ove applicabile).</p>
    `
  );
}

export function renderTermsOfService() {
  const safeDate = escapeHtml(EFFECTIVE_DATE);
  const safeAppName = escapeHtml(APP_NAME);
  const safeCompany = escapeHtml(COMPANY);
  const safePrivacyEmail = escapeHtml(PRIVACY_EMAIL);

  return page(
    'Terms and Conditions',
    `
      <h1>Termini e Condizioni</h1>
      <p class="meta">Last updated: ${safeDate}</p>

      <h2>1. Ambito del servizio</h2>
      <p>${safeAppName} è una piattaforma di discovery e confronto opportunità viaggio. Il servizio non vende direttamente biglietti aerei e non è parte contrattuale del trasporto acquistato presso provider terzi.</p>

      <h2>2. Account e requisiti</h2>
      <p>L'utente è responsabile della sicurezza delle proprie credenziali e dell'uso dell'account. L'accesso può essere sospeso o limitato in caso di uso illecito, abuso tecnico o violazione dei presenti Termini.</p>

      <h2>3. Piani, abbonamenti e pagamenti</h2>
      <p>Alcune funzionalità richiedono un piano a pagamento attivo. I pagamenti sono gestiti da provider esterni integrati (es. Stripe), secondo i rispettivi termini.</p>
      <p>Prezzi, rinnovi, limiti d'uso e feature incluse sono mostrati in-app prima dell'acquisto. In caso di rinnovo automatico, cancellazione o downgrade, fa fede lo stato abbonamento registrato dal backend della piattaforma.</p>

      <h2>4. Uso consentito</h2>
      <ul>
        <li>È vietato aggirare limiti tecnici, quote, sistemi anti-abuso, autenticazione o controlli di sicurezza.</li>
        <li>È vietato usare la piattaforma per finalità illecite o in violazione di diritti di terzi.</li>
        <li>È vietato effettuare scraping massivo, reverse engineering o redistribuzione non autorizzata di dati/funzionalità proprietarie.</li>
      </ul>

      <h2>5. Provider terzi e booking outbound</h2>
      <p>Le prenotazioni avvengono su siti/provider terzi tramite redirect outbound. Disponibilità, prezzo finale, condizioni tariffarie, policy bagagli, rimborsi e assistenza post-vendita dipendono dal provider terzo e possono variare rispetto ai dati visualizzati in piattaforma.</p>

      <h2>6. Limitazione di responsabilità</h2>
      <p>Il servizio è fornito “as is” e “as available”. Pur adottando misure ragionevoli di accuratezza e continuità, ${safeCompany} non garantisce assenza di errori/interruzioni né la permanenza delle tariffe mostrate. Nei limiti di legge, la responsabilità per danni indiretti, perdita di opportunità o mancato guadagno è esclusa.</p>

      <h2>7. Sospensione, cessazione e chiusura account</h2>
      <p>Possiamo sospendere o chiudere account per violazioni sostanziali, rischi sicurezza o obblighi normativi. L'utente può richiedere la chiusura account con le funzionalità disponibili in-app o tramite supporto.</p>

      <h2>8. Modifiche del servizio e dei termini</h2>
      <p>Possiamo aggiornare funzionalità, limiti, pricing e presenti Termini per esigenze tecniche, di sicurezza, legali o di business. Le modifiche rilevanti saranno comunicate con preavviso quando richiesto dalla legge applicabile.</p>

      <h2>9. Legge applicabile e foro competente</h2>
      <p>I presenti Termini sono disciplinati dalla legge applicabile nel paese di stabilimento del titolare, fatti salvi i diritti inderogabili del consumatore previsti dalla normativa vigente.</p>

      <h2>10. Contatti</h2>
      <p>Per richieste legali o privacy: <a href="mailto:${safePrivacyEmail}">${safePrivacyEmail}</a>.</p>
    `
  );
}
