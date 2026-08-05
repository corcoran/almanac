import { loadAllowedEmails, loadConfig } from "./config.js";
import { buildLoggerOptions } from "./logger.js";
import { buildApp } from "./server.js";

const cfg = loadConfig();
const allowedEmails = loadAllowedEmails(cfg.ALMANAC_ALLOWED_EMAILS);
const app = buildApp({
  dbPath: cfg.ALMANAC_DB_PATH,
  trustProxyHeaders: cfg.ALMANAC_TRUST_PROXY_HEADERS,
  allowedEmails,
  logger: buildLoggerOptions({
    isProd: cfg.NODE_ENV === "production",
    level: cfg.ALMANAC_LOG_LEVEL,
  }),
});

app.listen({ port: cfg.ALMANAC_API_PORT, host: cfg.ALMANAC_API_HOST }).then(() => {
  app.log.info(`almanac-api listening on ${cfg.ALMANAC_API_HOST}:${cfg.ALMANAC_API_PORT}`);
});
