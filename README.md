# Boka

A public fashion-design portfolio — a storefront with nothing to buy.

One designer uploads and organizes her work from a phone. Anyone with the URL browses what she has
chosen to publish: no account, no cart, no checkout. The only action a visitor can take beyond
browsing is sending an inquiry about a piece.

## Status

Specification and planning complete; implementation not yet started.

## Documentation

| Document | Purpose |
|---|---|
| [Constitution](.specify/memory/constitution.md) | Project principles — binding on all work |
| [Specification](specs/001-designer-portfolio-storefront/spec.md) | Requirements, user stories, success criteria |
| [Research](specs/001-designer-portfolio-storefront/research.md) | Technology decisions and rejected alternatives |
| [Data model](specs/001-designer-portfolio-storefront/data-model.md) | Schema, RLS policies, state transitions |
| [Contracts](specs/001-designer-portfolio-storefront/contracts/) | Public and designer interface contracts |
| [Plan](specs/001-designer-portfolio-storefront/plan.md) | Technical context and structure |
| [Tasks](specs/001-designer-portfolio-storefront/tasks.md) | 71 dependency-ordered implementation tasks |
| [Quickstart](specs/001-designer-portfolio-storefront/quickstart.md) | Setup and validation guide |

## Two rules that constrain almost everything

From the [constitution](.specify/memory/constitution.md):

1. **No visitor ever authenticates.** The public surface is reachable with a URL alone. No buy, cart,
   checkout, comment, or edit affordance exists for a visitor.
2. **Private data never reaches a visitor.** Private notes and unpublished designs are unreachable by
   any means, including direct URL. Public reads go through a column-restricted view, never the base
   table.

Both are enforced by mandatory automated tests before any release.

## Stack

Next.js 15 (App Router) · TypeScript · Supabase (Postgres/Auth/Storage with RLS) · sharp · Resend ·
Tailwind CSS. Rationale and rejected alternatives are in
[research.md](specs/001-designer-portfolio-storefront/research.md).

## Getting started

See [quickstart.md](specs/001-designer-portfolio-storefront/quickstart.md) for prerequisites, setup,
and the validation scenarios.

> Copy `.env.example` to `.env` — never commit `.env`. `SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level
> Security, which is where this project's privacy guarantees actually live.
