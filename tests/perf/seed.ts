import { randomUUID } from 'node:crypto';

import type { APIRequestContext, Page } from '@playwright/test';
import sharp from 'sharp';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../e2e/helpers/env';
import { OWNER_EMAIL, OWNER_PASSWORD } from '../e2e/helpers/studio';

/**
 * T079 — launch-scale fixture: 50 published designs averaging 3 photos (SC-009).
 *
 * ============================================================================
 * **The photographs have to be photograph-shaped, or the measurement is worthless.**
 *
 * The rest of the suite generates fixtures with `makeJpeg`, a flat block of one colour. That
 * is exactly right there — it decodes, it has EXIF, it proves the pipeline ran. It is
 * catastrophic here: a solid colour encodes to a couple of kilobytes at any dimension, so a
 * storefront of 50 of them weighs almost nothing and sails past a 3-second LCP budget on a
 * 400 kbps link. The test would report a comfortable pass and mean nothing at all.
 *
 * So this module synthesises images with photographic *entropy*: random noise generated small,
 * upscaled with a smooth kernel and lightly blurred. That produces the local gradients and
 * fine texture a camera produces, and therefore comparable compression behaviour, without
 * committing binary fixtures to the repository.
 *
 * `storefront.perf.spec.ts` additionally asserts a floor on the average delivered image size.
 * If a future change makes these fixtures trivially compressible again, the perf run fails as
 * *unrealistic* rather than passing as fast — which is the failure mode that matters, because
 * a green performance number nobody can trust is worse than no number.
 * ============================================================================
 *
 * Designs are created through the real `POST /studio/designs` route so the genuine pipeline
 * runs — EXIF handling, the 2048px display variant, the LQIP placeholder. Inserting rows
 * directly would measure fabricated data and tell us nothing about the code that ships.
 */

export const PERF_PREFIX = 'PERF-';
export const TARGET_DESIGNS = 50;
export const PHOTOS_PER_DESIGN = 3;

/** Collections the fixture spreads across, so SC-009's filter measurement has something to
 *  filter by without needing category ids. */
export const PERF_COLLECTIONS = ['PERF Atelier', 'PERF Resort', 'PERF Archive'] as const;

/**
 * A synthetic photograph.
 *
 * Noise at 1/6 scale, upscaled with a cubic kernel and blurred a little. The upscale turns
 * per-pixel noise into smooth local variation; the blur removes the last of the hard edges.
 * The result compresses like a photograph rather than like a swatch.
 *
 * `seed` shifts the colour balance per image so a cross-contaminated thumbnail is visible by
 * eye, the same reason the e2e helper varies its colour.
 */
export async function makePhotographicJpeg(seed: number): Promise<Buffer> {
  const smallWidth = 256;
  const smallHeight = 341;
  const channels = 3;

  const raw = Buffer.alloc(smallWidth * smallHeight * channels);
  // A cheap deterministic PRNG: reproducible fixtures beat `Math.random()` when a measurement
  // has to be compared across runs.
  let state = (seed + 1) * 2654435761;
  const next = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0xffffffff;
  };

  const tintR = 0.55 + (seed % 7) * 0.05;
  const tintG = 0.5 + (seed % 5) * 0.05;
  const tintB = 0.45 + (seed % 11) * 0.04;

  for (let index = 0; index < raw.length; index += channels) {
    const base = next();
    raw[index] = Math.min(255, Math.floor(base * 255 * tintR + next() * 40));
    raw[index + 1] = Math.min(255, Math.floor(base * 255 * tintG + next() * 40));
    raw[index + 2] = Math.min(255, Math.floor(base * 255 * tintB + next() * 40));
  }

  return sharp(raw, { raw: { width: smallWidth, height: smallHeight, channels } })
    .resize({ width: 1600, height: 2133, kernel: 'cubic' })
    .blur(0.6)
    // Quality 88 so the *source* is not the thing limiting the display variant's fidelity;
    // the pipeline re-encodes to WebP anyway.
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** An owner access token, for the bulk publish below. Uses the anon key and a real password
 *  grant — the same credential a browser holds, so RLS applies exactly as it does in the app. */
async function ownerAccessToken(request: APIRequestContext): Promise<string> {
  const response = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    data: { email: OWNER_EMAIL, password: OWNER_PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(`could not obtain an owner token: ${response.status()} ${await response.text()}`);
  }
  return (await response.json()).access_token as string;
}

async function listPerfDesigns(
  request: APIRequestContext,
  token: string,
): Promise<{ id: string; published: boolean }[]> {
  const response = await request.get(
    `${SUPABASE_URL}/rest/v1/design?select=id,published&title=like.${PERF_PREFIX}*`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
  );

  if (!response.ok()) return [];
  return (await response.json()) as { id: string; published: boolean }[];
}

export interface SeedResult {
  /** Ids this call created, so teardown removes only its own work. */
  created: string[];
  /** Total PERF designs present afterwards. */
  total: number;
  /** Wall-clock seconds spent, for the run log. */
  seconds: number;
}

/**
 * Tops the database up to `TARGET_DESIGNS` published PERF designs.
 *
 * Idempotent: a second run finds them and does nothing, which matters because 150 real uploads
 * through `sharp` is minutes of work. `page` must already be signed in — `page.request` shares
 * the context's cookies, which is what authorises the create route.
 */
export async function seedLaunchScale(page: Page): Promise<SeedResult> {
  const startedAt = Date.now();
  const token = await ownerAccessToken(page.request);

  const existing = await listPerfDesigns(page.request, token);
  const missing = Math.max(0, TARGET_DESIGNS - existing.length);
  const created: string[] = [];

  for (let index = 0; index < missing; index += 1) {
    const ordinal = existing.length + index;
    const designId = randomUUID();

    const form = new FormData();
    form.append('designId', designId);
    form.append('title', `${PERF_PREFIX}Design ${String(ordinal).padStart(3, '0')}`);
    form.append('collection', PERF_COLLECTIONS[ordinal % PERF_COLLECTIONS.length] ?? '');

    for (let photo = 0; photo < PHOTOS_PER_DESIGN; photo += 1) {
      const bytes = await makePhotographicJpeg(ordinal * PHOTOS_PER_DESIGN + photo);
      form.append(
        'photo',
        new File([new Uint8Array(bytes)], `perf-${ordinal}-${photo}.jpg`, { type: 'image/jpeg' }),
      );
      form.append('photoAlt', '');
    }

    const response = await page.request.post('/studio/designs', {
      multipart: form,
      timeout: 120_000,
    });

    if (!response.ok()) {
      throw new Error(`seed failed at design ${ordinal}: ${response.status()} ${await response.text()}`);
    }
    created.push(designId);
  }

  // Publish everything in one request. The flag is not what this fixture is exercising — the
  // upload pipeline is — so driving 50 toggles through the interface would add minutes to
  // prove something `setPublished` already covers in its own spec. RLS still applies: this
  // is the owner's token, not the service-role key.
  const all = await listPerfDesigns(page.request, token);
  const unpublished = all.filter((design) => !design.published).map((design) => design.id);

  if (unpublished.length > 0) {
    const response = await page.request.patch(
      `${SUPABASE_URL}/rest/v1/design?id=in.(${unpublished.join(',')})`,
      {
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        data: { published: true },
      },
    );
    if (!response.ok()) {
      throw new Error(`could not publish the fixture: ${response.status()} ${await response.text()}`);
    }
  }

  return {
    created,
    total: all.length,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

/**
 * Removes **every** PERF design through the real delete path, so storage is swept too (FR-019).
 *
 * Deleting the rows over REST would cascade the `photo` rows and leave ~150 objects orphaned in
 * the bucket — the exact debt `deleteDesignFiles` exists to prevent, reintroduced by the test
 * that is meant to be measuring the system honestly.
 *
 * Sweeps by prefix rather than by the ids one run happened to create. A run that dies part-way
 * through seeding — a hook timeout, an interrupt — leaves designs behind with no record of
 * them, and a teardown that only knows about its own work would strand those forever. The
 * prefix is unambiguous: nothing but this fixture creates `PERF-` titles.
 */
export async function teardownLaunchScale(page: Page): Promise<void> {
  const token = await ownerAccessToken(page.request);
  const ids = (await listPerfDesigns(page.request, token)).map((design) => design.id);

  for (const id of ids) {
    await page.goto(`/studio/designs/${id}`).catch(() => {});

    const trigger = page.getByRole('button', { name: 'Delete design' }).first();
    try {
      await trigger.waitFor({ state: 'visible', timeout: 5_000 });
    } catch {
      continue; // Already gone.
    }

    await trigger.click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete design' }).click();
    await page.waitForURL('**/studio', { timeout: 30_000 }).catch(() => {});
  }
}
