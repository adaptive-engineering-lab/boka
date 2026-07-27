import type { UndeliveredInquiry } from '@/lib/data/designer-inquiries';

/**
 * T072 — the undelivered-inquiry banner (FR-040b, FR-040c).
 *
 * ============================================================================
 * Every detail is readable **inline**, and that is the requirement rather than a layout choice.
 *
 * This banner exists because the channel that normally carries an inquiry — email — is the
 * channel that just broke. A banner saying "3 inquiries could not be delivered" with a link to
 * a page would be useless twice over: FR-042 gives v1 no inbox to link to, and the designer
 * would be told a lead exists without being told who it is. So the name, email, message and
 * the design each one concerns are all here, on the dashboard, where she will actually see them
 * (SC-015).
 *
 * The email is a `mailto:` because replying is the entire point — she cannot use "reply" in her
 * mail client for a message that never arrived. This is the one `mailto:` in the project, and
 * it is on the authenticated surface; the public pages deliberately have none.
 *
 * This is **not** the v1.1 inbox (FR-042). It shows only inquiries whose delivery failed, and
 * only until acknowledged. If it ever starts listing delivered ones, it has become the thing
 * the spec defers.
 * ============================================================================
 */
export function UndeliveredBanner({ inquiries }: { inquiries: UndeliveredInquiry[] }) {
  if (inquiries.length === 0) return null;

  const count = inquiries.length;

  return (
    <section
      // `role="alert"` rather than a quiet region: something is wrong and she has not been
      // told by any other means — that is the whole premise.
      role="alert"
      aria-labelledby="undelivered-heading"
      className="mb-6 rounded border border-amber-400 bg-amber-50 p-4"
    >
      <h2 id="undelivered-heading" className="font-medium text-amber-900">
        {count === 1
          ? 'One enquiry could not be emailed to you'
          : `${count} enquiries could not be emailed to you`}
      </h2>
      <p className="mt-1 text-sm text-amber-900">
        The {count === 1 ? 'message is' : 'messages are'} saved here in full. Reply directly, then
        mark {count === 1 ? 'it' : 'them'} as seen.
      </p>

      <ul className="mt-4 space-y-3">
        {inquiries.map((inquiry) => (
          <li key={inquiry.id} className="rounded border border-amber-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium">{inquiry.visitorName}</p>
                <p className="text-sm">
                  <a href={`mailto:${inquiry.visitorEmail}`} className="underline">
                    {inquiry.visitorEmail}
                  </a>
                </p>
                <p className="mt-1 text-sm text-gray-600">
                  About <span className="font-medium">{inquiry.designTitle}</span>
                  {inquiry.designId === null ? (
                    // The design is gone but the lead survives (FR-044). Say so, or the
                    // designer will look for a piece that is no longer in her archive.
                    <span className="text-gray-500"> — this design has since been deleted</span>
                  ) : null}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {new Date(inquiry.createdAt).toLocaleString()}
                </p>
              </div>

              {/* A form, not a link: acknowledging changes state and must not be reachable by
                  a prefetcher following a URL. */}
              <form method="post" action={`/studio/inquiries/${inquiry.id}/acknowledge`}>
                <button
                  type="submit"
                  className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Mark as seen
                </button>
              </form>
            </div>

            {inquiry.message ? (
              <p className="mt-3 whitespace-pre-line border-t border-gray-100 pt-3 text-sm text-gray-800">
                {inquiry.message}
              </p>
            ) : (
              <p className="mt-3 border-t border-gray-100 pt-3 text-sm italic text-gray-500">
                No message was included.
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
