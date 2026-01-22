/**
 * ===============================
 * BOOTSTRAP ENV (DO NOT MOVE)
 * ===============================
 */
import dotenv from 'dotenv';
dotenv.config();

/**
 * ===============================
 * IMPORTS
 * ===============================
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';

import { logger } from './utils/logger';
import axios from 'axios';
import { requestsModule } from './modules/requests/requests.module';
import { authModule } from './modules/auth/auth.module';
import { usersModule } from './modules/users/users.module';
import { documentsModule } from './modules/documents/documents.module';
import { adminModule } from './modules/admin/admin.module';
import { draftsModule } from './modules/drafts/drafts.module';
import { paymentsModule } from './modules/payments/payments.module';
import { checkSupabaseConnection } from './config/supabase';
import { authMiddleware } from './middlewares/auth.middleware';
import notificationsRouter from './modules/notifications/notifications.module';




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
const app: Application = express();    

/**
 * ===============================
 * GLOBAL MIDDLEWARES
 * ===============================
 */
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

/**
 * ===============================
 * HEALTH CHECK
 * ===============================
 */
app.get('/health', async (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'FERI / AD Backend',
    environment: APP_ENV,
    timestamp: new Date().toISOString()
  });
});

// Verify Python parse endpoint by making a short call using configured API key
app.get('/services/python/verify', async (_req: Request, res: Response) => {
  const pythonCfg = process.env.PYTHON_SERVICE_URL || 'https://mkc-5slv.onrender.com/api/v1';
  // if the configured URL already points to a parsing endpoint, use it, otherwise append path
  const endpoint = pythonCfg.includes('/api/') ? pythonCfg : `${pythonCfg.replace(/\/$/, '')}/api/v1/parse/document`;
  const apiKey = process.env.PYTHON_SERVICE_API_KEY || '';

  try {
    const payload = { file_url: 'https://example.com/noop.pdf', document_id: 'verify', request_id: 'verify' };
    const resp = await axios.post(endpoint, payload, {
      headers: apiKey ? { 'x-api-key': apiKey } : undefined
    });

    return res.status(200).json({ ok: true, endpoint, status: resp.status, data: resp.data });
  } catch (err: any) {
    const info: any = { endpoint };
    if (err.response) info.response = { status: err.response.status, data: err.response.data };
    if (err.message) info.message = err.message;
    logger.warn('Python service verify failed', info);
    return res.status(502).json({ ok: false, error: info });
  }
});

/**
 * ===============================
 * MODULE ROUTES
 * ===============================
 */
// MODULE ROUTES
app.use('/auth', authModule());
app.use('/users', usersModule());
app.use('/requests', authMiddleware, requestsModule());
// Also expose same requests API under /api prefix for client/frontend
app.use('/api/requests', authMiddleware, requestsModule());
app.use('/documents', documentsModule());
app.use('/admin', adminModule());
app.use('/notifications', notificationsRouter);
app.use('/drafts', draftsModule());
// Client-facing billing endpoints (protected)
app.use('/api/client', authMiddleware, paymentsModule());

/**
 * ===============================
 * GLOBAL ERROR HANDLER
 * ===============================
 */
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', {
      message: err.message,
      stack: err.stack
    });

    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
);

/**
 * ===============================
 * SERVER START
 * ===============================
 */
const server = http.createServer(app);

server.listen(PORT, async () => {
  logger.info(`Server started on port ${PORT} [${APP_ENV}]`);

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

    logger.info('Supabase config', { url: supabaseUrl, keyPreview });

    await checkSupabaseConnection();
    logger.info('Supabase connection established');
  } catch (err: any) {
    logger.error('Supabase unavailable at startup', {
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
const shutdown = (signal: string) => {
  logger.warn(`Received ${signal}. Shutting down gracefully...`);

  server.close(() => {
    logger.info('HTTP server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
