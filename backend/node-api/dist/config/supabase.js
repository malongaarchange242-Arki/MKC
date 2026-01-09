"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkSupabaseConnection = exports.supabase = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const logger_1 = require("../utils/logger");
const dotenv_1 = __importDefault(require("dotenv"));
const path_1 = __importDefault(require("path"));
// Ensure backend/.env is loaded (resolve relative to this file)
const envPath = path_1.default.resolve(__dirname, '../../../.env');
dotenv_1.default.config({ path: envPath });
// ===============================
// ENV VALIDATION
// ===============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    logger_1.logger.error('Supabase environment variables are missing');
    throw new Error('Missing Supabase configuration');
}
// ===============================
// SUPABASE CLIENT
// ===============================
exports.supabase = (0, supabase_js_1.createClient)(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});
// ===============================
// HEALTH CHECK (OPTIONAL)
// ===============================
const checkSupabaseConnection = async () => {
    try {
        await exports.supabase.auth.admin.listUsers({ page: 1, perPage: 1 });
        logger_1.logger.info('Supabase connection established');
    }
    catch (error) {
        logger_1.logger.error('Supabase connection failed', { error });
        throw new Error('Supabase connection failed');
    }
};
exports.checkSupabaseConnection = checkSupabaseConnection;
//# sourceMappingURL=supabase.js.map