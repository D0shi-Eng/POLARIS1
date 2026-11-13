# ADR-003 — W3 foundations: policy engine, persistence, and unknown-schema handling

**Status:** ACCEPTED (Phase 00 / W3, 2026-09-01)
**Depends on:** ADR-001 (Windows confinement, CONDITIONAL), ADR-002 (contract source of truth).

Three decisions were real enough to record. Everything else in W3 was a reversible
implementation choice and is documented in the phase docs, not here.

---

## 1. Cedar is the policy engine

**Decision:** `@cedar-policy/cedar-wasm` 4.12.0 (Apache-2.0) evaluates POLARIS policy.

Cedar was not assumed suitable — it was probed against a POLARIS-shaped request before being
adopted, and four properties were confirmed by running it:

- **Default-deny.** No matching `permit` yields `deny` with an empty reason set.
- **`forbid` overrides `permit`.** A security rule cannot be neutralised by adding a rule.
- **Named policy ids in diagnostics.** Passing `staticPolicies` as an id→text map makes the
  engine report `POLICY-002.forbid` rather than `policy1`. This is what makes "why was this
  denied" attributable rather than approximate.
- **Missing context fails closed.** A context attribute a policy references but the request does
  not supply produces an evaluation error and a `deny`, not a silent `false`.

**Cost accepted:** ~13 MB unpacked WASM. **Transitive dependency count: zero** — `npm install`
adds exactly one package. For a security-critical component, a self-contained, formally
specified, independently maintained evaluator is worth more than 13 MB.

**Alternative rejected:** a hand-written evaluator. It would have been smaller, but every
property above would then be *our* claim to prove rather than the engine's to guarantee, and a
bespoke policy language is precisely the "stringly-typed commands" failure the contracts exist
to prevent.

**Consequence:** POLARIS policy is Cedar source. A POLARIS policy may compile to more than one
Cedar statement (POLICY-002 is a `forbid` plus the single `permit` that can satisfy it); the
logical policy, not the statement, is the unit of documentation and attribution.

---

## 2. Config persistence in W3 is in-memory, and durability is not claimed

**Decision:** `InMemoryConfigStore` is the only store. There is no disk, no journal, no database.

**Rationale:** W3 must prove *atomicity of a changeset* and *determinism of resolution*. Neither
needs durable storage. Introducing SQLite because POLARIS will eventually want it would add a
dependency, a migration story and a crash-recovery story that nothing in W3 exercises — and an
untested crash-recovery story is worse than none.

**Consequence, stated so it cannot be misread later:** the atomicity proven in W3 is
**process-memory atomicity**. POLARIS does **not** claim crash-safety, durable transactions, or
any RPO. When a durable store arrives, atomicity must be **re-proven against that store**; the
claim does not transfer. The `ConfigStore` interface exposes whole-layer replacement precisely so
a durable implementation can slot in behind it without changing the resolver or the changeset
logic.

---

## 3. Unknown keys and newer schemas: quarantine and degrade, never ignore and never crash

**Decision:** four rules, all tested:

| Situation | Behaviour |
|-----------|-----------|
| Unknown key in a **changeset** | Rejected. You cannot set what does not exist. |
| Unknown key **stored** under `polaris.*` | Quarantined, config marked `DEGRADED`. |
| Unknown key **stored** outside `polaris.*` | Quarantined, config stays `HEALTHY` (it belongs to someone else). |
| Stored layer with a **newer MAJOR** schema | **No value from that layer is applied at all**, config `DEGRADED`. |
| Stored layer with a **newer MINOR** schema | Known keys apply, the rest quarantined, config `DEGRADED`. |
| Stored value that fails validation or sits in a disallowed scope | Quarantined, lower-precedence value survives, config `DEGRADED`. |

**Why a newer MAJOR applies nothing:** a future schema may redefine what a key means. Applying
the keys we happen to recognise from a document we do not understand is exactly how a newer
schema silently becomes privileged configuration. Refusing the whole layer is the only reading
that cannot escalate.

**Why `DEGRADED` matters:** the PDP denies every request while configuration is degraded. A
trust-sensitive key we cannot interpret is not a warning to log — it means we do not know what
the operator intended, and not knowing is a denial.

**Rejected alternative:** ignore unknown keys with a warning. That is the industry default and it
is unsafe here: the one key you silently drop is the one that was supposed to restrict something.
