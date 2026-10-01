/**
 * The account the app works under when sign-in is disabled (local `next dev`
 * and browser tests). A dependency-free module because scripts run via `tsx`
 * need it too, and `server-only` does not resolve there.
 */
export const DEFAULT_ACCOUNT_ID = 'vyvoj-spravce'
