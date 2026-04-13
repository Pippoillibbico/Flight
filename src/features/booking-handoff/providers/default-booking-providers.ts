import type { BookingProviderConfig } from '../types/index.ts';

export function createDefaultBookingProviders(): BookingProviderConfig[] {
  return [
    {
      type: 'affiliate',
      partner: 'tde_booking',
      enabled: true,
      priority: 10,
      resolvePath: '/api/outbound/resolve'
    },
    {
      type: 'white_label',
      partner: 'wl_booking',
      enabled: false,
      priority: 20,
      resolvePath: '/api/outbound/resolve'
    },
    {
      type: 'direct',
      partner: 'direct_booking',
      enabled: false,
      priority: 30
    }
  ];
}
