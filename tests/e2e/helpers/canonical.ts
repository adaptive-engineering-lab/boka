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
 *   2. **Flight chunks are sorted.** Their order is a transport detail. Their contents are
 *      not touched, so a field that leaked into any chunk still fails the comparison.
 *
 * What is emphatically NOT normalized: any rendered markup, any attribute, any text, any
 * field value. If a response mentions a draft's title, its category, or a private note, the
 * comparison fails — which is the whole point.
 * ============================================================================
 */

/** Matches one streamed flight chunk. */
const FLIGHT_CHUNK = /<script>self\.__next_f\.push\(\[[\s\S]*?\]\)<\/script>/g;

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

  // 2. Lift the flight chunks out, sort them, and put them back in one place. Contents are
  //    preserved exactly; only their sequence is canonicalised.
  const chunks = result.match(FLIGHT_CHUNK) ?? [];
  if (chunks.length === 0) return result;

  const withoutChunks = result.replace(FLIGHT_CHUNK, '');
  return `${withoutChunks}\n<<FLIGHT>>\n${[...chunks].sort().join('\n')}`;
}
