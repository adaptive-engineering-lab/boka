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
            (FR-012c, SC-014). */}
        <a
          href="#main"
          className="sr-only-focusable absolute left-4 top-4 z-50 rounded bg-gray-900 px-4 py-2 text-white"
        >
          Skip to content
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
