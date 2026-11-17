import { maskCredentials } from "./util.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold = LEVELS.info;

export const setLogLevel = (level) => {
  threshold = LEVELS[level] ?? LEVELS.info;
};

const describe = (extra) => {
  if (extra === undefined) return "";
  if (extra instanceof Error) return ` — ${extra.message}`;
  if (typeof extra === "string") return ` — ${extra}`;
  return ` ${JSON.stringify(extra)}`;
};

/**
 * One line per event: `ISO-time LEVEL [scope] message`. Everything passes
 * through maskCredentials, so a camera password can never reach the logs.
 */
const write = (level, scope, message, extra) => {
  if (LEVELS[level] < threshold) return;
  const line = maskCredentials(
    `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}${describe(extra)}`
  );
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
};

export const createLogger = (scope) => ({
  debug: (message, extra) => write("debug", scope, message, extra),
  info: (message, extra) => write("info", scope, message, extra),
  warn: (message, extra) => write("warn", scope, message, extra),
  error: (message, extra) => write("error", scope, message, extra),
});
