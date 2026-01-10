"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DraftsController = void 0;
const zod_1 = require("zod");
const drafts_service_1 = require("./drafts.service");
const request_user_1 = require("../../utils/request-user");
const logger_1 = require("../../utils/logger");
const handleControllerError = (res, error, context = '') => {
    logger_1.logger.error(`${context} failed`, { error });
    if (error instanceof zod_1.ZodError)
        return res.status(422).json({ message: 'Invalid payload', errors: error.flatten().fieldErrors });
    if (error instanceof Error)
        return res.status(400).json({ message: error.message });
    return res.status(500).json({ message: 'Unexpected error' });
};
class DraftsController {
    // GET /drafts/:id/download -> returns a signed url (only client owner or admin)
    static async download(req, res) {
        try {
            const userId = (0, request_user_1.getAuthUserId)(req);
            const role = (0, request_user_1.getAuthUserRole)(req);
            if (!userId)
                return res.status(401).json({ message: 'Unauthorized' });
            const draftId = req.params.id;
            const draft = await drafts_service_1.DraftsService.getDraftById(draftId);
            // Verify ownership: client owner of request OR ADMIN/SYSTEM
            if (role !== 'ADMIN' && role !== 'SYSTEM') {
                // verify that the requester is the client of the related request
                    const { data: reqRow, error } = await (await Promise.resolve().then(() => __importStar(require('../../config/supabase')))).supabase
                        .from('requests')
                        .select('user_id')
                        .eq('id', draft.request_id)
                        .single();
                if (error || !reqRow || reqRow.user_id !== userId) {
                    return res.status(403).json({ message: 'Forbidden' });
                }
            }
            const url = await drafts_service_1.DraftsService.generateSignedUrl(draftId, 60 * 10);
            return res.status(200).json({ success: true, url });
        }
        catch (error) {
            return handleControllerError(res, error, 'Download draft');
        }
    }
}
exports.DraftsController = DraftsController;
//# sourceMappingURL=drafts.controller.js.map