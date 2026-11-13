// D2 — مطابقة الأصل المُتحقَّق منه.
// النقطتان الحاسمتان: الذاكرة ليست مرساة، وقول النموذج ليس أصلًا.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { newId, nowTimestamp } from "../src/ids.js";
import { HostPathAuthority } from "../src/platform/host-path-authority.js";
import { FORBIDDEN_ANCHOR_KINDS, runD2, type TrustAnchor } from "../src/trust/d2.js";
import type { DeclassificationAttempt, DeclassificationPurpose } from "../src/trust/record.js";
import { makeWorkspace, type Workspace } from "./w4-helpers.js";

const READ: DeclassificationPurpose = { action: "read.filesystem", value_kind: "FILESYSTEM_PATH" };
const WRITE: DeclassificationPurpose = { action: "write.filesystem", value_kind: "FILESYSTEM_PATH" };

function anchor(kind: string, values: readonly string[], overrides: Partial<TrustAnchor> = {}): TrustAnchor {
  return {
    anchor_id: newId(),
    kind,
    value_kind: "FILESYSTEM_PATH",
    values: [...values],
    established_by: "USER_ACTION",
    established_at: nowTimestamp(),
    ...overrides,
  };
}

function attempt(
  workspace: Workspace,
  candidate: string,
  anchors: readonly TrustAnchor[],
  purpose: DeclassificationPurpose = READ,
): DeclassificationAttempt {
  return runD2({
    correlation_id: newId(),
    mission_id: newId(),
    candidate,
    anchors,
    purpose,
    scope: "SINGLE_MISSION",
    input_taint: ["MODEL_GENERATED"],
    input_provenance: ["model-output"],
    path_authority: new HostPathAuthority(workspace.mounts, process.platform),
  });
}

test("a model-proposed path inside a user-authorised root is declassified, with canonical evidence", () => {
  const workspace = makeWorkspace();
  try {
    const result = attempt(workspace, workspace.path("project", "README.md"), [
      anchor("USER_AUTHORIZED_FS_ROOT", [workspace.logical]),
    ]);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.record.method, "D2");
    assert.deepEqual(result.record.input_taint, ["MODEL_GENERATED"]);
    assert.ok(result.record.evidence.checks.some((c) => c.includes("resolves inside the user-authorised root")));
    assert.equal(typeof result.record.evidence.anchor_id, "string");
  } finally {
    workspace.dispose();
  }
});

test("MEMORY can never be a trust anchor, and presenting one fails the whole attempt", () => {
  const workspace = makeWorkspace();
  try {
    const result = attempt(workspace, workspace.path("project", "README.md"), [
      anchor("MEMORY", [workspace.logical]),
      anchor("USER_AUTHORIZED_FS_ROOT", [workspace.logical]),
    ]);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failure.code, "FORBIDDEN_ANCHOR");
    assert.match(result.failure.detail, /MEMORY/);
  } finally {
    workspace.dispose();
  }
});

test("every forbidden anchor kind is refused by name, not by falling through a switch", () => {
  const workspace = makeWorkspace();
  try {
    for (const kind of FORBIDDEN_ANCHOR_KINDS) {
      const result = attempt(workspace, workspace.path("project", "README.md"), [anchor(kind, [workspace.logical])]);
      assert.equal(result.ok, false, `${kind} was accepted`);
      if (!result.ok) assert.equal(result.failure.code, "FORBIDDEN_ANCHOR");
    }
  } finally {
    workspace.dispose();
  }
});

test("an invented anchor kind is refused: the allowed set is closed", () => {
  const workspace = makeWorkspace();
  try {
    const result = attempt(workspace, workspace.path("project", "README.md"), [
      anchor("THE_USER_DEFINITELY_CHOSE_THIS", [workspace.logical]),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "FORBIDDEN_ANCHOR");
  } finally {
    workspace.dispose();
  }
});

test("no anchor at all is a failure, never a default pass", () => {
  const workspace = makeWorkspace();
  try {
    const result = attempt(workspace, workspace.path("project", "README.md"), []);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "NO_ANCHOR");
  } finally {
    workspace.dispose();
  }
});

test("a traversal path is rejected before any anchor can match it", () => {
  const workspace = makeWorkspace();
  try {
    const result = attempt(workspace, `${workspace.logical}\\..\\Windows\\win.ini`, [
      anchor("USER_AUTHORIZED_FS_ROOT", [workspace.logical]),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "TRAVERSAL_REJECTED");
  } finally {
    workspace.dispose();
  }
});

test("a path outside the anchored root is out of anchor scope", () => {
  const workspace = makeWorkspace();
  try {
    const result = attempt(workspace, "C:\\Windows\\System32\\drivers\\etc\\hosts", [
      anchor("USER_AUTHORIZED_FS_ROOT", [workspace.logical]),
    ]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.code, "OUT_OF_ANCHOR_SCOPE");
  } finally {
    workspace.dispose();
  }
});

test("an anchor bound to read purposes proves nothing for a write purpose", () => {
  const workspace = makeWorkspace();
  try {
    const readOnly = anchor("USER_AUTHORIZED_FS_ROOT", [workspace.logical], { purpose_actions: ["read.filesystem"] });
    const allowed = attempt(workspace, workspace.path("project", "README.md"), [readOnly], READ);
    assert.equal(allowed.ok, true);

    const refused = attempt(workspace, workspace.path("project", "README.md"), [readOnly], WRITE);
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.equal(refused.failure.code, "ANCHOR_MISMATCH");
  } finally {
    workspace.dispose();
  }
});

test("a direct user value must match exactly after canonicalisation", () => {
  const workspace = makeWorkspace();
  try {
    const exact = workspace.path("project", "README.md");
    const supplied = anchor("DIRECT_USER_VALUE", [exact]);
    assert.equal(attempt(workspace, exact.toLowerCase(), [supplied]).ok, true, "case folding must match on Windows paths");

    const other = attempt(workspace, workspace.path("project", "README-injected-path.md"), [supplied]);
    assert.equal(other.ok, false);
    if (!other.ok) assert.equal(other.failure.code, "ANCHOR_MISMATCH");
  } finally {
    workspace.dispose();
  }
});

test("a symbolic link that leaves the anchored root is caught after real resolution", { skip: process.platform === "win32" ? "junction creation needs a native Windows run" : false }, () => {
  const workspace = makeWorkspace();
  try {
    const outside = join(workspace.host, "..", `polaris-outside-${newId()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "not yours", "utf8");
    symlinkSync(join(outside, "secret.txt"), workspace.hostPath("project", "escape.txt"));

    const result = attempt(workspace, workspace.path("project", "escape.txt"), [
      anchor("USER_AUTHORIZED_FS_ROOT", [workspace.logical]),
    ]);
    assert.equal(result.ok, false, "a link out of the root must not be declassified");
    if (!result.ok) assert.equal(result.failure.code, "SYMLINK_ESCAPE");
  } finally {
    workspace.dispose();
  }
});
