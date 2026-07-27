import { DesignerHeader } from '@/components/public/DesignerHeader';
import { ComingSoon, NoMatches } from '@/components/public/EmptyStorefront';
import { OwnerBar } from '@/components/public/OwnerBar';
import { PublicFilterBar } from '@/components/public/PublicFilterBar';
import { PublicGrid } from '@/components/public/PublicGrid';
import { isOwnerViewing } from '@/lib/auth/owner-view';
import {
  getPublicDesignerProfile,
  getPublicFilterOptions,
  listPublishedDesigns,
  type PublicSort,
} from '@/lib/data/public-designs';

/**
 * T052 — the storefront (FR-027, FR-028, FR-030, FR-033).
 *
 * The grid *is* the homepage. There is no landing page in front of it, no splash, and
 * nothing to dismiss — FR-027, and downstream of Principle I: the product's value is that it
 * behaves like walking past a shop window, and a window you have to click through is a door.
 *
 * ============================================================================
 * Every read on this page goes through `lib/data/public-designs.ts`, which touches only the
 * four published-gated views. That is the constitution's structural rule and the reason
 * Principle II is reviewable by reading one file instead of auditing every query: if this
 * page's import list contains nothing else, no draft and no private field can reach it.
 *
 * Do not import `designer-designs.ts` here, and do not reach for a Supabase client
 * directly. If a field is missing, widen a view in a migration.
 * ============================================================================
 */

// No session, no cookie, no authentication — ever (Principle I, FR-002). The middleware
// matcher deliberately excludes this route.
export const dynamic = 'force-dynamic';

export async function generateMetadata() {
  const profile = await getPublicDesignerProfile();

  return {
    title: profile?.name ?? 'Boka',
    // The bio, never `notes`. This is metadata — a place private text reaches the public
    // internet without ever being visible on the page, which is why T061 asserts against
    // the raw response body rather than the rendered DOM.
    description: profile?.bio?.slice(0, 160) ?? 'A fashion-design portfolio.',
  };
}

function parseSort(value: string | undefined): PublicSort {
  // An unknown value falls back to the default rather than erroring (contract: "Unknown
  // values yield the empty-result state or the default sort, never an error").
  return value === 'oldest' || value === 'title' ? value : 'newest';
}

export default async function StorefrontPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; collection?: string; sort?: string }>;
}) {
  const { category, collection, sort } = await searchParams;

  const [profile, designs, filterOptions, ownerViewing] = await Promise.all([
    getPublicDesignerProfile(),
    listPublishedDesigns({ category, collection, sort: parseSort(sort) }),
    getPublicFilterOptions(),
    // FR-002a. Returns false without any network call for a request carrying no auth cookie,
    // which is every visitor — see lib/auth/owner-view.ts. It decides one navigation
    // affordance and never what data is read.
    isOwnerViewing(),
  ]);

  const filtered = Boolean(category || collection);
  // Nothing published at all, as distinct from nothing matching. `getPublicFilterOptions`
  // is derived from published designs, so an empty options set means an empty storefront.
  const storefrontEmpty =
    designs.length === 0 && filterOptions.categories.length === 0 && filterOptions.collections.length === 0;

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      {ownerViewing ? <OwnerBar /> : null}

      {profile ? (
        <DesignerHeader
          name={profile.name}
          bio={profile.bio}
          hasPhoto={Boolean(profile.profilePhotoPath)}
        />
      ) : null}

      {/* Hidden when the storefront is empty: filters over nothing are a dead end. */}
      {!storefrontEmpty ? (
        <PublicFilterBar options={filterOptions} active={{ category, collection, sort }} />
      ) : null}

      {designs.length === 0 ? (
        filtered && !storefrontEmpty ? (
          <NoMatches />
        ) : (
          <ComingSoon />
        )
      ) : (
        <PublicGrid designs={designs} />
      )}
    </main>
  );
}
