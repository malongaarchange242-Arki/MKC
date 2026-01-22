import { z } from 'zod';

/**
 * ===============================
 * ENV SCHEMA
 * ===============================
 */
const envSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_PORT: z.string().default('3000'),

  // 🔐 JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET is too short'),

  // 🔌 Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string(),
  SUPABASE_SERVICE_ROLE_KEY: z.string()
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
  APP_PORT: Number(parsedEnv.data.APP_PORT)
};
