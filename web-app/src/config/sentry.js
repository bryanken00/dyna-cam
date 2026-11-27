import * as Sentry from "@sentry/react";

export const initSentry = () => {
  // Only initialize Sentry in production or if DSN is provided
  const dsn = import.meta.env.VITE_SENTRY_DSN;

  if (dsn) {
    Sentry.init({
      dsn,
      environment: import.meta.env.VITE_APP_ENV || "development",
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,
          blockAllMedia: true,
        }),
      ],
      // Performance Monitoring
      tracesSampleRate:
        import.meta.env.VITE_APP_ENV === "production" ? 0.1 : 1.0,
      // Session Replay
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
      // Disable in development if desired
      enabled: import.meta.env.VITE_APP_ENV === "production",

      // Release version — front/package.json's `version`, injected by vite.config.js
      release: import.meta.env.APP_VERSION,

      // Sentry 11 collects user info (IP), cookies and request bodies by default.
      // Keep them out — a body can be a sign-in or password form. Headers and
      // URL query params are still sent, with auth/token/cookie-like keys filtered.
      dataCollection: {
        userInfo: false,
        cookies: false,
        httpBodies: [],
      },

      beforeSend(event, hint) {
        // Don't send certain errors
        const error = hint.originalException;

        if (error && error.message) {
          // Ignore network errors
          if (error.message.includes("Network Error")) {
            return null;
          }

          // Ignore 401/403 errors
          if (
            error.response?.status === 401 ||
            error.response?.status === 403
          ) {
            return null;
          }
        }

        return event;
      },
    });
  }
};
