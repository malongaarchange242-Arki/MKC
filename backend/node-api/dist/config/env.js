"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const zod_1 = require("zod");
/**
 * ===============================
 * ENV SCHEMA
 * ===============================
 */
const envSchema = zod_1.z.object({
    APP_ENV: zod_1.z.enum(['development', 'staging', 'production']).default('development'),
    APP_PORT: zod_1.z.string().default('3000'),
    // 🔐 JWT
    JWT_SECRET: zod_1.z.string().min(32, 'JWT_SECRET is too short'),
    // 🔌 Supabase
    SUPABASE_URL: zod_1.z.string().url(),
    SUPABASE_ANON_KEY: zod_1.z.string(),
    SUPABASE_SERVICE_ROLE_KEY: zod_1.z.string()
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
exports.env = {
    ...parsedEnv.data,
    APP_PORT: Number(parsedEnv.data.APP_PORT)
};
//# sourceMappingURL=env.js.map