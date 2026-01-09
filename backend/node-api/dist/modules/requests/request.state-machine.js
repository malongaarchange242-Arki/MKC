"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFinalState = exports.assertTransitionAllowed = exports.canTransition = exports.REQUEST_STATUSES = void 0;
exports.REQUEST_STATUSES = [
    'CREATED',
    'AWAITING_DOCUMENTS',
    'SUBMITTED',
    'PROCESSING', // ✅ AJOUT
    'UNDER_REVIEW',
    'DRAFT_SENT',
    'PAYMENT_PROOF_UPLOADED',
    'PAYMENT_CONFIRMED',
    'DRAFT_READY',
    'AWAITING_PAYMENT_PROOF',
    'PAYMENT_SUBMITTED',
    'VALIDATED',
    'ISSUED',
    'REJECTED',
    'CANCELLED'
];
// ===============================
// STATE MACHINE
// ===============================
const STATE_TRANSITIONS = {
    CREATED: [
        { to: 'AWAITING_DOCUMENTS', allowedRoles: ['CLIENT', 'SYSTEM'] }
    ],
    AWAITING_DOCUMENTS: [
        { to: 'SUBMITTED', allowedRoles: ['CLIENT'] },
        { to: 'CANCELLED', allowedRoles: ['CLIENT'] }
    ],
    SUBMITTED: [
        { to: 'PROCESSING', allowedRoles: ['SYSTEM'] }, // ✅ OCR / BL extraction
        { to: 'UNDER_REVIEW', allowedRoles: ['ADMIN'] },
        { to: 'REJECTED', allowedRoles: ['ADMIN'] }
    ],
    PROCESSING: [
        { to: 'UNDER_REVIEW', allowedRoles: ['SYSTEM', 'ADMIN'] },
        { to: 'REJECTED', allowedRoles: ['SYSTEM'] }
    ],
    UNDER_REVIEW: [
        { to: 'DRAFT_READY', allowedRoles: ['ADMIN'] },
        { to: 'DRAFT_SENT', allowedRoles: ['ADMIN'] },
        { to: 'REJECTED', allowedRoles: ['ADMIN'] }
    ],
    DRAFT_READY: [
        { to: 'AWAITING_PAYMENT_PROOF', allowedRoles: ['ADMIN'] }
    ],
    DRAFT_SENT: [
        { to: 'AWAITING_PAYMENT_PROOF', allowedRoles: ['CLIENT'] },
        { to: 'PAYMENT_PROOF_UPLOADED', allowedRoles: ['CLIENT'] },
        { to: 'CANCELLED', allowedRoles: ['CLIENT'] }
    ],
    PAYMENT_PROOF_UPLOADED: [
        { to: 'PAYMENT_CONFIRMED', allowedRoles: ['ADMIN'] },
        { to: 'REJECTED', allowedRoles: ['ADMIN'] }
    ],
    PAYMENT_CONFIRMED: [
        { to: 'VALIDATED', allowedRoles: ['ADMIN'] },
        { to: 'ISSUED', allowedRoles: ['ADMIN', 'SYSTEM'] }
    ],
    AWAITING_PAYMENT_PROOF: [
        { to: 'PAYMENT_SUBMITTED', allowedRoles: ['CLIENT'] },
        { to: 'CANCELLED', allowedRoles: ['CLIENT'] }
    ],
    PAYMENT_SUBMITTED: [
        { to: 'VALIDATED', allowedRoles: ['ADMIN'] },
        { to: 'REJECTED', allowedRoles: ['ADMIN'] }
    ],
    VALIDATED: [
        { to: 'ISSUED', allowedRoles: ['ADMIN', 'SYSTEM'] }
    ],
    ISSUED: [],
    REJECTED: [],
    CANCELLED: []
};
// ===============================
// STATE MACHINE FUNCTIONS
// ===============================
const canTransition = (from, to, role) => {
    const rules = STATE_TRANSITIONS[from];
    if (!rules)
        return false;
    return rules.some((rule) => rule.to === to && rule.allowedRoles.includes(role));
};
exports.canTransition = canTransition;
// ===============================
// VALIDATION WITH ERROR
// ===============================
const assertTransitionAllowed = (from, to, role) => {
    if (!(0, exports.canTransition)(from, to, role)) {
        throw new Error(`Transition not allowed: ${from} → ${to} (role: ${role})`);
    }
};
exports.assertTransitionAllowed = assertTransitionAllowed;
// ===============================
// HELPER: FINAL STATES
// ===============================
const isFinalState = (status) => {
    return ['ISSUED', 'REJECTED', 'CANCELLED'].includes(status);
};
exports.isFinalState = isFinalState;
//# sourceMappingURL=request.state-machine.js.map