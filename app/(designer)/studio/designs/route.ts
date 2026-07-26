import { NextResponse } from 'next/server';

import { createDesign, type CreateDesignPhoto } from '@/lib/data/designer-designs';

/**
 * `POST /studio/designs` — create a design (contract: designer-surface.md).
 *
 * A route handler rather than a server action, for one reason: **upload progress**
 * (FR-008). Server actions submit with `fetch`, which reports no progress on the request
 * body, and a phone pushing 60 MB of HEIC over a slow connection with no feedback is
 * indistinguishable from a hung app. The form submits here with `XMLHttpRequest`, which
 * does report it.
 *
 * Everything else — validation, the minimum-one-photo rule, the abandon-and-clean-up
 * path — lives in `createDesign`, not here. This function's whole job is turning a
 * multipart body into that call and its result into JSON.
 */

// sharp needs Node, and the whole request is image processing.
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Files and their alt text are read as parallel arrays. `FormData` preserves insertion
 *  order per key, and the client appends one `photoAlt` per `photo`, so index i of each
 *  refers to the same photo. */
const PHOTO_FIELD = 'photo';
const ALT_FIELD = 'photoAlt';

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'The upload could not be read.' }, { status: 400 });
  }

  const designId = String(form.get('designId') ?? '');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(designId)) {
    return NextResponse.json({ ok: false, error: 'Malformed submission.' }, { status: 400 });
  }

  const files = form.getAll(PHOTO_FIELD).filter((entry): entry is File => entry instanceof File);
  const altTexts = form.getAll(ALT_FIELD).map((entry) => String(entry ?? ''));

  const photos: CreateDesignPhoto[] = [];
  for (const [index, file] of files.entries()) {
    photos.push({
      name: file.name,
      size: file.size,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      altText: altTexts[index] ?? null,
    });
  }

  const result = await createDesign({
    designId,
    title: String(form.get('title') ?? ''),
    categoryId: String(form.get('categoryId') ?? '') || null,
    collection: String(form.get('collection') ?? '') || null,
    // PRIVATE (FR-024). Named `notes` all the way through so it is never mistaken for the
    // public field at any layer.
    notes: String(form.get('notes') ?? '') || null,
    publicDescription: String(form.get('publicDescription') ?? '') || null,
    photos,
  });

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, rejected: result.rejected },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    id: result.id,
    slug: result.slug,
    rejected: result.rejected,
    alreadyExisted: result.alreadyExisted,
  });
}
