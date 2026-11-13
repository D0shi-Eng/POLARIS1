// سلطة المسارات. القواعد النحوية خالصة وقابلة للاختبار على أي منصة،
// والتطبيع الحقيقي يُختبر على نظام ملفات حقيقي.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { HostPathAuthority } from "../src/platform/host-path-authority.js";
import { foldWindowsPath, isLogicallyInside, parseWindowsPath } from "../src/platform/windows-path-rules.js";
import { newId } from "../src/ids.js";
import { makeWorkspace } from "./w4-helpers.js";

test("a plain absolute drive path parses to a canonical form", () => {
  // فواصل أمامية وحرف سواقة صغير: كلاهما يُطبَّع، ولا شيء منهما غامض.
  const parsed = parseWindowsPath("d:/POLARIS/docs/a.md");
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.parts.normalised, "D:\\POLARIS\\docs\\a.md");
  assert.equal(foldWindowsPath(parsed.parts.normalised), "D:\\POLARIS\\DOCS\\A.MD");
});

test("every ambiguous Windows path shape is refused by name rather than guessed", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["D:\\POLARIS\\..\\Windows\\win.ini", "TRAVERSAL_SEGMENT"],
    ["D:\\POLARIS\\.\\a.md", "TRAVERSAL_SEGMENT"],
    ["\\\\server\\share\\a.md", "UNC_PATH"],
    ["\\\\?\\D:\\POLARIS\\a.md", "EXTENDED_LENGTH_PREFIX"],
    ["D:\\POLARIS\\a.md:stream", "ALTERNATE_DATA_STREAM"],
    ["D:\\POLARIS\\NUL", "RESERVED_DEVICE_NAME"],
    ["D:\\POLARIS\\COM1.txt", "RESERVED_DEVICE_NAME"],
    ["D:\\POLARIS\\name.", "TRAILING_DOT_OR_SPACE"],
    ["D:\\POLARIS\\name ", "TRAILING_DOT_OR_SPACE"],
    ["D:\\PROGRA~1\\a.md", "SHORT_NAME_FORM"],
    ["D:\\POLARIS\\*.md", "WILDCARD_OR_ILLEGAL_CHARACTER"],
    ["POLARIS\\a.md", "NOT_ABSOLUTE_DRIVE_PATH"],
    ["D:\\POLARIS\\\\a.md", "EMPTY_SEGMENT"],
  ];
  for (const [input, expected] of cases) {
    const parsed = parseWindowsPath(input);
    assert.equal(parsed.ok, false, `${input} was accepted`);
    if (!parsed.ok) assert.equal(parsed.rejection, expected, `${input} rejected as ${parsed.rejection}`);
  }
});

test("a control character in a path is refused", () => {
  const parsed = parseWindowsPath(`D:\\POLARIS\\a${String.fromCharCode(1)}.md`);
  assert.equal(parsed.ok, false);
  if (!parsed.ok) assert.equal(parsed.rejection, "CONTROL_CHARACTER");
});

test("logical containment respects segment boundaries, so a sibling prefix never counts as inside", () => {
  const root = parseWindowsPath("D:\\POLARIS");
  const sibling = parseWindowsPath("D:\\POLARIS-EVIL\\a.md");
  const inside = parseWindowsPath("D:\\polaris\\docs\\a.md");
  assert.equal(root.ok && sibling.ok && isLogicallyInside(root.parts, sibling.parts), false);
  assert.equal(root.ok && inside.ok && isLogicallyInside(root.parts, inside.parts), true);
});

test("canonicalisation resolves a real file and reports its kind", () => {
  const workspace = makeWorkspace();
  try {
    const authority = new HostPathAuthority(workspace.mounts, process.platform);
    const file = authority.canonicalize(workspace.path("project", "README.md"), { mustExist: true, expect: "FILE" });
    assert.equal(file.ok, true);
    if (!file.ok) return;
    assert.equal(file.value.kind, "FILE");
    assert.equal(file.value.exists, true);

    const absent = authority.canonicalize(workspace.path("out", "new.txt"), { mustExist: false });
    assert.equal(absent.ok, true);
    if (absent.ok) assert.equal(absent.value.exists, false);

    const missing = authority.canonicalize(workspace.path("out", "new.txt"), { mustExist: true });
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.failure.rejection, "NOT_FOUND");
  } finally {
    workspace.dispose();
  }
});

test("a path under no configured mount is refused rather than resolved by accident", () => {
  const workspace = makeWorkspace();
  try {
    const authority = new HostPathAuthority(workspace.mounts, process.platform);
    const result = authority.canonicalize("Z:\\somewhere\\else.txt", { mustExist: false });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.failure.rejection, "UNKNOWN_MOUNT");
  } finally {
    workspace.dispose();
  }
});

test("containment is proven after link resolution, not before", { skip: process.platform === "win32" ? "junction creation needs a native Windows run" : false }, () => {
  const workspace = makeWorkspace();
  try {
    const outside = join(workspace.host, "..", `polaris-outside-${newId()}`);
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "not yours", "utf8");
    symlinkSync(outside, workspace.hostPath("project", "linkdir"));

    const authority = new HostPathAuthority(workspace.mounts, process.platform);
    const viaLink = authority.containedIn(workspace.logical, workspace.path("project", "linkdir", "secret.txt"), {
      mustExist: true,
    });
    assert.equal(viaLink.ok, false);
    if (!viaLink.ok) assert.equal(viaLink.failure.rejection, "SYMLINK_ESCAPE");
  } finally {
    workspace.dispose();
  }
});

test("the authority states honestly whether it has native Windows semantics", () => {
  const workspace = makeWorkspace();
  try {
    const authority = new HostPathAuthority(workspace.mounts, process.platform);
    assert.equal(authority.nativeWindowsSemantics, process.platform === "win32");
  } finally {
    workspace.dispose();
  }
});
