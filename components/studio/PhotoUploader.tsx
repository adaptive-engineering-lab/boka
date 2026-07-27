'use client';

import { useEffect, useId, useState } from 'react';

import { AltTextField } from '@/components/studio/AltTextField';
import { FILE_INPUT_ACCEPT, LIMITS_SENTENCE, validatePhotoFile } from '@/lib/images/validate';

/**
 * T035 — photo selection and upload progress (FR-005, FR-006, FR-008, FR-012).
 *
 * Three requirements shape this, and all three come from the same fact: the designer is
 * doing this one-handed, on a phone, next to the garment.
 *
 * **Camera and library are separate controls** (FR-005). One `<input type="file">` with
 * `capture` opens the camera; the same input without it opens the picker. There is no
 * markup for "offer both in one control" that works reliably across iOS and Android, so
 * two labelled controls is not a compromise — it is the only arrangement where she gets
 * what the label says.
 *
 * **They are `<label>`s, not buttons, and that is load-bearing.** The first version used a
 * styled `<button onClick={() => inputRef.current.click()}>`, which is the common pattern
 * and which silently failed for a real user: this is a client component, so before
 * hydration the handler does not exist yet and the click is swallowed with no feedback at
 * all. On a phone loading a cold page that window is seconds long, and the symptom is
 * "the button does nothing" — reproduced by clicking as soon as the button appears in the
 * DOM.
 *
 * A `<label htmlFor>` opens the picker through the browser's own behaviour. It needs no
 * JavaScript, so it works the instant the HTML lands, and it cannot be broken by a
 * hydration error. It also fixes an accessibility defect the button version had: the
 * visually hidden input stayed in the tab order with **no accessible name**, so a keyboard
 * user hit an anonymous file input and then the button — two stops per control, one of
 * them unannounced. Associating them makes it one properly named stop.
 *
 * **Rejection is per file** (FR-012). A 40 MB video dropped into a batch of six photos
 * removes itself and says why; the other five stay selected. The message names the
 * accepted formats and the size limit, because "unsupported file" is not something a
 * person standing in a studio can act on.
 *
 * **Progress is real** (FR-008), which is why the parent submits with `XMLHttpRequest`
 * rather than a server action: `fetch` gives no upload progress, and a phone pushing 60 MB
 * of HEIC over a slow connection with no feedback is indistinguishable from a hung app.
 */

export interface SelectedPhoto {
  /** Stable key for React and for the FormData field names. */
  key: string;
  file: File;
  altText: string;
  previewUrl: string;
}

export function makeSelectedPhoto(file: File): SelectedPhoto {
  return {
    key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    altText: '',
    previewUrl: URL.createObjectURL(file),
  };
}

export function PhotoUploader({
  photos,
  onChange,
  designTitle,
  disabled = false,
  progress = null,
}: {
  photos: SelectedPhoto[];
  onChange: (next: SelectedPhoto[]) => void;
  /** Feeds the alt-text placeholder so the fallback shown is the real one. */
  designTitle: string;
  disabled?: boolean;
  /** 0–1 while transferring, null when idle. */
  progress?: number | null;
}) {
  const [rejections, setRejections] = useState<string[]>([]);
  const fieldId = useId();

  // Object URLs are a real leak on a page where a dozen 20 MB photos get added and
  // removed. Revoke on unmount; per-photo revocation happens in `remove` below.
  useEffect(() => {
    return () => {
      for (const photo of photos) URL.revokeObjectURL(photo.previewUrl);
    };
    // Intentionally unmount-only: adding `photos` to the dependency list would revoke live
    // previews on every change to the selection.
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;

    const accepted: SelectedPhoto[] = [];
    const refused: string[] = [];

    for (const file of Array.from(fileList)) {
      const result = validatePhotoFile({ name: file.name, size: file.size, type: file.type });
      if (result.ok) accepted.push(makeSelectedPhoto(file));
      else refused.push(result.reason);
    }

    setRejections(refused);
    if (accepted.length > 0) onChange([...photos, ...accepted]);
  }

  function remove(key: string) {
    const target = photos.find((p) => p.key === key);
    if (target) URL.revokeObjectURL(target.previewUrl);
    onChange(photos.filter((p) => p.key !== key));
  }

  // Alt-text inputs are intentionally uncontrolled — see `collectAltText` at the bottom of
  // this file. Keeping them in state would re-render every preview on each keystroke,
  // which is noticeable on a phone with a dozen photos queued.

  const uploading = progress !== null;

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <legend className="text-sm font-medium">Photos</legend>
      <p className="text-xs text-gray-500">{LIMITS_SENTENCE}</p>

      {/*
        Each control is a visually hidden input plus a label styled as a button.

        The input is `sr-only`, not `hidden` or `display:none` — it must stay in the tab
        order and remain focusable, which is what lets a keyboard user reach it and press
        Enter or Space. The `peer` class lets the label render that focus ring, since the
        focus lands on the input the label is standing in for.

        Order matters twice: the input must precede the label for Tailwind's `peer-*`
        variants to apply, and the label must point at the input by id rather than wrapping
        it, so the hidden input is not nested inside its own click target.
      */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="flex-1">
          <input
            id={`${fieldId}-camera`}
            data-testid="photo-camera-input"
            type="file"
            accept="image/*"
            capture="environment"
            className="peer sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <label
            htmlFor={`${fieldId}-camera`}
            className="block cursor-pointer rounded border border-gray-300 px-4 py-3 text-center text-sm font-medium hover:bg-gray-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 peer-disabled:hover:bg-transparent"
          >
            Take a photo
          </label>
        </div>

        <div className="flex-1">
          <input
            id={`${fieldId}-library`}
            data-testid="photo-library-input"
            type="file"
            accept={FILE_INPUT_ACCEPT}
            multiple
            className="peer sr-only"
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <label
            htmlFor={`${fieldId}-library`}
            className="block cursor-pointer rounded border border-gray-300 px-4 py-3 text-center text-sm font-medium hover:bg-gray-50 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gray-900 peer-disabled:cursor-not-allowed peer-disabled:opacity-60 peer-disabled:hover:bg-transparent"
          >
            Choose from library
          </label>
        </div>
      </div>

      {rejections.length > 0 ? (
        // role="alert" so the refusal is announced. A photo silently not appearing in the
        // list is the failure mode this replaces.
        <ul role="alert" className="space-y-1 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {rejections.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {/* aria-live so the count is announced as photos are added, not just visually. */}
      <p aria-live="polite" className="text-sm text-gray-600">
        {photos.length === 0
          ? 'No photos selected yet. A design needs at least one.'
          : `${photos.length} photo${photos.length === 1 ? '' : 's'} ready to upload.`}
      </p>

      {photos.length > 0 ? (
        <ol className="space-y-4">
          {photos.map((photo, index) => (
            <li key={photo.key} className="flex gap-3 rounded border border-gray-200 p-3">
              {/* Plain <img>: this is a local object URL for a file that has not been
                  uploaded yet, so there is nothing for next/image to optimise. */}
              <img
                src={photo.previewUrl}
                alt=""
                className="h-20 w-20 flex-none rounded object-cover"
              />

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium">{photo.file.name}</p>
                  <button
                    type="button"
                    onClick={() => remove(photo.key)}
                    className="flex-none text-sm text-red-700 underline hover:text-red-800"
                  >
                    Remove<span className="sr-only-focusable"> {photo.file.name}</span>
                  </button>
                </div>

                <AltTextField
                  id={`${fieldId}-alt-${photo.key}`}
                  name={`altText:${photo.key}`}
                  defaultValue={photo.altText}
                  designTitle={designTitle}
                  position={index}
                  totalPhotos={photos.length}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : null}

      {uploading ? (
        <div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round((progress ?? 0) * 100)}
            aria-label="Upload progress"
            className="h-2 w-full overflow-hidden rounded bg-gray-200"
          >
            <div
              className="h-full bg-gray-900 transition-[width]"
              style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-sm text-gray-600">
            {progress !== null && progress >= 1
              ? 'Processing photos…'
              : `Uploading — ${Math.round((progress ?? 0) * 100)}%`}
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}

/**
 * Attaches the alt-text inputs' current values back onto the selected photos.
 *
 * The alt-text fields are uncontrolled (`defaultValue`) so typing in one does not re-render
 * every preview on a phone. That means their values live in the DOM until submit, and this
 * is where they are collected.
 */
export function collectAltText(form: HTMLFormElement, photos: SelectedPhoto[]): SelectedPhoto[] {
  return photos.map((photo) => {
    const field = form.elements.namedItem(`altText:${photo.key}`);
    const value = field instanceof HTMLInputElement ? field.value : photo.altText;
    return { ...photo, altText: value };
  });
}
