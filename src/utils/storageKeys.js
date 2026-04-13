/**
 * Canonical browser storage keys used across consent, personalization and auth-resume flows.
 * Keep these values in one place to avoid drift between modules and legal/cookie docs.
 */

export const CONSENT_STORAGE_KEY = 'flight_cookie_consent_v1';
export const LANGUAGE_STORAGE_KEY = 'flight_language';
export const REMEMBERED_EMAIL_STORAGE_KEY = 'remembered_email';
export const TRACKED_ROUTES_STORAGE_KEY = 'flight_tracked_routes_v1';
export const SAVED_ITINERARIES_STORAGE_KEY = 'flight_saved_itineraries_v1';
export const RADAR_SESSION_ACTIVE_STORAGE_KEY = 'flight_radar_session_active_v1';
export const USER_PLAN_STORAGE_KEY = 'flight_user_plan_v1';
export const UPGRADE_INTEREST_STORAGE_KEY = 'flight_upgrade_interest_records';
export const POST_AUTH_ACTION_STORAGE_KEY = 'flight_post_auth_action';
export const POST_AUTH_MODE_STORAGE_KEY = 'flight_post_auth_mode';
export const POST_AUTH_VIEW_STORAGE_KEY = 'flight_post_auth_view';
export const POST_AUTH_SECTION_STORAGE_KEY = 'flight_post_auth_section';

export const NECESSARY_LOCAL_STORAGE_KEYS = [
  CONSENT_STORAGE_KEY,
  POST_AUTH_ACTION_STORAGE_KEY,
  POST_AUTH_MODE_STORAGE_KEY,
  POST_AUTH_VIEW_STORAGE_KEY,
  POST_AUTH_SECTION_STORAGE_KEY
];

export const FUNCTIONAL_LOCAL_STORAGE_KEYS = [
  REMEMBERED_EMAIL_STORAGE_KEY,
  LANGUAGE_STORAGE_KEY,
  TRACKED_ROUTES_STORAGE_KEY,
  SAVED_ITINERARIES_STORAGE_KEY,
  RADAR_SESSION_ACTIVE_STORAGE_KEY,
  USER_PLAN_STORAGE_KEY,
  UPGRADE_INTEREST_STORAGE_KEY
];

export const ANALYTICS_LOCAL_STORAGE_KEYS = [];
