import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { AddPhotosForm } from '@/components/studio/AddPhotosForm';
import { AltTextField } from '@/components/studio/AltTextField';
import { DeleteDesignDialog } from '@/components/studio/DeleteDesignDialog';
import { DesignGridTile } from '@/components/DesignGrid';
import { PublishToggle } from '@/components/studio/PublishToggle';
import {
  deleteOwnDesign,
  getOwnDesign,
  listOwnCategories,
  removeOwnPhoto,
  setPublished,
  updateOwnDesign,
  updatePhotoAltText,
} from '@/lib/data/designer-designs';
import { resolveAltText } from '@/lib/images/alt-text';

/**
 * T038 — edit a design (FR-019, FR-023b).
 *
 * The publish toggle is deliberately absent: that is T051, in the storefront increment.
 * Until then a design created here stays a draft, which is the correct default and the
 * safe one (FR-021).
 *
 * **The slug is shown but not editable.** Renaming a design must not change its public
 * URL, or every link already shared stops resolving (FR-023b). The database enforces this —
 * the slug trigger fires on INSERT only — but the designer has no way to know that unless
 * the screen tells her, and "why did my link break" is not a question she should ever have
 * to ask.
 */
export const dynamic = 'force-dynamic';

export default async function EditDesignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string; saved?: string; error?: string }>;
}) {
  const { id } = await params;
  const { created, saved, error } = await searchParams;

  const [design, categories] = await Promise.all([getOwnDesign(id), listOwnCategories()]);

  // RLS returns nothing for a design that is not hers, so "not hers" and "does not exist"
  // arrive here identically — which is the right answer for both.
  if (!design) notFound();

  // Captured before the server actions close over it. The slug is what the public routes
  // are keyed on, so every mutation below has to revalidate `/d/{slug}` as well as the
  // studio — otherwise a withdrawn design keeps being served from a cached page.
  const slug = design.slug;

  async function save(formData: FormData) {
    'use server';

    const result = await updateOwnDesign(id, {
      title: String(formData.get('title') ?? ''),
      categoryId: String(formData.get('categoryId') ?? '') || null,
      collection: String(formData.get('collection') ?? '') || null,
      notes: String(formData.get('notes') ?? '') || null,
      publicDescription: String(formData.get('publicDescription') ?? '') || null,
    });

    if (!result.ok) {
      redirect(`/studio/designs/${id}?error=${encodeURIComponent(result.error ?? 'Save failed.')}`);
    }

    // Alt text lives on `photo`, so it is a second write. Collected from the same form so
    // the designer experiences one save, not two.
    const altEntries: Array<{ photoId: string; altText: string }> = [];
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('alt:')) {
        altEntries.push({ photoId: key.slice(4), altText: String(value ?? '') });
      }
    }
    if (altEntries.length > 0) await updatePhotoAltText(id, altEntries);

    revalidatePath('/studio');
    revalidatePath(`/studio/designs/${id}`);
    // An edit can change the title, category, collection or public description, all of
    // which the storefront renders.
    revalidatePath('/');
    revalidatePath(`/d/${slug}`);
    redirect(`/studio/designs/${id}?saved=1`);
  }

  async function removePhoto(formData: FormData) {
    'use server';

    const photoId = String(formData.get('photoId') ?? '');
    const result = await removeOwnPhoto(id, photoId);

    if (!result.ok) {
      redirect(`/studio/designs/${id}?error=${encodeURIComponent(result.error ?? 'Could not remove.')}`);
    }

    revalidatePath(`/studio/designs/${id}`);
    redirect(`/studio/designs/${id}`);
  }

  async function togglePublished(next: boolean) {
    'use server';

    await setPublished(id, next);

    // No storage work in either direction (FR-009a). Image access is gated by `/img`
    // re-checking publication per request, not by where the file lives, so a publish
    // toggle can never leave rows and objects disagreeing about visibility.
    revalidatePath('/studio');
    revalidatePath(`/studio/designs/${id}`);
    revalidatePath('/');
    revalidatePath(`/d/${slug}`);
  }

  async function destroy() {
    'use server';

    // Removes the row, cascades the photo rows, and deletes BOTH storage prefixes —
    // the cascade does not touch object storage (FR-019). Inquiries survive (FR-044).
    await deleteOwnDesign(id);

    revalidatePath('/studio');
    revalidatePath('/');
    revalidatePath(`/d/${slug}`);
    redirect('/studio');
  }

  const totalPhotos = design.photos.length;

  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/studio" className="text-sm text-gray-600 hover:underline">
          ← Back to your designs
        </Link>
        <h1 className="mt-2 text-2xl font-medium">{design.title}</h1>
        <p className="mt-1 text-sm">
          <span
            className={
              design.published
                ? 'rounded bg-green-100 px-1.5 py-0.5 text-xs font-medium text-green-900'
                : 'rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900'
            }
          >
            {design.published ? 'Published' : 'Draft'}
          </span>
        </p>
      </div>

      {created ? (
        <p role="status" className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-900">
          Design saved as a draft. Check the photos and details below.
        </p>
      ) : null}

      {saved ? (
        <p role="status" className="mb-4 rounded bg-green-50 px-3 py-2 text-sm text-green-900">
          Changes saved.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mb-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mb-6">
        <PublishToggle published={design.published} action={togglePublished} />
      </div>

      <p className="mb-6 rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
        <span className="font-medium">Public address:</span>{' '}
        <code className="break-all">/d/{design.slug}</code>
        <br />
        <span className="text-gray-600">
          This never changes, even if you rename the design — so links you have already
          shared keep working.
        </span>
      </p>

      <form action={save} className="space-y-6">
        <div>
          <label htmlFor="title" className="block text-sm font-medium">
            Title
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={120}
            defaultValue={design.title}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="categoryId" className="block text-sm font-medium">
              Category
            </label>
            <select
              id="categoryId"
              name="categoryId"
              defaultValue={design.categoryId ?? ''}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            >
              <option value="">No category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="collection" className="block text-sm font-medium">
              Collection <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id="collection"
              name="collection"
              type="text"
              maxLength={80}
              defaultValue={design.collection ?? ''}
              className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
            />
          </div>
        </div>

        {/* --- The private/public boundary, worded identically to the create form. If
                these two screens ever disagree, this is where a measurement gets
                published. --- */}

        <div className="rounded border-l-4 border-gray-400 bg-gray-50 p-3">
          <label htmlFor="notes" className="block text-sm font-medium">
            Private notes — only you see this
          </label>
          <p id="notes-help" className="mt-1 text-xs text-gray-600">
            Fabric, measurements, suppliers. Never shown to visitors and never included in
            any public page.
          </p>
          <textarea
            id="notes"
            name="notes"
            rows={4}
            aria-describedby="notes-help"
            defaultValue={design.notes ?? ''}
            className="mt-2 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div className="rounded border-l-4 border-green-600 bg-green-50/50 p-3">
          <label htmlFor="publicDescription" className="block text-sm font-medium">
            Public description — visitors see this
          </label>
          <p id="public-description-help" className="mt-1 text-xs text-gray-600">
            Shown on the design&rsquo;s page once you publish it.
          </p>
          <textarea
            id="publicDescription"
            name="publicDescription"
            rows={4}
            maxLength={2000}
            aria-describedby="public-description-help"
            defaultValue={design.publicDescription ?? ''}
            className="mt-2 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <section aria-labelledby="photos-heading" className="space-y-4">
          <h2 id="photos-heading" className="text-lg font-medium">
            Photos
          </h2>

          <ol className="space-y-4">
            {design.photos.map((photo, index) => (
              <li key={photo.id} className="flex gap-3 rounded border border-gray-200 p-3">
                <div className="w-24 flex-none">
                  <DesignGridTile
                    photo={{
                      src: `/studio/img/${photo.id}/320`,
                      blurDataURL: photo.blurPlaceholder,
                      width: photo.width,
                      height: photo.height,
                      alt: resolveAltText({
                        altText: photo.altText,
                        designTitle: design.title,
                        position: index,
                        totalPhotos,
                      }),
                    }}
                    sizes="96px"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <AltTextField
                    id={`alt-${photo.id}`}
                    name={`alt:${photo.id}`}
                    defaultValue={photo.altText}
                    designTitle={design.title}
                    position={index}
                    totalPhotos={totalPhotos}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>

        <div className="flex flex-wrap gap-3">
          <button
            type="submit"
            className="rounded bg-gray-900 px-5 py-2.5 text-white hover:bg-gray-800"
          >
            Save changes
          </button>
        </div>
      </form>

      {/* Photo removal sits outside the main form: nesting forms is invalid HTML, and a
          removal must not be bundled into "save changes" — it is not undoable. */}
      {totalPhotos > 1 ? (
        <section aria-labelledby="remove-heading" className="mt-6">
          <h2 id="remove-heading" className="text-sm font-medium">
            Remove a photo
          </h2>
          <p className="mt-1 text-xs text-gray-600">
            Removing deletes the file immediately. A design always keeps at least one photo.
          </p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {design.photos.map((photo, index) => (
              <li key={photo.id}>
                <form action={removePhoto}>
                  <input type="hidden" name="photoId" value={photo.id} />
                  <button
                    type="submit"
                    className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
                  >
                    Remove photo {index + 1}
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="add-photos-heading" className="mt-8 border-t border-gray-200 pt-6">
        <h2 id="add-photos-heading" className="text-sm font-medium">
          Add more photos
        </h2>
        <div className="mt-3">
          <AddPhotosForm designId={design.id} designTitle={design.title} />
        </div>
      </section>

      <section className="mt-8 border-t border-gray-200 pt-6">
        <DeleteDesignDialog designTitle={design.title} action={destroy} />
      </section>
    </main>
  );
}
