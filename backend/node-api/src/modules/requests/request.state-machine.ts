// modules/requests/request.state-machine.ts
// ===============================
// REQUEST TYPES
// ===============================
export type RequestType =
  | 'FERI_ONLY'
  | 'AD_ONLY'
  | 'FERI_AND_AD';

// ===============================
// REQUEST STATUSES
// ===============================
export type RequestStatus =
  | 'CREATED'
  | 'AWAITING_DOCUMENTS'
  | 'AWAITING_PAYMENT'
  | 'SUBMITTED'
  | 'PROCESSING'
  | 'UNDER_REVIEW'
  | 'DRAFT_SENT'
  | 'PROFORMAT_SENT'
  | 'PAYMENT_PROOF_UPLOADED'
  | 'PAYMENT_CONFIRMED'
  | 'VALIDATED'
  | 'ISSUED'
  | 'REJECTED'
  | 'CANCELLED';

export const REQUEST_STATUSES = [
  'CREATED',
  'AWAITING_DOCUMENTS',
  'AWAITING_PAYMENT',
  'SUBMITTED',
  'PROCESSING',
  'UNDER_REVIEW',
  'DRAFT_SENT',
  'PROFORMAT_SENT',
  'PAYMENT_PROOF_UPLOADED',
  'PAYMENT_CONFIRMED',
  'VALIDATED',
  'ISSUED',
  'REJECTED',
  'CANCELLED'
] as const;

// ===============================
// ACTORS
// ===============================
export type ActorRole = 'CLIENT' | 'ADMIN' | 'SYSTEM';

// ===============================
// TRANSITION RULES
// ===============================
type TransitionRule = {
  to: RequestStatus;
  allowedRoles: ActorRole[];
};

// ===============================
// STATE MACHINE
// ===============================
const STATE_TRANSITIONS: Record<RequestStatus, TransitionRule[]> = {
  CREATED: [
    { to: 'AWAITING_DOCUMENTS', allowedRoles: ['CLIENT', 'SYSTEM'] },
    // Allow admin to directly issue a draft from CREATED
    { to: 'DRAFT_SENT', allowedRoles: ['ADMIN'] }
  ],

  AWAITING_DOCUMENTS: [
    { to: 'SUBMITTED', allowedRoles: ['CLIENT'] },
    { to: 'CANCELLED', allowedRoles: ['CLIENT'] },
    // Allow admin to issue draft when awaiting documents
    { to: 'DRAFT_SENT', allowedRoles: ['ADMIN'] }
  ],

  SUBMITTED: [
    { to: 'PROCESSING', allowedRoles: ['SYSTEM'] },
    { to: 'UNDER_REVIEW', allowedRoles: ['ADMIN'] },
    { to: 'REJECTED', allowedRoles: ['ADMIN'] }
  ],

  PROCESSING: [
    { to: 'UNDER_REVIEW', allowedRoles: ['SYSTEM', 'ADMIN'] }
  ],

  UNDER_REVIEW: [
    { to: 'DRAFT_SENT', allowedRoles: ['ADMIN'] },
    { to: 'PROFORMAT_SENT', allowedRoles: ['ADMIN'] },
    { to: 'REJECTED', allowedRoles: ['ADMIN'] }
  ],

  DRAFT_SENT: [
    { to: 'PAYMENT_PROOF_UPLOADED', allowedRoles: ['CLIENT'] },
    { to: 'CANCELLED', allowedRoles: ['CLIENT'] }
  ],

  PROFORMAT_SENT: [
    { to: 'PAYMENT_PROOF_UPLOADED', allowedRoles: ['CLIENT'] },
    { to: 'CANCELLED', allowedRoles: ['CLIENT'] },
    // Admin can mark the request as awaiting payment after issuing the proforma
    { to: 'AWAITING_PAYMENT', allowedRoles: ['ADMIN'] }
  ],

  AWAITING_PAYMENT: [
    { to: 'PAYMENT_PROOF_UPLOADED', allowedRoles: ['CLIENT'] },
    { to: 'CANCELLED', allowedRoles: ['CLIENT'] }
  ],

  PAYMENT_PROOF_UPLOADED: [
    { to: 'PAYMENT_CONFIRMED', allowedRoles: ['ADMIN'] },
    { to: 'REJECTED', allowedRoles: ['ADMIN'] }
  ],

  PAYMENT_CONFIRMED: [
    // Allow reverting to PAYMENT_PROOF_UPLOADED in exceptional cases (client
    // selected a payment mode after confirmation and workflow requires proof).
    { to: 'PAYMENT_PROOF_UPLOADED', allowedRoles: ['CLIENT', 'ADMIN'] },
    { to: 'VALIDATED', allowedRoles: ['ADMIN'] }
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
export const canTransition = (
  from: RequestStatus,
  to: RequestStatus,
  role: ActorRole
): boolean => {
  const rules = STATE_TRANSITIONS[from];

  if (!rules) return false;

  return rules.some(
    (rule) => rule.to === to && rule.allowedRoles.includes(role)
  );
};

// ===============================
// VALIDATION WITH ERROR
// ===============================
export const assertTransitionAllowed = (
  from: RequestStatus,
  to: RequestStatus,
  role: ActorRole
): void => {
  if (!canTransition(from, to, role)) {
    throw new Error(
      `Transition not allowed: ${from} → ${to} (role: ${role})`
    );
  }
};

// ===============================
// HELPER: FINAL STATES
// ===============================
export const isFinalState = (status: RequestStatus): boolean => {
  return ['ISSUED', 'REJECTED', 'CANCELLED'].includes(status);
};
