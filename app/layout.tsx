import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: 'Boka',
  description: 'A fashion-design portfolio.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">
        {/* Skip link: first focusable element on every page, so a keyboard user can
            bypass the header rather than tabbing through it on each navigation
            (FR-012c, SC-014).

            It targets `#main`, which is the page's own `<main>` element — *not* a wrapper
            here. Two things about that are easy to get wrong, and both were wrong until
            T076 measured it:

            1. A wrapper in this layout necessarily encloses the studio header, so skipping
               to it lands *before* the nav and bypasses nothing.
            2. The target must carry `tabIndex={-1}`. A browser scrolls to a non-focusable
               anchor target but leaves focus on `<body>`, so the next Tab resumes at the
               top of the document — back into the nav the user just asked to skip. The
               link looks implemented and does nothing, which is worse than absent: it
               costs a keyboard user a Tab and a guess on every page.

            `tests/e2e/keyboard.spec.ts` (T078) asserts focus actually moves, because the
            broken version passes every static check including axe. */}
        <a
          href="#main"
          className="sr-only-focusable absolute left-4 top-4 z-50 rounded bg-gray-900 px-4 py-2 text-white"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
