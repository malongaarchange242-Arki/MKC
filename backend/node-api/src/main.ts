/**
 * ===============================
 * BOOTSTRAP ENV (DO NOT MOVE)
 * ===============================
 */
import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * ===============================
 * IMPORTS
 * ===============================
 */
import express, { Application, Request, Response, NextFunction } from 'express';
import cors, { CorsOptions } from 'cors';
import helmet from 'helmet';
import http from 'http';

import { env } from './config/env';
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
const PORT = env.APP_PORT;
const APP_ENV = env.APP_ENV;

const configuredOrigins = (env.CORS_ORIGINS || env.CORS_ORIGIN || 'http://localhost:8080,http://127.0.0.1:8080,https://mkc-frontend.onrender.com')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const developmentOrigins = APP_ENV === 'development'
  ? ['http://localhost:5501', 'http://127.0.0.1:5501']
  : [];
const allowedOrigins = [...new Set([...configuredOrigins, ...developmentOrigins])];

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    logger.warn('Rejected CORS origin', { origin, allowedOrigins });
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
  credentials: true
};

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
app.use(cors(corsOptions));
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

// Verify Python parse endpoint by making a short call using configured API key.
// This route must remain server-side only and require an authenticated admin session.
app.get('/services/python/verify', authMiddleware, async (req: Request, res: Response) => {
  if ((req as any).authUserRole !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden' });
  }

  const pythonCfg = env.PYTHON_SERVICE_URL;
  const endpoint = pythonCfg.includes('/api/') ? pythonCfg : `${pythonCfg.replace(/\/$/, '')}/api/v1/parse/document`;
  const apiKey = env.PYTHON_SERVICE_API_KEY;

  try {
    const payload = { file_url: 'https://example.com/noop.pdf', document_id: 'verify', request_id: 'verify' };
    const resp = await axios.post(endpoint, payload, {
      headers: { 'x-api-key': apiKey.replace(/\s/g, '') }
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

server.listen(PORT, '0.0.0.0', async () => {
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
