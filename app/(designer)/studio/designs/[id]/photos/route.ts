import { NextResponse } from 'next/server';

import { addPhotosToDesign, type CreateDesignPhoto } from '@/lib/data/designer-designs';

/**
 * `POST /studio/designs/{id}/photos` — add photos to an existing design (FR-019).
 *
 * A route handler for the same reason the create route is one: upload progress (FR-008).
 * Ownership is not checked here — `addPhotosToDesign` confirms the design is hers before
 * writing anything, and RLS refuses the row insert regardless (FR-003).
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'The upload could not be read.' }, { status: 400 });
  }

  const files = form.getAll('photo').filter((entry): entry is File => entry instanceof File);
  const altTexts = form.getAll('photoAlt').map((entry) => String(entry ?? ''));

  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: 'No photos were sent.' }, { status: 400 });
  }

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

  const result = await addPhotosToDesign(id, photos);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error, rejected: result.rejected },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true, added: result.added, rejected: result.rejected });
}
