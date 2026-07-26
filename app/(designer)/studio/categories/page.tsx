import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { createOwnCategory, deleteOwnCategory, listOwnCategoriesWithUsage } from '@/lib/data/designer-designs';

/**
 * T042 — category management (FR-015).
 *
 * **Deletion is blocked while any design still uses the category**, and the refusal names
 * the number of designs in the way. The alternative — cascading, or nulling the column —
 * would silently strip a category from work the designer had already filed, and she would
 * find out by noticing a filter no longer returns what it used to. The database enforces
 * this too (`on delete restrict` on `design.category_id`); this check exists to turn a raw
 * constraint error into a sentence she can act on.
 */
export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Categories — Studio',
};

export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; added?: string }>;
}) {
  const { error, added } = await searchParams;
  const categories = await listOwnCategoriesWithUsage();

  async function add(formData: FormData) {
    'use server';

    const result = await createOwnCategory(String(formData.get('name') ?? ''));
    revalidatePath('/studio/categories');

    if (!result.ok) {
      redirect(`/studio/categories?error=${encodeURIComponent(result.error ?? 'Could not add.')}`);
    }
    redirect('/studio/categories?added=1');
  }

  async function remove(formData: FormData) {
    'use server';

    const id = String(formData.get('id') ?? '');
    const name = String(formData.get('name') ?? '');
    const result = await deleteOwnCategory(id);

    revalidatePath('/studio/categories');

    if (!result.ok) {
      const message =
        result.inUse > 0
          ? `“${name}” is still used by ${result.inUse} design${result.inUse === 1 ? '' : 's'}. Move them to another category first.`
          : `“${name}” could not be removed.`;
      redirect(`/studio/categories?error=${encodeURIComponent(message)}`);
    }
    redirect('/studio/categories');
  }

  return (
    <main className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-medium">Categories</h1>
      <p className="mt-1 text-sm text-gray-600">
        Used to file your designs and to build the filter controls visitors see.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {added ? (
        <p role="status" className="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-green-900">
          Category added.
        </p>
      ) : null}

      <form action={add} className="mt-6 flex flex-wrap items-end gap-3">
        <div className="min-w-[12rem] flex-1">
          <label htmlFor="name" className="block text-sm font-medium">
            New category
          </label>
          <input
            id="name"
            name="name"
            type="text"
            required
            maxLength={50}
            className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
          />
        </div>
        <button type="submit" className="rounded bg-gray-900 px-4 py-2 text-white hover:bg-gray-800">
          Add
        </button>
      </form>

      <ul className="mt-8 divide-y divide-gray-200 border-t border-gray-200">
        {categories.length === 0 ? (
          <li className="py-6 text-sm text-gray-600">
            No categories yet. Add one above — designs can also be filed without a category.
          </li>
        ) : null}

        {categories.map((category) => (
          <li key={category.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{category.name}</p>
              <p className="text-sm text-gray-600">
                {category.designCount === 0
                  ? 'Not used yet'
                  : `${category.designCount} design${category.designCount === 1 ? '' : 's'}`}
              </p>
            </div>

            <form action={remove}>
              <input type="hidden" name="id" value={category.id} />
              <input type="hidden" name="name" value={category.name} />
              <button
                type="submit"
                disabled={category.designCount > 0}
                // Disabled rather than hidden, with the reason alongside: a control that
                // vanishes when it would refuse teaches nothing about why.
                title={
                  category.designCount > 0
                    ? 'Move its designs to another category first'
                    : undefined
                }
                className="rounded border border-gray-300 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400 disabled:hover:bg-transparent"
              >
                Remove
                <span className="sr-only-focusable"> {category.name}</span>
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
