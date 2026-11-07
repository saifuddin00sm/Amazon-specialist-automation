/** The product name Amazon sees. Keep it in step with the web app's working name (apps/web/lib/site.ts). */
export const APP_NAME = "Specialist";
export const APP_VERSION = "0.1.0";

/** How every request to Amazon, LWA included, identifies the app. Amazon asks SP-API callers for this shape. */
export const USER_AGENT = `${APP_NAME}/${APP_VERSION} (Language=TypeScript) Agent/${APP_NAME}`;
