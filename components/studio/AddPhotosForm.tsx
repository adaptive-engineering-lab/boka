'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';

import {
  PhotoUploader,
  collectAltText,
  type SelectedPhoto,
} from '@/components/studio/PhotoUploader';

/**
 * Adds photos to an existing design.
 *
 * Shares `PhotoUploader` with the create form so the selection, rejection and progress
 * behaviour is identical in both places — the designer should not have to learn the
 * uploader twice, and a divergence here is how one of the two surfaces quietly stops
 * enforcing the size limit.
 *
 * Unlike creation there is no idempotency key: an interrupted add leaves the design intact
 * and re-adding is a normal, meaningful action rather than a duplicate.
 */
export function AddPhotosForm({
  designId,
  designTitle,
}: {
  designId: string;
  designTitle: string;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);

  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejections, setRejections] = useState<Array<{ filename: string; reason: string }>>([]);

  const busy = progress !== null;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = formRef.current;
    if (!form || busy || photos.length === 0) return;

    setError(null);
    setRejections([]);

    const withAltText = collectAltText(form, photos);
    const body = new FormData();
    for (const photo of withAltText) {
      body.append('photo', photo.file, photo.file.name);
      body.append('photoAlt', photo.altText);
    }

    const request = new XMLHttpRequest();
    request.open('POST', `/studio/designs/${designId}/photos`);

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) setProgress(event.loaded / event.total);
    });

    request.addEventListener('load', () => {
      let payload: { ok?: boolean; error?: string; rejected?: Array<{ filename: string; reason: string }> } = {};
      try {
        payload = JSON.parse(request.responseText);
      } catch {
        /* falls through to the generic message */
      }

      setProgress(null);

      if (request.status >= 200 && request.status < 300 && payload.ok) {
        for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
        setPhotos([]);
        setRejections(payload.rejected ?? []);
        router.refresh();
        return;
      }

      setError(payload.error ?? 'The photos could not be added.');
      setRejections(payload.rejected ?? []);
    });

    request.addEventListener('error', () => {
      setProgress(null);
      setError('The upload did not reach the server. Try again.');
    });

    setProgress(0);
    request.send(body);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
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

      <PhotoUploader
        photos={photos}
        onChange={setPhotos}
        designTitle={designTitle}
        disabled={busy}
        progress={progress}
      />

      <button
        type="submit"
        disabled={busy || photos.length === 0}
        className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {busy ? 'Uploading…' : 'Add photos'}
      </button>
    </form>
  );
}
