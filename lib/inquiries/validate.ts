/**
 * T067 — inquiry validation (FR-037).
 *
 * Isomorphic on purpose: no `server-only`, no database, no secrets. The form runs it to give
 * field-level errors as the visitor types, and the submission route runs it again because the
 * browser's copy is a courtesy rather than a control (FR-041c).
 *
 * Errors are returned per field rather than as one message. A visitor who mistypes their email
 * should be told which box is wrong; a single "invalid submission" banner makes them re-read
 * three fields to find it, and this form is the only action the site offers them.
 */

export const MAX_NAME_LENGTH = 120;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_EMAIL_LENGTH = 320;

export interface InquiryInput {
  visitorName: string;
  visitorEmail: string;
  message?: string | null;
}

export interface InquiryFieldErrors {
  visitorName?: string;
  visitorEmail?: string;
  message?: string;
}

export type InquiryValidation =
  | { ok: true; value: { visitorName: string; visitorEmail: string; message: string | null } }
  | { ok: false; errors: InquiryFieldErrors };

/**
 * Deliberately permissive: something before an `@`, something after it, a dot in the domain.
 *
 * The temptation is a stricter pattern, and it is a trap. Every "thorough" email regex rejects
 * addresses that genuinely work — plus-addressing, apostrophes, long TLDs, unusual but legal
 * local parts — and the cost of a false rejection here is total: the visitor cannot reach the
 * designer at all, and neither of them ever learns why. The real test of an address is whether
 * mail arrives, which no regex can answer. This one catches "forgot the @" and typos of that
 * order, which is what FR-037 is actually asking for.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateInquiry(input: InquiryInput): InquiryValidation {
  const errors: InquiryFieldErrors = {};

  const visitorName = input.visitorName.trim();
  const visitorEmail = input.visitorEmail.trim();
  const message = (input.message ?? '').trim();

  if (!visitorName) {
    errors.visitorName = 'Please add your name so she knows who is writing.';
  } else if (visitorName.length > MAX_NAME_LENGTH) {
    errors.visitorName = `Names are limited to ${MAX_NAME_LENGTH} characters.`;
  }

  if (!visitorEmail) {
    errors.visitorEmail = 'Please add an email address so she can reply.';
  } else if (visitorEmail.length > MAX_EMAIL_LENGTH) {
    errors.visitorEmail = `Email addresses are limited to ${MAX_EMAIL_LENGTH} characters.`;
  } else if (!EMAIL_PATTERN.test(visitorEmail)) {
    errors.visitorEmail = 'That does not look like an email address — check for a typo.';
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    errors.message = `Messages are limited to ${MAX_MESSAGE_LENGTH} characters.`;
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  // The message is optional (FR-037); empty becomes null rather than an empty string, so the
  // database holds "no message" rather than "a message that happens to be blank".
  return { ok: true, value: { visitorName, visitorEmail, message: message || null } };
}
