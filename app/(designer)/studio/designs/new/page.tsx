import Link from 'next/link';

import { NewDesignForm } from '@/components/studio/NewDesignForm';
import { listOwnCategories } from '@/lib/data/designer-designs';

/**
 * T034 — add a design.
 *
 * A server component that does one thing before handing over: fetch the category list.
 * The form itself has to be a client component (upload progress needs `XMLHttpRequest`),
 * and fetching categories from there would mean an extra round trip on a phone before the
 * dropdown is usable.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Add a design — Studio',
};

export default async function NewDesignPage() {
  const categories = await listOwnCategories();

  return (
    <main className="mx-auto max-w-2xl">
      <div className="mb-6">
        <Link href="/studio" className="text-sm text-gray-600 hover:underline">
          ← Back to your designs
        </Link>
        <h1 className="mt-2 text-2xl font-medium">Add a design</h1>
      </div>

      {categories.length === 0 ? (
        <p className="mb-6 rounded bg-gray-50 px-3 py-2 text-sm text-gray-700">
          You have no categories yet. You can add this design without one and{' '}
          <Link href="/studio/categories" className="underline">
            set up categories
          </Link>{' '}
          later.
        </p>
      ) : null}

      <NewDesignForm categories={categories} />
    </main>
  );
}
