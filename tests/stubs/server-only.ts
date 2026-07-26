/**
 * Vitest stub for the `server-only` package.
 *
 * The real package throws on import outside a React Server Component, which is exactly what
 * makes it useful in `lib/` — it turns "this leaked into the browser" into a build error.
 * It also makes those modules unimportable from a test runner, so vitest aliases the
 * specifier here (see `vitest.config.ts`).
 *
 * This weakens nothing. The guarantee is enforced at build time by Next and again by
 * `tests/integration/no-service-key.test.ts`, which greps the actual client bundles.
 */
export {};
