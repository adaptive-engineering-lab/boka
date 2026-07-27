import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { createAdminClient } from '@/lib/supabase/admin';

/**
 * T068 — submission rate limiting (FR-041, research D7).
 *
 * Counts rows in Postgres over two windows, keyed by a salted hash of the client IP. No Redis,
 * no third-party service: the limits are 5/hour and 20/day, and a `count(*)` over the indexed
 * `(sender_hash, created_at)` pair is trivially fast at any volume this site will see.
 * Principle V rewards not adding infrastructure for a counting problem.
 *
 * **The hash is computed here, on the server, and never accepted from a caller.** That is the
 * whole reason the submission route is the only writer (FR-041c): a client-supplied sender
 * identity makes the limit self-defeating, since evading it is then just varying a string.
 */

/** FR-041. Generous enough that a visitor asking about several pieces in one sitting never
 *  meets it, tight enough that a script does so almost immediately. */
const HOURLY_LIMIT = 5;
const DAILY_LIMIT = 20;

/**
 * Salt for the IP hash.
 *
 * Without one, `sha256(ip)` is not anonymisation at all — the entire IPv4 space is four billion
 * values, so a rainbow table over it is an afternoon's work, and the row already carries the
 * visitor's name and email to attach a recovered address to.
 *
 * When `RATE_LIMIT_SALT` is unset the fallback is **random, generated once per process**. That
 * choice degrades the right thing. A fixed fallback constant would keep the rate limit working
 * across restarts while making every stored hash reversible; a random one keeps addresses
 * unrecoverable and merely resets the counting windows on redeploy. Between leaking visitor IPs
 * and letting a bot start its hourly count over, the second is obviously the better failure.
 *
 * Refusing the submission outright would be worse than both: FR-040 says an inquiry must
 * survive a broken notification, and losing a real message to a missing environment variable is
 * a harder failure than either.
 *
 * The service-role key is deliberately *not* used here even though it is high-entropy and
 * always present. Only `lib/supabase/admin.ts` may read it — a rule enforced by
 * `tests/integration/no-service-key.test.ts`, which caught the first version of this function.
 * Spreading that variable across modules for convenience is how it eventually reaches a bundle.
 */
const FALLBACK_SALT = randomBytes(32).toString('hex');

function salt(): string {
  const configured = process.env.RATE_LIMIT_SALT?.trim();
  if (configured) return configured;

  if (!warnedAboutSalt) {
    warnedAboutSalt = true;

    if (process.env.NODE_ENV === 'production') {
      /*
       * In production the per-process fallback does not degrade the limit — it disables it.
       *
       * The reasoning above holds for one long-lived server: windows reset on restart, and a
       * restart is rare. On a serverless platform (this deploys to Netlify) the "process" is a
       * Lambda instance. Instances are many, short-lived and concurrent, so consecutive
       * requests from one visitor are salted differently, `sender_hash` does not match, and the
       * count never accumulates past one. The limit is not loose at that point; it is absent,
       * and SC-016 does not hold.
       *
       * `console.error` rather than a throw, deliberately. Refusing to start, or refusing
       * submissions, would lose real inquiries over a missing environment variable — and
       * FR-040 is unambiguous that a message must survive a broken configuration. So the
       * system stays up, keeps accepting inquiries, and says loudly that a guarantee it claims
       * to offer is not currently being met.
       */
      console.error(
        '[rate-limit] RATE_LIMIT_SALT is not set in production. Submission rate limiting is ' +
          'effectively DISABLED: on serverless each instance salts differently, so per-sender ' +
          'counts never accumulate and FR-041 / SC-016 are not being enforced. Set ' +
          'RATE_LIMIT_SALT to a long random string and redeploy.',
      );
    } else {
      console.warn(
        '[rate-limit] RATE_LIMIT_SALT is not set. Using a per-process random salt: visitor IPs stay ' +
          'unrecoverable, but rate-limit windows reset whenever the server restarts.',
      );
    }
  }
  return FALLBACK_SALT;
}

let warnedAboutSalt = false;

/**
 * Derives the sender identity from the request.
 *
 * `x-forwarded-for` is a client-settable header, so a determined bot can vary it and defeat
 * this. That is a known and accepted limit: the honeypot catches the unsophisticated majority,
 * this catches repeat submissions from one origin, and FR-041b forbids the thing that would
 * actually stop a determined attacker — a visible challenge or a third-party service. The
 * defence that genuinely holds is that nothing here can be reached except through this route.
 */
export function computeSenderHash(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  // The left-most entry is the original client; everything after it is proxies.
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim() || 'unknown';

  return createHash('sha256').update(`${salt()}:${ip}`).digest('hex');
}

export type RateLimitResult = { allowed: true } | { allowed: false; reason: string };

/**
 * Checks both windows.
 *
 * Uses the admin client because `inquiry` denies anonymous SELECT (FR-046) — the count has to
 * be taken by something that can see rows, and the caller is a visitor with no identity at all.
 *
 * Fails **open** on a database error, deliberately. If the count cannot be taken, the choice is
 * between possibly allowing an extra submission and definitely dropping a real one. FR-040 is
 * unambiguous about which of those matters more, and an inquiry is a person waiting for a reply.
 */
export async function checkRateLimit(senderHash: string): Promise<RateLimitResult> {
  const admin = createAdminClient();

  const now = Date.now();
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

  const [hourly, daily] = await Promise.all([
    admin
      .from('inquiry')
      .select('id', { count: 'exact', head: true })
      .eq('sender_hash', senderHash)
      .gte('created_at', oneHourAgo),
    admin
      .from('inquiry')
      .select('id', { count: 'exact', head: true })
      .eq('sender_hash', senderHash)
      .gte('created_at', oneDayAgo),
  ]);

  if (hourly.error || daily.error) return { allowed: true };

  if ((hourly.count ?? 0) >= HOURLY_LIMIT) {
    return {
      allowed: false,
      reason: `You have sent ${HOURLY_LIMIT} messages in the past hour, which is the limit. Please try again a little later.`,
    };
  }

  if ((daily.count ?? 0) >= DAILY_LIMIT) {
    return {
      allowed: false,
      reason: `You have sent ${DAILY_LIMIT} messages today, which is the limit. Please try again tomorrow.`,
    };
  }

  return { allowed: true };
}
