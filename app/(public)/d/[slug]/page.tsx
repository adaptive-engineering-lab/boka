import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { OwnerBar } from '@/components/public/OwnerBar';
import { isOwnerViewing } from '@/lib/auth/owner-view';
import { getPublishedDesignBySlug, incrementDesignView } from '@/lib/data/public-designs';

/**
 * T055 — design detail (FR-031), T059 — view counting (FR-034).
 *
 * ============================================================================
 * The not-found behaviour here is a constitutional requirement, not error handling.
 *
 * A draft slug, a deleted slug, and a slug that never existed MUST produce byte-identical
 * 404s (FR-023). Any observable difference — status, body, metadata, timing — lets a visitor
 * infer that unpublished work exists, and "does that URL 404 differently?" is a two-minute
 * probe.
 *
 * **No branching implements this.** `getPublishedDesignBySlug` reads `public_designs`, which
 * is gated on `published`, so all three cases return `null` from the same code path and this
 * page calls `notFound()` once. `not-found.tsx` renders the same static markup regardless of
 * what was requested — it never sees the slug. The sameness is structural, which is the only
 * way it stays true after someone edits this file in a year.
 *
 * Two things must therefore never be added here: a message that mentions the requested
 * slug, and any lookup that can tell a draft from a nonexistent design.
 * ============================================================================
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const design = await getPublishedDesignBySlug(slug);

  // Identical metadata for draft, deleted and nonexistent — they all arrive here as null.
  if (!design) return { title: 'Not found', robots: { index: false, follow: false } };

  return {
    title: design.title,
    // `public_description` ONLY. `notes` is not on the object this page holds — it is not
    // in the view — but metadata is precisely where private text reaches the internet
    // without ever appearing on screen, so the restriction is worth naming here.
    description: design.publicDescription?.slice(0, 160) ?? undefined,
  };
}

export default async function DesignDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const design = await getPublishedDesignBySlug(slug);
  if (!design) notFound();

  // FR-034. After the publication check, so a probe for a draft slug cannot move a counter,
  // and awaited rather than fired-and-forgotten — it swallows its own errors, so it cannot
  // fail the render, and leaving a floating promise in a serverless function is how writes
  // get dropped when the invocation freezes.
  await incrementDesignView(slug);

  /*
   * FR-002a, and the ordering is deliberate: this runs only AFTER the design has been found.
   *
   * A 404 must be byte-identical for a draft, a deleted design and a slug that never existed
   * (FR-023, T060). Resolving the viewer before the gate would make the not-found response
   * depend on who asked — the designer's 404 would differ from a visitor's, and the sameness
   * T060 asserts would hold only for anonymous requests. Nothing about the viewer may reach a
   * response that is refusing to say whether something exists.
   */
  const ownerViewing = await isOwnerViewing();

  const meta = [design.categoryName, design.collection].filter(Boolean).join(' · ');

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      {ownerViewing ? <OwnerBar /> : null}

      <nav className="mb-6">
        <Link href="/" className="text-sm text-gray-600 hover:underline">
          ← All designs
        </Link>
      </nav>

      <header className="mb-8">
        <h1 className="text-2xl font-medium sm:text-3xl">{design.title}</h1>
        {meta ? <p className="mt-1 text-sm text-gray-600">{meta}</p> : null}
      </header>

      {/* Photos in `position` order — front, back, detail is meaningful sequencing the
          designer chose, not an arbitrary set. */}
      <div className="space-y-4">
        {design.photos.map((photo, index) => (
          <Image
            key={photo.id}
            src={photo.src}
            alt={photo.alt}
            width={photo.width}
            height={photo.height}
            // The first photo is the LCP element on this page (SC-004).
            priority={index === 0}
            sizes="(min-width: 768px) 768px, 100vw"
            placeholder="blur"
            blurDataURL={photo.blurDataURL}
            // Unoptimised for the same reason as the grid: an optimiser cache in front of
            // `/img` can outlive the publication check, and costs nothing to skip now that
            // the route resizes to the requested width itself. See
            // components/public/PublicGrid.tsx for the full argument.
            unoptimized
            className="h-auto w-full rounded bg-gray-100"
          />
        ))}
      </div>

      {design.publicDescription ? (
        <div className="mt-8 max-w-prose whitespace-pre-line text-gray-800">
          {design.publicDescription}
        </div>
      ) : null}

      {/*
        Nothing else belongs on this page in v1.
        No price, no cart, no "add to favourites", no comments (FR-032, Principle I). The
        inquiry form is T066, in the US3 increment — until then the only action a visitor has
        is going back to the grid, and that is deliberate rather than unfinished.
      */}
    </main>
  );
}
