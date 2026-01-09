import fs from 'fs';
import path from 'path';
import winston from 'winston';

const { combine, timestamp, printf, colorize, errors } = winston.format;

// ===============================
// ENSURE LOG DIRECTORY EXISTS
// ===============================
const logDir = path.resolve('logs');

if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// ===============================
// LOG FORMAT
// ===============================
const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaString = Object.keys(meta).length ? JSON.stringify(meta) : '';
  return `${timestamp} [${level}]: ${stack || message} ${metaString}`;
});

// ===============================
// LOGGER INSTANCE
// ===============================
export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    logFormat
  ),
  transports: [
    // Console (dev & prod)
    new winston.transports.Console({
      format: combine(colorize(), logFormat)
    }),

    // Error logs
    new winston.transports.File({
      filename: path.join(logDir, 'error.log'),
      level: 'error'
    }),

    // Combined logs
    new winston.transports.File({
      filename: path.join(logDir, 'combined.log')
    })
  ],
  exitOnError: false
});
