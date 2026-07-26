import Link from 'next/link';

import { SessionGuard } from '@/components/studio/SessionGuard';

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
          </ul>
        </nav>
      </header>

      {/* Renders nothing until the session is actually close to expiring (T046). */}
      <SessionGuard />

      {children}
    </div>
  );
}
