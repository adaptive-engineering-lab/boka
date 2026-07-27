/**
 * Canonicalises a server-rendered response body so two of them can be compared for content.
 *
 * ============================================================================
 * Why this exists, and why it does not weaken the gates that use it.
 *
 * FR-023 requires a draft, a deleted design and a nonexistent slug to be indistinguishable.
 * The natural way to assert that is to compare the raw bodies — and doing so directly is
 * flaky, for a reason that has nothing to do with privacy: React streams the RSC flight
 * payload as a series of `self.__next_f.push([...])` script tags, and **the order in which
 * those chunks are emitted is not deterministic**. Two responses can be identical in length
 * and content while interleaving the metadata chunk and a module chunk differently.
 *
 * That was observed: two 404s of exactly 12622 bytes each, diverging at offset 8675 purely in
 * chunk order. A gate that fails at random gets ignored, and an ignored gate on a
 * non-negotiable principle is worse than no gate — so the comparison has to be immune to
 * ordering while staying strict about content.
 *
 * Two normalizations are applied, and both are deliberately narrow:
 *
 *   1. **Values the visitor supplied** (the requested slug, a filter value) are replaced with
 *      a placeholder. Echoing back the URL somebody typed discloses nothing they did not
 *      already know. This is the only *semantic* normalization, and it is why the callers
 *      pass a probe of identical length and shape — so `Content-Length` cannot differ for an
 *      innocent reason either.
 *
 *   2. **Flight *records* are sorted.** Their order is a transport detail. Their contents are
 *      not touched, so a field that leaked into any record still fails the comparison.
 *
 * Normalization 2 works at the record level, and the distinction is not academic — sorting
 * whole `push()` calls, which is what this did first, is not enough. React decides how many
 * records to pack into each `<script>` based on streaming timing, so the *same* records can
 * arrive as one push in one response and as two in the next. That was observed on
 * `filter-leakage.spec.ts`: two responses identical in content, differing only in whether the
 * `8:` metadata record rode along with the `f:` module record or was flushed on its own.
 * Sorting the pushes cannot normalise that, because the two strings being compared are
 * genuinely different strings. Splitting into records first makes both the packing and the
 * ordering irrelevant.
 *
 * The failure mode this prevents is specific and dangerous: a privacy gate that fails at
 * random gets re-run until it is green, which is indistinguishable from re-running until a
 * real leak is waved through.
 *
 * What is emphatically NOT normalized: any rendered markup, any attribute, any text, any
 * field value. If a response mentions a draft's title, its category, or a private note, the
 * comparison fails — which is the whole point.
 * ============================================================================
 */

/** Matches one streamed flight chunk, capturing its `push()` argument. */
const FLIGHT_CHUNK = /<script>self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g;

/**
 * Pulls the individual flight records out of the streamed chunks.
 *
 * Each chunk is `push([1,"<payload>"])`, where the payload is a JS string literal holding one
 * or more newline-separated records. `JSON.parse` on the argument array turns that literal
 * into its real text: record separators become actual newlines, while a newline *inside* a
 * value (a designer's bio, say) remains the two-character escape `\n` and therefore does not
 * split. Doing this by hand on the raw HTML would confuse the two.
 *
 * Returns null if anything fails to parse, so the caller can fall back rather than throw —
 * a helper that dies on an unexpected payload would take the gates down with it.
 */
function extractFlightRecords(body: string): string[] | null {
  const records: string[] = [];

  for (const match of body.matchAll(FLIGHT_CHUNK)) {
    const argument = match[1];
    if (argument === undefined) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(argument);
    } catch {
      return null;
    }

    if (!Array.isArray(parsed)) return null;
    // The bootstrap chunk is `push([0])` and carries no payload.
    const payload = parsed[1];
    if (payload === undefined) continue;
    if (typeof payload !== 'string') return null;

    for (const record of payload.split('\n')) {
      if (record !== '') records.push(record);
    }
  }

  return records;
}

export function canonicalizeBody(body: string, echoedValues: readonly string[] = []): string {
  let result = body;

  // 1. Replace visitor-supplied values. Longest first, so a value that contains another
  //    does not leave a partial replacement behind.
  for (const value of [...echoedValues].sort((a, b) => b.length - a.length)) {
    if (!value) continue;
    result = result.split(value).join('<ECHOED>');
    // Also the URL-encoded form, which appears in the flight payload for query values.
    const encoded = encodeURIComponent(value);
    if (encoded !== value) result = result.split(encoded).join('<ECHOED>');
  }

  // 2. Lift the flight payload out, sort its records, and put them back in one place.
  //    Contents are preserved exactly; only sequence and packing are canonicalised.
  const chunks = result.match(FLIGHT_CHUNK) ?? [];
  if (chunks.length === 0) return result;

  const withoutChunks = result.replace(FLIGHT_CHUNK, '');
  const records = extractFlightRecords(result);

  // Fall back to sorting whole chunks if the payload did not parse. Weaker against
  // re-packing, but still strict about content, and never silently skips normalization.
  const normalized = records ?? [...chunks].sort();
  return `${withoutChunks}\n<<FLIGHT>>\n${[...normalized].sort().join('\n')}`;
}
