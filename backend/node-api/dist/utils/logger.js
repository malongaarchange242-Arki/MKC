"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const winston_1 = __importDefault(require("winston"));
const { combine, timestamp, printf, colorize, errors } = winston_1.default.format;
// ===============================
// ENSURE LOG DIRECTORY EXISTS
// ===============================
const logDir = path_1.default.resolve('logs');
if (!fs_1.default.existsSync(logDir)) {
    fs_1.default.mkdirSync(logDir, { recursive: true });
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
exports.logger = winston_1.default.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(errors({ stack: true }), timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }), logFormat),
    transports: [
        // Console (dev & prod)
        new winston_1.default.transports.Console({
            format: combine(colorize(), logFormat)
        }),
        // Error logs
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, 'error.log'),
            level: 'error'
        }),
        // Combined logs
        new winston_1.default.transports.File({
            filename: path_1.default.join(logDir, 'combined.log')
        })
    ],
    exitOnError: false
});
//# sourceMappingURL=logger.js.map