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

/**
 * Turns an unexpected throw into a JSON answer the form can actually show.
 *
 * Without this the failure mode is genuinely bad, and it cost real debugging time on the first
 * deploy. `createDesign` reaches `createAdminClient()`, which **throws** when
 * `SUPABASE_SERVICE_ROLE_KEY` is unset. Nothing caught it, so Next answered with an HTML 500,
 * the client's `response.json()` found no `error` field, and the designer saw *"The design could
 * not be saved. Try again."* — advice that could never work, for a misconfiguration she cannot
 * see and trying again cannot fix.
 *
 * The message is surfaced rather than swallowed because this route is behind the session gate
 * on a single-owner product: the only person who can read it is the one who needs it. It names
 * the missing variable, never its value.
 */
function unexpected(error: unknown): NextResponse {
  const message = error instanceof Error ? error.message : String(error);
  // Server-side too, so it is in the platform logs even if the client never reports it.
  console.error('[studio/designs] create failed', error);

  return NextResponse.json(
    {
      ok: false,
      error: `The design could not be saved because the server hit an unexpected error: ${message}`,
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    return await handlePost(request);
  } catch (error) {
    return unexpected(error);
  }
}

async function handlePost(request: Request) {
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
