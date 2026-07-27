import Link from 'next/link';
import { redirect } from 'next/navigation';

import { SessionGuard } from '@/components/studio/SessionGuard';
import { createClient } from '@/lib/supabase/server';

/**
 * Shared chrome for the designer surface.
 *
 * `noindex` on every studio page. Access is already gated by middleware and RLS, so this
 * is not a security measure — it stops a crawler that follows a link from putting the
 * sign-in wall in search results, which is confusing rather than dangerous.
 *
 * The nav is a plain list of links, not a menu widget. At mobile width it wraps; at
 * desktop it sits on one row. Principle V: a portfolio with four destinations does not
 * need a navigation component.
 */
export const metadata = {
  robots: { index: false, follow: false },
};

const LINKS = [
  { href: '/studio', label: 'Designs' },
  { href: '/studio/categories', label: 'Categories' },
  { href: '/studio/settings', label: 'Settings' },
];

/**
 * T083 — end the session (FR-001a).
 *
 * `signOut()` with its default global scope **revokes the refresh token at the auth server**,
 * which is the part that matters. Clearing cookies alone would leave a live refresh token in
 * the wild; anyone who had captured it could mint new access tokens indefinitely, and the
 * designer would have every reason to believe she had signed out. FR-001a asks for the
 * session to be invalidated server-side, not for the interface to be tidied.
 *
 * Defined in the layout so the control exists on every studio page — the requirement is
 * "reachable from every authenticated page", and a sign-out you have to navigate to in order
 * to reach is not much use on a borrowed machine.
 */
async function signOut() {
  'use server';

  const supabase = await createClient();
  await supabase.auth.signOut();

  // Back to the storefront rather than to sign-in. Landing on a login form implies she is
  // meant to sign back in; landing on the public site is simply where a signed-out person is.
  redirect('/');
}

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 pb-4">
        <p className="text-lg font-medium">
          <Link href="/studio">Studio</Link>
        </p>
        <nav aria-label="Studio">
          <ul className="flex flex-wrap gap-4 text-sm">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/" className="hover:underline">
                View storefront
              </Link>
            </li>
            <li>
              {/* A form, not a link: signing out changes server state, so it must not be
                  something a prefetcher or a crawler can trigger by following a URL. */}
              <form action={signOut}>
                <button type="submit" className="hover:underline">
                  Sign out
                </button>
              </form>
            </li>
          </ul>
        </nav>
      </header>

      {/* Renders nothing until the session is actually close to expiring (T046). */}
      <SessionGuard />

      {children}
    </div>
  );
}
