<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan:

**Active plan**: [specs/001-designer-portfolio-storefront/plan.md](specs/001-designer-portfolio-storefront/plan.md)

Supporting artifacts:

- [spec.md](specs/001-designer-portfolio-storefront/spec.md) — requirements, clarifications, success criteria
- [research.md](specs/001-designer-portfolio-storefront/research.md) — technology decisions D1–D10 with rationale
- [data-model.md](specs/001-designer-portfolio-storefront/data-model.md) — schema, RLS policies, state transitions
- [contracts/](specs/001-designer-portfolio-storefront/contracts/) — public and designer interface contracts
- [quickstart.md](specs/001-designer-portfolio-storefront/quickstart.md) — setup and validation guide
- [.specify/memory/constitution.md](.specify/memory/constitution.md) — project principles (v1.0.0), binding on all work

**Two rules from the constitution that constrain almost every change here**: public routes must read
through `lib/data/public-designs.ts` only (never the `design` table directly), and no private field or
unpublished design may reach a visitor. Both have mandatory automated tests.
<!-- SPECKIT END -->
