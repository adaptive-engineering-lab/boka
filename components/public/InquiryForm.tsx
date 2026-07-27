'use client';

import { useRef, useState } from 'react';

import {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  validateInquiry,
  type InquiryFieldErrors,
} from '@/lib/inquiries/validate';

/**
 * T066 — the inquiry form (FR-036, FR-037, FR-041a, FR-041b).
 *
 * ============================================================================
 * The only thing a visitor may submit anywhere on this site (Principle I).
 *
 * Three things it deliberately does not do:
 *
 *   - **No account, no session, no cookie** (FR-004). Submitting leaves the visitor exactly as
 *     anonymous as they arrived.
 *   - **No visible challenge and no third-party widget** (FR-041b). No captcha, no "prove you
 *     are human". The abuse defences are a hidden honeypot and a server-side rate limit, both
 *     invisible to a person filling this in honestly.
 *   - **No confirmation that anyone else has written.** FR-046 keeps inquiries private, which
 *     includes not revealing their existence.
 *
 * The honeypot is `sr-only` rather than `display: none`. A bot that parses styles skips hidden
 * fields, and this one has to look fillable to be worth anything. `tabIndex={-1}` and
 * `autoComplete="off"` keep it away from keyboard users and password managers, and the label
 * tells a screen-reader user to leave it alone — the field is invisible, not unannounced.
 * ============================================================================
 */

interface Props {
  /** The design being asked about. The slug is the route, not a hidden field — a client-supplied
   *  design id would let a submission be pointed at anything. */
  slug: string;
  designTitle: string;
}

type Status = 'idle' | 'sending' | 'sent';

export function InquiryForm({ slug, designTitle }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errors, setErrors] = useState<InquiryFieldErrors>({});
  const [failure, setFailure] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form || status === 'sending') return;

    setFailure(null);

    const data = new FormData(form);

    // Validated here for immediate field-level errors, and again on the server because this
    // copy is a courtesy rather than a control (FR-041c).
    const local = validateInquiry({
      visitorName: String(data.get('visitorName') ?? ''),
      visitorEmail: String(data.get('visitorEmail') ?? ''),
      message: String(data.get('message') ?? ''),
    });
    if (!local.ok) {
      setErrors(local.errors);
      return;
    }
    setErrors({});
    setStatus('sending');

    try {
      const response = await fetch(`/d/${slug}/inquire`, { method: 'POST', body: data });
      const payload = await response.json().catch(() => ({}));

      if (response.ok && payload.ok) {
        setStatus('sent');
        form.reset();
        return;
      }

      setStatus('idle');
      if (payload.errors) setErrors(payload.errors);
      else setFailure(payload.error ?? 'Your message could not be sent. Please try again.');
    } catch {
      setStatus('idle');
      setFailure('Your message could not be sent — check your connection and try again.');
    }
  }

  if (status === 'sent') {
    return (
      <div
        role="status"
        className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-900"
      >
        <p className="font-medium">Your message has been sent.</p>
        <p className="mt-1">
          She will reply to the address you gave. There is nothing else you need to do.
        </p>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">
      <h2 className="text-lg font-medium">Ask about this piece</h2>
      <p className="text-sm text-gray-600">
        A message goes straight to the designer. No account needed.
      </p>

      {failure ? (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {failure}
        </p>
      ) : null}

      <div>
        <label htmlFor="visitorName" className="block text-sm font-medium">
          Your name
        </label>
        <input
          id="visitorName"
          name="visitorName"
          type="text"
          required
          maxLength={MAX_NAME_LENGTH}
          autoComplete="name"
          aria-invalid={Boolean(errors.visitorName)}
          aria-describedby={errors.visitorName ? 'visitorName-error' : undefined}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
        {errors.visitorName ? (
          // Tied to the input by `aria-describedby`, so a screen reader announces the reason
          // rather than just "invalid" (FR-012c).
          <p id="visitorName-error" role="alert" className="mt-1 text-sm text-red-700">
            {errors.visitorName}
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="visitorEmail" className="block text-sm font-medium">
          Your email
        </label>
        <input
          id="visitorEmail"
          name="visitorEmail"
          type="email"
          required
          autoComplete="email"
          aria-invalid={Boolean(errors.visitorEmail)}
          aria-describedby={errors.visitorEmail ? 'visitorEmail-error' : 'visitorEmail-help'}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
        {errors.visitorEmail ? (
          <p id="visitorEmail-error" role="alert" className="mt-1 text-sm text-red-700">
            {errors.visitorEmail}
          </p>
        ) : (
          <p id="visitorEmail-help" className="mt-1 text-xs text-gray-500">
            Used only to reply to you.
          </p>
        )}
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium">
          Message <span className="font-normal text-gray-500">(optional)</span>
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          maxLength={MAX_MESSAGE_LENGTH}
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? 'message-error' : undefined}
          defaultValue={`I'd like to ask about ${designTitle}.`}
          className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
        />
        {errors.message ? (
          <p id="message-error" role="alert" className="mt-1 text-sm text-red-700">
            {errors.message}
          </p>
        ) : null}
      </div>

      {/* The honeypot (FR-041a). Never remove the label — invisible must not mean unannounced. */}
      <div className="sr-only" aria-hidden="true">
        <label htmlFor="_website">Leave this field empty</label>
        <input id="_website" name="_website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <button
        type="submit"
        disabled={status === 'sending'}
        className="rounded bg-gray-900 px-5 py-2.5 text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending…' : 'Send message'}
      </button>
    </form>
  );
}
