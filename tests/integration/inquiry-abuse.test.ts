import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkRateLimit, computeSenderHash } from '@/lib/inquiries/rate-limit';
import { adminClient, hasLocalStack, insertDesign, warnIfSkipped } from './helpers/db';

/**
 * T074 — the abuse checks cannot be routed around (FR-041, FR-041a, FR-041c, SC-016).
 *
 * ============================================================================
 * The direct-insert assertion is the one that matters, and it is the reason this file exists.
 *
 * The original design granted `anon` INSERT on `inquiry` and put the honeypot and rate limit in
 * the submission route. Every route-level test would have passed. But the anon key ships in the
 * browser bundle by necessity, so a bot could POST straight to the REST endpoint, skip the route
 * entirely, and write unlimited rows while choosing its own `sender_hash` — making the rate
 * limit evadable by varying a string — and its own `delivery_state` and title snapshot.
 *
 * The checks would have been enforced only against clients that chose to cooperate, which is
 * not enforcement. So this test attacks the data layer directly with the key a visitor actually
 * holds, rather than testing the front door and assuming it is the only one.
 * ============================================================================
 */

const created: string[] = [];
let designId: string;

/** The key every browser is given. Reading it here is the point: this is the visitor's key. */
const ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

const anonHeaders = {
  apikey: ANON_KEY,
  Authorization: `Bearer ${ANON_KEY}`,
  'Content-Type': 'application/json',
};

describe.skipIf(!hasLocalStack)('inquiry abuse resistance', () => {
  warnIfSkipped('inquiry-abuse');

  beforeAll(async () => {
    if (!hasLocalStack) return;
    const supabase = adminClient();
    const design = await insertDesign(supabase, { title: `Inquiry Abuse Subject ${Date.now()}` });
    designId = design.id;
    created.push(design.id);
    await supabase.from('design').update({ published: true }).eq('id', design.id);
  });

  afterAll(async () => {
    if (!hasLocalStack) return;
    const supabase = adminClient();
    await supabase.from('inquiry').delete().in('design_id', created);
    for (const id of created) await supabase.from('design').delete().eq('id', id);
  });

  it('refuses a direct insert with the key a browser holds', async () => {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/inquiry`, {
      method: 'POST',
      headers: anonHeaders,
      body: JSON.stringify({
        design_id: designId,
        design_title_snapshot: 'Injected',
        visitor_name: 'Bot',
        visitor_email: 'bot@example.com',
        // The values a bot would most want to choose for itself: an arbitrary sender identity
        // to defeat the rate limit, and a delivery state to stop the designer being alerted.
        sender_hash: 'chosen-by-the-caller',
        delivery_state: 'delivered',
      }),
    });

    expect(
      response.status,
      'anon can insert inquiries directly — the honeypot and rate limit are bypassable (FR-041c)',
    ).toBeGreaterThanOrEqual(400);
  });

  it('refuses to let a visitor read inquiries, including their own', async () => {
    // FR-046. There is no session to scope "their own" to, and revealing that anyone has
    // written is itself the disclosure.
    const response = await fetch(`${SUPABASE_URL}/rest/v1/inquiry?select=visitor_email`, {
      headers: anonHeaders,
    });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it('refuses to let a visitor update or delete an inquiry', async () => {
    const supabase = adminClient();
    const { data: row } = await supabase
      .from('inquiry')
      .insert({
        design_id: designId,
        design_title_snapshot: 'Abuse Subject',
        visitor_name: 'Real Visitor',
        visitor_email: 'visitor@example.com',
        sender_hash: 'server-computed',
      })
      .select('id')
      .single();

    expect(row).not.toBeNull();

    for (const method of ['PATCH', 'DELETE'] as const) {
      const response = await fetch(`${SUPABASE_URL}/rest/v1/inquiry?id=eq.${row!.id}`, {
        method,
        headers: anonHeaders,
        body: method === 'PATCH' ? JSON.stringify({ acknowledged: true }) : undefined,
      });
      expect(response.status, `anon could ${method} an inquiry`).toBeGreaterThanOrEqual(400);
    }
  });

  it('allows five submissions in an hour and denies the sixth', async () => {
    // FR-041, exercised against the real table rather than a mocked count — the limit is a
    // query over `(sender_hash, created_at)`, so a broken index or a wrong window would only
    // show up here.
    const supabase = adminClient();
    const senderHash = `test-sender-${Date.now()}`;

    for (let submission = 1; submission <= 5; submission += 1) {
      const before = await checkRateLimit(senderHash);
      expect(before.allowed, `submission ${submission} of 5 should be allowed`).toBe(true);

      const { error } = await supabase.from('inquiry').insert({
        design_id: designId,
        design_title_snapshot: 'Rate Limit Subject',
        visitor_name: `Visitor ${submission}`,
        visitor_email: `visitor${submission}@example.com`,
        sender_hash: senderHash,
      });
      expect(error).toBeNull();
    }

    const sixth = await checkRateLimit(senderHash);
    expect(sixth.allowed, 'the sixth submission in an hour must be refused').toBe(false);
    if (!sixth.allowed) {
      // FR-041 asks for a message explaining the limit, not a bare rejection — the visitor
      // needs to know it is temporary rather than that something is broken.
      expect(sixth.reason).toMatch(/limit/i);
    }

    // A different sender is unaffected. Scenario 8 is explicit that a visitor asking about
    // several designs in one session must not be caught by a limit meant for scripts.
    const other = await checkRateLimit(`unrelated-sender-${Date.now()}`);
    expect(other.allowed).toBe(true);
  });

  it('derives the sender identity from the request, never from the caller', async () => {
    // The rate limit is only as good as the identity it keys on. If a caller could choose it,
    // evading the limit would be a matter of varying a string (research D7, FR-041c).
    const from = (ip: string) => computeSenderHash(new Request('http://x/', { headers: { 'x-forwarded-for': ip } }));

    expect(from('203.0.113.9')).toBe(from('203.0.113.9'));
    expect(from('203.0.113.9')).not.toBe(from('198.51.100.4'));

    // Proxy chains: the left-most entry is the original client, the rest are hops.
    expect(from('203.0.113.9, 70.41.3.18')).toBe(from('203.0.113.9'));

    // And the stored value is a hash, not the address. The row already carries the visitor's
    // name and email; keeping their IP beside it would collect more than they offered.
    expect(from('203.0.113.9')).not.toContain('203.0.113.9');
    expect(from('203.0.113.9')).toMatch(/^[0-9a-f]{64}$/);
  });
});

/*
 * The honeypot is covered in `tests/e2e/inquiry.spec.ts` rather than here.
 *
 * It lives in the submission route, so testing it means an HTTP request to a running
 * application — which vitest does not provide and Playwright does. Splitting it out keeps this
 * file about what someone can do to the data layer directly, which is the part no route-level
 * test can reach.
 *
 * The anonymous grant and policy checks are likewise not duplicated here: migration 0013
 * asserts both in DO blocks that run on every `migration up` and `db reset`, so a regression
 * fails the migration rather than a test.
 */
