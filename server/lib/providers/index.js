/**
 * Providers layer facade.
 * Keep legacy module paths working while exposing a clear architecture entrypoint.
 */

export { createFlightProviderRegistry } from '../flight-provider.js';
export { createProviderRegistry } from './provider-registry.js';
