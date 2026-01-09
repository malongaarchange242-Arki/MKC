"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * ===============================
 * BOOTSTRAP ENV (DO NOT MOVE)
 * ===============================
 */
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
/**
 * ===============================
 * IMPORTS
 * ===============================
 */
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const http_1 = __importDefault(require("http"));
const logger_1 = require("./utils/logger");
const axios_1 = __importDefault(require("axios"));
const requests_module_1 = require("./modules/requests/requests.module");
const auth_module_1 = require("./modules/auth/auth.module");
const users_module_1 = require("./modules/users/users.module");
const documents_module_1 = require("./modules/documents/documents.module");
const admin_module_1 = require("./modules/admin/admin.module");
const drafts_module_1 = require("./modules/drafts/drafts.module");
const supabase_1 = require("./config/supabase");
const auth_middleware_1 = require("./middlewares/auth.middleware");
const notifications_module_1 = __importDefault(require("./modules/notifications/notifications.module"));
/**
 * ===============================
 * ENV VARIABLES
 * ===============================
 */
const PORT = Number(process.env.APP_PORT) || 3000;
const APP_ENV = process.env.APP_ENV || 'development';
/**
 * ===============================
 * APP INITIALIZATION
 * ===============================
 */
const app = (0, express_1.default)();
/**
 * ===============================
 * GLOBAL MIDDLEWARES
 * ===============================
 */
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
/**
 * ===============================
 * HEALTH CHECK
 * ===============================
 */
app.get('/health', async (_req, res) => {
    res.status(200).json({
        status: 'ok',
        service: 'FERI / AD Backend',
        environment: APP_ENV,
        timestamp: new Date().toISOString()
    });
});
// Verify Python parse endpoint by making a short call using configured API key
app.get('/services/python/verify', async (_req, res) => {
    const pythonCfg = process.env.PYTHON_SERVICE_URL || 'http://127.0.0.1:8000';
    // if the configured URL already points to a parsing endpoint, use it, otherwise append path
    const endpoint = pythonCfg.includes('/api/') ? pythonCfg : `${pythonCfg.replace(/\/$/, '')}/api/v1/parse/document`;
    const apiKey = process.env.PYTHON_SERVICE_API_KEY || '';
    try {
        const payload = { file_url: 'https://example.com/noop.pdf', document_id: 'verify', request_id: 'verify' };
        const resp = await axios_1.default.post(endpoint, payload, {
            headers: apiKey ? { 'x-api-key': apiKey } : undefined
        });
        return res.status(200).json({ ok: true, endpoint, status: resp.status, data: resp.data });
    }
    catch (err) {
        const info = { endpoint };
        if (err.response)
            info.response = { status: err.response.status, data: err.response.data };
        if (err.message)
            info.message = err.message;
        logger_1.logger.warn('Python service verify failed', info);
        return res.status(502).json({ ok: false, error: info });
    }
});
/**
 * ===============================
 * MODULE ROUTES
 * ===============================
 */
// MODULE ROUTES
app.use('/auth', (0, auth_module_1.authModule)());
app.use('/users', (0, users_module_1.usersModule)());
app.use('/requests', auth_middleware_1.authMiddleware, (0, requests_module_1.requestsModule)());
app.use('/documents', (0, documents_module_1.documentsModule)());
app.use('/admin', (0, admin_module_1.adminModule)());
app.use('/notifications', notifications_module_1.default);
app.use('/drafts', (0, drafts_module_1.draftsModule)());
/**
 * ===============================
 * GLOBAL ERROR HANDLER
 * ===============================
 */
app.use((err, _req, res, _next) => {
    logger_1.logger.error('Unhandled error', {
        message: err.message,
        stack: err.stack
    });
    res.status(500).json({
        success: false,
        message: 'Internal server error'
    });
});
/**
 * ===============================
 * SERVER START
 * ===============================
 */
const server = http_1.default.createServer(app);
server.listen(PORT, async () => {
    logger_1.logger.info(`Server started on port ${PORT} [${APP_ENV}]`);
    // Log Supabase URL and a short preview of the key (first 8 chars)
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const anonKey = process.env.SUPABASE_ANON_KEY;
        const keyPreview = serviceKey
            ? `${serviceKey.slice(0, 8)} (service)`
            : anonKey
                ? `${anonKey.slice(0, 8)} (anon)`
                : 'no-key';
        logger_1.logger.info('Supabase config', { url: supabaseUrl, keyPreview });
        await (0, supabase_1.checkSupabaseConnection)();
        logger_1.logger.info('Supabase connection established');
    }
    catch (err) {
        logger_1.logger.error('Supabase unavailable at startup', {
            error: err?.message ?? String(err),
            stack: err?.stack
        });
        // stop app if DB is mandatory
        setTimeout(() => process.exit(1), 500);
    }
});
/**
 * ===============================
 * GRACEFUL SHUTDOWN
 * ===============================
 */
const shutdown = (signal) => {
    logger_1.logger.warn(`Received ${signal}. Shutting down gracefully...`);
    server.close(() => {
        logger_1.logger.info('HTTP server closed');
        process.exit(0);
    });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
exports.default = app;
//# sourceMappingURL=main.js.map