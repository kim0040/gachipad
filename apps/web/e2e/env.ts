/** Ports and names of the end-to-end stack; they differ from the dev stack so both can run at once. */
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5199);
export const API_PORT = Number(process.env.E2E_API_PORT ?? 3101);
export const COLLAB_PORT = Number(process.env.E2E_COLLAB_PORT ?? 3102);
export const BASE_URL = `http://localhost:${WEB_PORT}`;
export const MONGO_URL = process.env.E2E_MONGO_URL ?? "mongodb://localhost:27017/gachipad_e2e";
/** Optional backend URL passed to both servers; when absent the MongoDB default stays active. */
export const DATABASE_URL = process.env.E2E_DATABASE_URL;
export const VALKEY_URL = process.env.E2E_VALKEY_URL ?? "redis://localhost:6379/5";

/** The first-run tour has been seen. Any version at or above the app's counts as seen. */
const TOUR_SEEN = { name: "gachipad.tour", value: "9999" };
/** The one-time "drag files in" tip is gone for good. */
const DROP_TIP_SEEN = { name: "gachipad.tip.drop", value: "1" };

/**
 * A browser profile that starts with these keys skips the tour and the file tip, so specs about
 * other things never meet either of them.
 */
export const TOUR_SEEN_STORAGE = {
  cookies: [],
  origins: [{ origin: BASE_URL, localStorage: [TOUR_SEEN, DROP_TIP_SEEN] }],
};

/** The tour is seen but the file tip is not: the profile the tip's own specs start from. */
export const TIP_UNSEEN_STORAGE = {
  cookies: [],
  origins: [{ origin: BASE_URL, localStorage: [TOUR_SEEN] }],
};

/** Token of the admin API in the end-to-end stack (the API switches the admin console off without one). */
export const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? "e2e-admin-token";
