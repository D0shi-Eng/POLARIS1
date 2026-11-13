# POLARIS Core Contracts v1

Phase 00 / W2. The typed boundaries between POLARIS components.

## Source of truth

`schemas/` — hand-authored JSON Schema 2020-12. Nothing else is hand-authored.
`generated/types/` is derived and guarded by a drift test; editing it fails the build.
See `docs/adr/ADR-002-contract-source-of-truth.md`.

## Commands

```
npm run generate    # regenerate TypeScript types from the schemas
npm run typecheck   # tsc --noEmit
npm run build       # compile to dist/
npm test            # node --test over the compiled suite
npm run verify      # all four, in order
```

## Layout

```
schemas/         contract + shared primitive schemas   ← edit here
src/             validation, canonicalisation, semantics, cross-contract invariants
generated/types/ derived TypeScript                     ← never edit
fixtures/        positive and negative documents; negatives are bound to their expected rejection
tests/           the executable evidence
```

## Conventions

Identifiers and public schema documentation are English; hand-written internal comments are
Arabic; generated files are exempt. Every contract is `MAJOR.MINOR` versioned and the version
gate runs before validation.
