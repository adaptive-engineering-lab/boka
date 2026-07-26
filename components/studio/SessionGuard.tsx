'use client';

import { useEffect, useState } from 'react';

import { createClient } from '@/lib/supabase/client';

/**
 * T046 — warn on session expiry instead of discarding unsaved work.
 *
 * The edge case this addresses: the designer opens the new-design form, gets interrupted,
 * comes back an hour later, finishes typing, and submits into an expired session. The
 * naive handling — middleware redirects her to sign-in — throws away everything she just
 * wrote, and she has no idea why. The upload flow is the one place in this product where
 * that costs real work: photos already selected, notes already typed.
 *
 * So this warns *before* the redirect can happen and, critically, **never navigates by
 * itself**. It opens sign-in in a new tab, so the form and its contents stay exactly where
 * they are; when she comes back and the session refreshes, the banner clears on its own.
 *
 * This is a convenience, not a security control. Authorization is RLS (FR-003) — an
 * expired session cannot write anything regardless of what this component renders.
 */

/** Warn this far ahead of expiry, so there is time to act rather than a notification of
 *  something that has already happened. */
const WARN_BEFORE_MS = 2 * 60 * 1000;

type State = 'ok' | 'expiring' | 'expired';

export function SessionGuard() {
  const [state, setState] = useState<State>('ok');

  useEffect(() => {
    const supabase = createClient();
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function check() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        setState('expired');
        return;
      }

      const expiresAt = (session.expires_at ?? 0) * 1000;
      const msLeft = expiresAt - Date.now();

      if (msLeft <= 0) {
        setState('expired');
        return;
      }

      setState(msLeft <= WARN_BEFORE_MS ? 'expiring' : 'ok');

      // Wake up exactly when the warning becomes due rather than polling. Capped so a
      // long-lived token still re-checks periodically — the tab may have been suspended,
      // and a timer that slept through the expiry is worse than no timer.
      const nextCheck = Math.min(Math.max(msLeft - WARN_BEFORE_MS, 5_000), 5 * 60 * 1000);
      timer = setTimeout(check, nextCheck);
    }

    void check();

    // Supabase refreshes tokens in the background; when it succeeds, the warning should
    // disappear without the designer doing anything.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') setState('expired');
      else void check();
    });

    return () => {
      if (timer) clearTimeout(timer);
      subscription.unsubscribe();
    };
  }, []);

  if (state === 'ok') return null;

  const expired = state === 'expired';

  return (
    <div
      role="alert"
      className={`mb-4 rounded border px-4 py-3 text-sm ${
        expired ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'
      }`}
    >
      <p className="font-medium">
        {expired ? 'You have been signed out.' : 'Your session is about to expire.'}
      </p>
      <p className="mt-1">
        {expired
          ? 'Anything you have typed is still here. Sign in again in a new tab, then save.'
          : 'Sign in again in a new tab before saving, so nothing you have typed is lost.'}
      </p>
      <a
        href="/auth/sign-in"
        target="_blank"
        rel="noopener"
        className="mt-2 inline-block font-medium underline"
      >
        Sign in (opens a new tab)
      </a>
    </div>
  );
}
