import { createLogger, format, transports } from "winston";

const baseFormat = format.combine(
  format.timestamp(),
  format.errors({ stack: true }),
  format.printf(({ level, message, timestamp, ...meta }) => {
    const payload = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} [${level.toUpperCase()}] ${message}${payload}`;
  })
);

export const logger = createLogger({
  level: "info",
  format: baseFormat,
  transports: [
    new transports.Console(),
    new transports.File({ filename: "server.log" })
  ]
});
