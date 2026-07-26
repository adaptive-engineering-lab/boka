import { redirect } from 'next/navigation';

import { createClient } from '@/lib/supabase/server';

/**
 * T023 — designer sign-in (FR-001).
 *
 * There is no "create account" link, and there never should be. Public signup is
 * disabled (config.toml) because Principle I's premise is that no visitor role exists to
 * authenticate — the single owner is provisioned out of band. A signup form here would
 * hand anyone an authenticated session.
 */
export const metadata = {
  title: 'Sign in — Boka',
  robots: { index: false, follow: false },
};

async function signIn(formData: FormData) {
  'use server';

  const email = String(formData.get('email') ?? '');
  const password = String(formData.get('password') ?? '');
  const next = String(formData.get('next') ?? '/studio');

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Deliberately generic: distinguishing "no such account" from "wrong password"
    // confirms which email addresses exist.
    redirect(`/auth/sign-in?error=1&next=${encodeURIComponent(next)}`);
  }

  redirect(next.startsWith('/') ? next : '/studio');
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const { error, next } = await searchParams;

  // Already signed in? Skip the form.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect(next ?? '/studio');

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-medium">Sign in</h1>
      <p className="mt-2 text-sm text-gray-600">Studio access for the designer.</p>

      <form action={signIn} className="mt-8 space-y-4">
        <input type="hidden" name="next" value={next ?? '/studio'} />

        {error ? (
          // role="alert" so the failure is announced rather than silently appearing
          // above the fields (FR-012c).
          <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
            That email and password combination did not work.
          </p>
        ) : null}

        <div>
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded bg-gray-900 px-4 py-2 text-white hover:bg-gray-800"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
