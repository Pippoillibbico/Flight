import { expect } from './guarded-test';
import { bootLanding, createDefaultState, loginFromUi } from './app-test-kit';

export function successSearchResponse() {
  return {
    meta: { count: 1, stayDays: 6, requestMode: 'multi_city' },
    alerts: [],
    flights: [
      {
        id: 'multi-1',
        origin: 'MXP',
        destination: 'Tokyo',
        destinationIata: 'TYO',
        price: 388,
        avg2024: 520,
        savingVs2024: 132,
        stopLabel: '1 stop',
        stopCount: 1,
        departureTimeLabel: '10:40',
        arrivalTimeLabel: '22:00',
        durationHours: 12,
        comfortScore: 72,
        bookingLink: 'https://example.com/book/multi-1',
        link: 'https://example.com/book/multi-1'
      }
    ]
  };
}

function segmentPrefix(index) {
  return `Segment ${index + 1}`;
}

export function segmentOriginLocator(page, index) {
  return page.getByLabel(`${segmentPrefix(index)} Origin`, { exact: true });
}

export function segmentDestinationLocator(page, index) {
  return page.getByLabel(`${segmentPrefix(index)} Destination`, { exact: true });
}

export function segmentDateLocator(page, index) {
  return page.getByLabel(`${segmentPrefix(index)} Departure`, { exact: true });
}

export async function fillSegment(page, index, { origin, destination, date }) {
  await segmentOriginLocator(page, index).fill(origin);
  await segmentDestinationLocator(page, index).fill(destination);
  await segmentDateLocator(page, index).fill(date);
}

export async function openExplore(page) {
  await page.getByRole('button', { name: /^Explore$/, exact: true }).click();
  await expect(page.getByRole('button', { name: /^Multi-city$/, exact: true })).toBeVisible();
}

export async function switchToMultiCity(page) {
  await page.getByRole('button', { name: /^Multi-city$/, exact: true }).click();
  await expect(page.getByTestId('multi-city-panel')).toBeVisible();
}

export async function bootMultiCity(page, { language = 'en', state = createDefaultState() } = {}) {
  await bootLanding(page, state, { language });
  await loginFromUi(page);
  await openExplore(page);
  await switchToMultiCity(page);
}

export function addSegmentButton(page) {
  return page.getByRole('button', { name: /^Add segment$/, exact: true });
}

export function removeSegmentButton(page, segmentIndex) {
  return page.getByRole('button', { name: new RegExp(`^Remove segment ${segmentIndex + 1}$`) });
}

