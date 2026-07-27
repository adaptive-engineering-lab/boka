import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getOwnProfile, updateOwnProfile, updateOwnProfilePhoto } from '@/lib/data/designer-designs';
import { FILE_INPUT_ACCEPT, LIMITS_SENTENCE } from '@/lib/images/validate';

/**
 * T043 — profile settings (FR-029).
 *
 * Name, bio and profile photo. All three render on the public homepage (FR-028), so the
 * screen says so — the designer is writing for visitors here, unlike almost everywhere
 * else in the studio, and nothing about a settings page makes that obvious by itself.
 *
 * **`email` is shown but not editable**, per the contract. It is simultaneously the sign-in
 * identity and the destination for inquiry notifications (FR-039); changing it safely needs
 * a verification round trip that v1 does not have, and changing it unsafely means inquiries
 * silently stop arriving. It is also omitted from `public_designer_profile`, so it is not
 * public contact information and is not presented as such.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings — Studio',
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { saved, error } = await searchParams;

  const profile = await getOwnProfile();
  if (!profile) redirect('/auth/sign-in?next=/studio/settings');

  /*
   * The preview points at `/img/profile` — the same route visitors use, because the owner's
   * avatar *is* the public avatar and there is nothing separate to show her.
   *
   * The `?v=` cache-buster is load-bearing. `/img/profile` is a fixed URL serving a file that
   * is overwritten in place, with a 60-second cache; without this, uploading a new photo would
   * appear to do nothing for a minute, which reads as a failed upload. This page is
   * force-dynamic, so each render mints a fresh value.
   */
  const photoUrl = profile.profilePhotoPath ? `/img/profile?v=${Date.now()}` : null;

  async function saveProfile(formData: FormData) {
    'use server';

    const result = await updateOwnProfile({
      name: String(formData.get('name') ?? ''),
      bio: String(formData.get('bio') ?? '') || null,
    });

    revalidatePath('/studio/settings');
    if (!result.ok) {
      redirect(`/studio/settings?error=${encodeURIComponent(result.error ?? 'Save failed.')}`);
    }
    redirect('/studio/settings?saved=1');
  }

  async function savePhoto(formData: FormData) {
    'use server';

    const entry = formData.get('photo');
    const file = entry instanceof File && entry.size > 0 ? entry : null;
    if (!file) {
      redirect(`/studio/settings?error=${encodeURIComponent('Choose a photo first.')}`);
    }

    const result = await updateOwnProfilePhoto({
      name: file.name,
      size: file.size,
      type: file.type,
      bytes: Buffer.from(await file.arrayBuffer()),
      altText: null,
    });

    revalidatePath('/studio/settings');
    if (!result.ok) {
      redirect(`/studio/settings?error=${encodeURIComponent(result.error ?? 'Upload failed.')}`);
    }
    redirect('/studio/settings?saved=1');
  }

  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium">Settings</h1>
      <p className="mt-1 text-sm text-gray-600">
        Your name, bio and photo appear at the top of your public storefront.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {saved ? (
        <p role="status" className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-900">
          Saved.
        </p>
      ) : null}

      <form action={saveProfile} className="mt-6 space-y-6">
        <div>
          <label htmlFor="name" className="block text-sm font-medium">
            Name
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={120}
            defaultValue={profile.name}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <div>
          <label htmlFor="bio" className="block text-sm font-medium">
            Bio
          </label>
          <p id="bio-help" className="mt-1 text-xs text-gray-600">
            A short introduction, shown to visitors. Up to 2000 characters.
          </p>
          <textarea
            id="bio"
            name="bio"
            rows={5}
            maxLength={2000}
            aria-describedby="bio-help"
            defaultValue={profile.bio ?? ''}
            className="mt-2 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>

        <button
          type="submit"
          className="rounded bg-gray-900 px-5 py-2.5 text-white hover:bg-gray-800"
        >
          Save profile
        </button>
      </form>

      <section aria-labelledby="photo-heading" className="mt-10 border-t border-gray-200 pt-6">
        <h2 id="photo-heading" className="text-lg font-medium">
          Profile photo
        </h2>

        {photoUrl ? (
          // Not next/image: the optimiser would cache the avatar keyed on a URL whose `?v=`
          // changes every render, so it would re-optimise every time and cache nothing useful.
          <img
            src={photoUrl}
            alt="Your current profile photo"
            className="mt-3 h-24 w-24 rounded-full object-cover"
          />
        ) : (
          <p className="mt-3 text-sm text-gray-600">No profile photo yet.</p>
        )}

        <form action={savePhoto} className="mt-4 space-y-3">
          <div>
            <label htmlFor="photo" className="block text-sm font-medium">
              Choose a photo
            </label>
            <input
              id="photo"
              name="photo"
              type="file"
              accept={FILE_INPUT_ACCEPT}
              required
              aria-describedby="photo-help"
              className="mt-1 block w-full text-sm"
            />
            <p id="photo-help" className="mt-1 text-xs text-gray-500">
              {LIMITS_SENTENCE}
            </p>
          </div>

          <button
            type="submit"
            className="rounded border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50"
          >
            Upload photo
          </button>
        </form>
      </section>

      <section aria-labelledby="account-heading" className="mt-10 border-t border-gray-200 pt-6">
        <h2 id="account-heading" className="text-lg font-medium">
          Account
        </h2>
        <dl className="mt-3 text-sm">
          <dt className="font-medium">Email</dt>
          <dd className="text-gray-700">{profile.email}</dd>
        </dl>
        <p className="mt-2 text-xs text-gray-600">
          This is both your sign-in and where enquiries are sent. It is not shown to
          visitors, and it cannot be changed here — get in touch if you need it moved.
        </p>
      </section>
    </main>
  );
}
