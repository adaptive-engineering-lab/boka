import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { supabaseConfigOrNull } from '@/lib/supabase/env';

type CookieToSet = { name: string; value: string; options?: CookieOptions };

/**
 * T024 — session gate on the designer surface (FR-001).
 *
 * Two jobs:
 *   1. Refresh the Supabase session cookie so Server Components see a valid session.
 *   2. Redirect unauthenticated requests for /studio to sign-in.
 *
 * What this deliberately does NOT do is guard the public surface. Principle I requires
 * every public route to be reachable with a URL alone — no session, no interstitial —
 * so the matcher below excludes them, and `/img` in particular must stay open to
 * unauthenticated requests (its own publication gate is what protects it).
 *
 * This is also not the authorization boundary. RLS is (FR-003). A middleware redirect
 * is a courtesy to the designer, not a security control — if this file were deleted, no
 * visitor would gain access to a single private row.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const config = supabaseConfigOrNull();
  if (!config) return response;

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser(), not getSession(): it validates the token with the auth server rather
  // than trusting a cookie that could have been tampered with.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && request.nextUrl.pathname.startsWith('/studio')) {
    const signIn = request.nextUrl.clone();
    signIn.pathname = '/auth/sign-in';
    signIn.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(signIn);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on the designer surface and the auth pages only.
     *
     * The public storefront, the /img route, and static assets are intentionally
     * excluded: adding them would put session work in front of every visitor request
     * for no benefit, and a mistake there would become a soft login wall — which
     * Principle I forbids outright.
     */
    '/studio/:path*',
    '/auth/:path*',
  ],
};
