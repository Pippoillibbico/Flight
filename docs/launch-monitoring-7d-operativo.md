# Launch Monitoring 7D (Operativo)

Comando rapido:

```bash
npm run report:launch-7d
```

## 1) KPI table

| Evento | Cosa misura | Perche conta |
| --- | --- | --- |
| homepage_viewed | Visite reali al top funnel | Base per tutti i tassi |
| teaser_deal_viewed | Interesse iniziale su teaser deal | Segnale di comprensione valore |
| deal_opened | Click dal teaser al dettaglio deal | Qualita home + card |
| outbound_clicked | Click monetizzabili verso partner | Entrata primaria |
| signup_completed | Registrazioni completate | Conversione pre-paywall |
| paywall_viewed | Esposizione offerta paid | Ingresso monetizzazione subscription |
| upgrade_started | Intento di pagamento | Qualita pricing/paywall |
| upgrade_completed | Upgrade conclusi | Entrata subscription |
| alternative_departure_viewed | Interesse su Smart Departure | Adozione feature chiave |
| alternative_departure_clicked | Uso concreto alternativa partenza | Impatto su utilita e click outbound |

## 2) Metriche giornaliere (G1 -> G7)

| Giorno | Cosa guardare | Soglia minima OK | Segnale negativo | Interpretazione |
| --- | --- | --- | --- | --- |
| G1 | homepage_viewed, deal_opened, outbound_clicked | deal CTR >= 8%, outbound CTR >= 20% | outbound_clicked = 0 con deal_opened > 20 | Tracking o redirect rotti |
| G2 | signup_completed, paywall_viewed | signup conv >= 2% su outbound | signup = 0 con outbound > 30 | Frizione su signup |
| G3 | upgrade_started, upgrade_completed | start->complete >= 20% | start alto ma complete = 0 | Blocco checkout/paywall |
| G4 | retention e returning users | returning/day >= 12% su active day-1 | ritorni quasi nulli | Valore percepito debole |
| G5 | Smart Departure events | alt click/view >= 15% | viewed alto ma clicked basso | Feature vista ma non usata |
| G6 | stabilita redirect + Stripe | redirect failure < 5%, Stripe fail = 0 | spike errori | Rischio perdita revenue |
| G7 | sintesi funnel completo | upgrade conv >= 1% su paywall | paywall alto, upgrade basso | Posizionamento prezzo/piano non converte |

## 3) Dashboard minima

| Metrica | Formula | Soglia minima |
| --- | --- | --- |
| Traffico totale | homepage_viewed | Crescente o stabile |
| CTR deal | deal_opened / homepage_viewed | >= 10% |
| CTR outbound | outbound_clicked / deal_opened | >= 25% |
| Conversione signup | signup_completed / outbound_clicked | >= 3% |
| Conversione upgrade | upgrade_completed / paywall_viewed | >= 1% |
| Retention utenti tornati | returning_users(today) / active_users(yesterday) | >= 15% dal G4 |

## 4) Decision system

| SE succede | ALLORA fai |
| --- | --- |
| deal CTR basso (<10%) | cambia hero + teaser + CTA primaria in home |
| outbound CTR basso (<25%) | rivedi card deal, proof di prezzo e CTA outbound |
| outbound alto ma signup basso | riduci attrito signup (campi, errore, conferma) |
| paywall views alti ma upgrade completati bassi | correggi copy piano, prova sociale, chiarezza benefici |
| retention bassa dal G4 | attiva trigger di ritorno (alert, radar digest, reminder) |
| free usage alto e costo cresce | stringi limiti free e priorita compute |

## 5) Alert critici (daily)

1. `outbound_clicked = 0` con `deal_opened >= 20`.
2. `upgrade_completed = 0` con `paywall_viewed >= 30` negli ultimi 7 giorni.
3. `outbound_redirect_failed / (failed + success) >= 5%`.
4. Stripe webhook failed nelle ultime 24h (`status=failed` o `invoice.payment_failed`).
5. Costo AI/provider giorno corrente > 1.5x media giorni precedenti.

## 6) Piano operativo giorno 1 -> 7

| Giorno | Focus principale | Controlla | Non fare | Azione consigliata |
| --- | --- | --- | --- | --- |
| 1 | Integrita tracking funnel | eventi minimi e volumi base | cambiare pricing o piano | fix tracking e redirect prima di tutto |
| 2 | Qualita top funnel | CTR deal e CTR outbound | introdurre nuove feature | iterazione solo su hero/teaser/CTA |
| 3 | Registrazione | signup conversion e errori auth | toccare checkout | riduci attrito signup |
| 4 | Monetizzazione paid | paywall -> upgrade | cambiare molti elementi insieme | un test mirato sul paywall |
| 5 | Retention | returning users e repeat click | spendere su acquisition nuova | migliora canali di ritorno |
| 6 | Stabilita operativa | redirect fail, Stripe fail, costi | sperimentazioni non monitorate | hardening tecnico |
| 7 | Decisione go/no-go | metriche aggregate 7d | cambiare stack o architettura | piano di ottimizzazione settimana 2 |
