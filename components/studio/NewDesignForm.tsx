'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  PhotoUploader,
  collectAltText,
  type SelectedPhoto,
} from '@/components/studio/PhotoUploader';

/**
 * T034 — the new-design form (FR-013, FR-013a, FR-021).
 *
 * ============================================================================
 * The notes/description split is the most consequential thing on this screen.
 *
 * FR-025 gives the designer no per-design override — `notes` is private always,
 * `public_description` is public always. That means this form is the *only* place the
 * distinction can be communicated, and a designer who types her measurements into the
 * wrong box has published them. The labels say which is which in words, not in a tooltip,
 * and the private field is visually marked.
 * ============================================================================
 *
 * Submission uses `XMLHttpRequest` rather than a server action so the upload has real
 * progress (FR-008). `designId` is minted once when the form mounts and re-sent on every
 * retry, which is what makes a retry idempotent: a submission whose response was lost
 * lands on a primary-key conflict server-side and returns the design that already exists,
 * rather than creating a second one (FR-013a).
 */

interface Rejection {
  filename: string;
  reason: string;
}

export function NewDesignForm({ categories }: { categories: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  // Minted once per form instance. Not regenerated on a failed attempt — that is the
  // point: the retry must carry the same id.
  const [designId] = useState(() => crypto.randomUUID());

  const [title, setTitle] = useState('');
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<Rejection[]>([]);

  const busy = progress !== null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form || busy) return;

    setError(null);
    setRejections([]);

    if (photos.length === 0) {
      // FR-013a, stated before the upload rather than after it: a design is never created
      // without a photo, so there is no point transferring anything.
      setError('Add at least one photo. A design is not created without one.');
      return;
    }

    const withAltText = collectAltText(form, photos);

    const body = new FormData();
    body.append('designId', designId);
    body.append('title', title);
    body.append('categoryId', (form.elements.namedItem('categoryId') as HTMLSelectElement).value);
    body.append('collection', (form.elements.namedItem('collection') as HTMLInputElement).value);
    body.append('notes', (form.elements.namedItem('notes') as HTMLTextAreaElement).value);
    body.append(
      'publicDescription',
      (form.elements.namedItem('publicDescription') as HTMLTextAreaElement).value,
    );

    // One `photoAlt` per `photo`, appended together so the server can pair them by index.
    for (const photo of withAltText) {
      body.append('photo', photo.file, photo.file.name);
      body.append('photoAlt', photo.altText);
    }

    const request = new XMLHttpRequest();
    request.open('POST', '/studio/designs');

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) setProgress(event.loaded / event.total);
      else setProgress(0);
    });

    request.addEventListener('load', () => {
      let payload: {
        ok?: boolean;
        id?: string;
        error?: string;
        rejected?: Rejection[];
      } = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        /* falls through to the generic message below */
      }

      if (request.status >= 200 && request.status < 300 && payload.ok && payload.id) {
        // Straight to the edit page: the next thing she wants is to check it and publish.
        router.push(`/studio/designs/${payload.id}?created=1`);
        router.refresh();
        return;
      }

      setProgress(null);
      setError(payload.error ?? 'The design could not be saved. Try again.');
      setRejections(payload.rejected ?? []);
    });

    request.addEventListener('error', () => {
      setProgress(null);
      // The retry is safe and worth saying so — otherwise the reasonable fear is that
      // pressing the button twice creates two designs.
      setError('The upload did not reach the server. Try again — this will not create a duplicate.');
    });

    request.addEventListener('abort', () => {
      setProgress(null);
      setError('The upload was interrupted. Nothing was saved. Try again.');
    });

    setProgress(0);
    request.send(body);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {rejections.length > 0 ? (
        <div role="alert" className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">Some photos were not used:</p>
          <ul className="mt-1 space-y-1">
            {rejections.map((rejection) => (
              <li key={`${rejection.filename}-${rejection.reason}`}>{rejection.reason}</li>
            ))}
          </ul>
        </div>
      ) : null}

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
          value={title}
          onChange={(event) => setTitle(event.target.value)}
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
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
      </div>

      <PhotoUploader
        photos={photos}
        onChange={setPhotos}
        designTitle={title}
        disabled={busy}
        progress={progress}
      />

      {/* --- The private/public boundary. Read the comment at the top of this file. --- */}

      <div className="rounded border-l-4 border-gray-400 bg-gray-50 p-3">
        <label htmlFor="notes" className="block text-sm font-medium">
          Private notes — only you see this
        </label>
        <p id="notes-help" className="mt-1 text-xs text-gray-600">
          Fabric, measurements, suppliers, what you would do differently. Never shown to
          visitors and never included in any public page.
        </p>
        <textarea
          id="notes"
          name="notes"
          rows={4}
          aria-describedby="notes-help"
          className="mt-2 w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div className="rounded border-l-4 border-green-600 bg-green-50/50 p-3">
        <label htmlFor="publicDescription" className="block text-sm font-medium">
          Public description — visitors see this
        </label>
        <p id="public-description-help" className="mt-1 text-xs text-gray-600">
          Shown on the design&rsquo;s page once you publish it. Leave it blank if the photos
          say enough.
        </p>
        <textarea
          id="publicDescription"
          name="publicDescription"
          rows={4}
          maxLength={2000}
          aria-describedby="public-description-help"
          className="mt-2 w-full rounded border border-gray-300 px-3 py-2"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-gray-900 px-5 py-2.5 text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {busy ? 'Saving…' : 'Save design'}
        </button>
        <p className="text-sm text-gray-600">
          Saved as a draft. Nothing appears on the storefront until you publish it.
        </p>
      </div>
    </form>
  );
}
