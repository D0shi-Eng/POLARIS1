// حارس العيب P01_TEST_SUMMARY_NOT_PARSED_ON_WINDOWS.
// الشكل الحقيقي الذي أنتجه Node 24 على المضيف الأصلي هو spec بنهايات CRLF.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { childEnvironment, nodeInvocation, parseCargoSummary, parseTapSummary } from "../p01-test-groups.mjs";
import { P01_GROUPS } from "../p01-groups.mjs";

const SPEC_WINDOWS = "✔ a (1ms)\r\nℹ tests 16\r\nℹ suites 0\r\nℹ pass 16\r\nℹ fail 0\r\nℹ cancelled 0\r\nℹ skipped 0\r\nℹ todo 0\r\nℹ duration_ms 184.7\r\n";
const TAP = "ok 1 - a\n1..1\n# tests 1\n# suites 0\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";

test("REGRESSION: the exact Windows spec shape with CRLF is read with exact counts", () => {
  assert.deepEqual(parseTapSummary(SPEC_WINDOWS), { tests: 16, passed: 16, failed: 0, skipped: 0, todo: 0, cancelled: 0 });
});

test("the TAP shape is still read", () => {
  assert.deepEqual(parseTapSummary(TAP), { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0 });
});

test("no summary stays null, never zero", () => {
  assert.equal(parseTapSummary("✔ a\r\n").tests, null);
  assert.equal(parseTapSummary("tests 5\n").tests, null);
});

test("the reporter flag is placed before the test files, and no shell is used", () => {
  for (const group of P01_GROUPS.filter((g) => g.kind === "node")) {
    const { command, args } = nodeInvocation(group, "/node");
    assert.equal(command, "/node");
    const reporter = args.indexOf("--test-reporter=tap");
    const firstFile = args.findIndex((a) => !a.startsWith("--"));
    assert.ok(args[0] === "--test" && reporter > 0 && reporter < firstFile, `${group.id}: ${args.join(" ")}`);
  }
});

test("no group still depends on npm or a shell", () => {
  assert.deepEqual([...new Set(P01_GROUPS.map((g) => g.kind))].sort(), ["cargo", "node", "probe"]);
});

test("NODE_TEST_CONTEXT is stripped from the child environment", () => {
  assert.equal("NODE_TEST_CONTEXT" in childEnvironment({ NODE_TEST_CONTEXT: "child", A: "1" }), false);
});

test("MEASUREMENT: the built invocation yields a readable summary on this host's Node", () => {
  const dir = mkdtempSync(join(tmpdir(), "p01-tg-"));
  writeFileSync(join(dir, "x.test.cjs"), 'require("node:test").test("x", () => {});\n');
  const { command, args } = nodeInvocation({ command: ["node", "--test", "x.test.cjs"] });
  const run = spawnSync(command, args, { cwd: dir, encoding: "utf8", env: childEnvironment() });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(parseTapSummary(run.stdout).passed, 1);
});

test("the cargo parser is unchanged", () => {
  const out = "test result: ok. 53 passed; 0 failed; 0 ignored; 0 measured; 0 filtered out; finished in 0.1s\r\n";
  assert.equal(parseCargoSummary(out).tests, 53);
});
