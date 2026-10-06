import { z } from 'zod';

/**
 * ===============================
 * ENV SCHEMA
 * ===============================
 */
const envSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_PORT: z.string().regex(/^\d+$/).optional(),

  // 🔐 JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET is too short'),

  // 🔌 Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string(),

  // 🔗 Internal Python service
  PYTHON_SERVICE_URL: z.string().url(),
  PYTHON_SERVICE_API_KEY: z.string().min(16, 'PYTHON_SERVICE_API_KEY is too short'),

  // 🌐 CORS
  CORS_ORIGINS: z.string().optional(),
  CORS_ORIGIN: z.string().optional()
});

/**
 * ===============================
 * PARSE ENV
 * ===============================
 */
const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables');
  console.error(parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

/**
 * ===============================
 * EXPORT SAFE ENV
 * ===============================
 */
export const env = {
  ...parsedEnv.data,
  APP_PORT: Number(process.env.PORT || parsedEnv.data.APP_PORT || '3000')
};
