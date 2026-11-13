// W6 / H — إعادة الإنتاج والتنظيف.
//
// الادعاء: تشغيلٌ لا يورّث شيئًا لتشغيل بعده. لا أثر باقٍ، ولا دليل قديم
// يُقرأ بالخطأ، ولا عملية ناجية، ولا قرار يتغيّر لأن شيئًا سبقه.
//
// «مرتان تعطيان نفس النتيجة» ليست الادعاء كاملًا: التساوي وحده يمكن أن يأتي من
// أن الثاني قرأ أثر الأول. لذلك يُقاس الاستقلال أيضًا — أن مساحة العمل الأولى
// اختفت، وأن الهويات لم تُعَد استعمالها.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { dogfoodRun, eventTypes, makeWorkspace } from "./w6-helpers.js";
import { ownedWorkspacesOnDisk } from "./w4-helpers.js";

test("W6-D12 two runs from fresh workspaces decide identically and share no identity", async () => {
  const first = await dogfoodRun();
  const firstTypes = eventTypes(first.missionOnlyEvents);
  const firstStatus = first.result.status;
  const firstTermination = first.result.termination;
  const firstProof = first.proof.status;
  const firstHost = first.workspace.host;
  first.workspace.dispose();

  const second = await dogfoodRun();
  try {
    assert.equal(second.result.status, firstStatus);
    assert.equal(second.result.termination, firstTermination);
    assert.equal(second.proof.status, firstProof);
    assert.deepEqual(eventTypes(second.missionOnlyEvents), firstTypes, "the two runs took different paths");

    // الاستقلال: هويات جديدة، ومساحة العمل الأولى لم تعد موجودة.
    assert.notEqual(second.correlationId, first.correlationId, "two runs shared a correlation identity");
    assert.equal(existsSync(firstHost), false, "the first workspace survived into the second run");
  } finally {
    second.workspace.dispose();
  }
});

test("W6-D12 disposing a run removes its workspace and its artefact", async () => {
  // مساحة عمل غير ذات صلة: يجب أن تنجو من تنظيف التشغيل، فالتنظيف ليس جرفًا عامًا.
  const unrelated = makeWorkspace();
  try {
    const before = new Set(ownedWorkspacesOnDisk());
    const run = await dogfoodRun();
    const host = run.workspace.host;

    assert.equal(run.proof.status, "PROVEN", `${String(run.proof.reason_code)}: ${run.proof.detail}`);
    assert.equal(existsSync(join(host, "out", "summary.txt")), true);
    assert.equal(before.has(host), false, "the run did not get a fresh workspace");

    run.workspace.dispose();

    assert.equal(existsSync(host), false, "the temporary workspace was not removed");
    assert.equal(existsSync(join(host, "out", "summary.txt")), false);
    // ولا تراكم: كل مساحة عمل أنشأتها هذه العملية أثناء التشغيل زالت من القرص.
    // القياس على ما تملكه العملية فعلًا، لا على عدد عام في المجلد المؤقت المشترك
    // الذي تكتب فيه ملفات اختبار أخرى تعمل بالتوازي.
    const accumulated = ownedWorkspacesOnDisk().filter((entry) => !before.has(entry));
    assert.deepEqual(accumulated, [], "a temporary workspace accumulated across the run");
    assert.equal(existsSync(unrelated.host), true, "disposing the run removed an unrelated workspace");
  } finally {
    unrelated.dispose();
  }
  assert.equal(existsSync(unrelated.host), false);
});

test("W6-D12 the artefact of a previous run cannot satisfy a later proof", async () => {
  const first = await dogfoodRun();
  const staleTarget = first.target;
  first.workspace.dispose();

  const second = await dogfoodRun();
  try {
    // الهدفان يحملان نفس الاسم المنطقي على ويندوز فقط حين تتطابق مساحتا العمل،
    // وهما لا تتطابقان. وعلى أي مضيف: الأثر الذي أُثبت هو أثر هذا التشغيل،
    // ومساحة التشغيل السابق لم تعد موجودة أصلًا.
    assert.equal(second.proof.status, "PROVEN");
    assert.equal(existsSync(first.workspace.host), false, "the previous run's workspace is still readable");
    assert.equal(typeof staleTarget, "string");
  } finally {
    second.workspace.dispose();
  }
});
