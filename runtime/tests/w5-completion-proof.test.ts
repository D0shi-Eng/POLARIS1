// W5 / D — إثبات الإنجاز الأدنى.
//
// السؤال الوحيد: هل يستطيع النظام أن يقول «وقع الأثر المطلوب» ويسند قوله؟
// لذلك كل اختبار هنا يقارن حالتين متجاورتين: مهمة انتهت، وإثبات قد يقول نعم
// أو لا. تساويهما دائمًا يعني أن الإثبات لا يقيس شيئًا.

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";

import { ScriptedModel } from "../src/model/fixture-model.js";
import { W5ErrorCode } from "../src/errors.js";
import type { AuditLedgerRecord } from "../src/audit/ledger/record.js";
import type { Doc } from "../src/policy/types.js";
import { makeWorkspace } from "./w4-helpers.js";
import { buildW5Runtime, requireArtefact, startMission, writeThenFinish } from "./w5-helpers.js";

const FINISH_ONLY = [JSON.stringify({ action: "finish", summary: "I have written the summary." })];

test("the happy path proves the effect, and the proof cites the grant, the executor and the chain", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(writeThenFinish(target, "a real summary") as string[]),
    });

    const mission = startMission(runtime, {
      title: "write the summary",
      instruction: "Write the summary file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);
    assert.equal(result.status, "COMPLETED");

    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);

    assert.equal(proof.status, "PROVEN", `${String(proof.reason_code)}: ${proof.detail}`);
    assert.equal(proof.reason_code, null);
    assert.ok(proof.evidence.execution_grant_id !== null, "the proof must name the grant it rests on");
    assert.equal(proof.evidence.executor_status, "SUCCESS");
    assert.equal(proof.evidence.audit_chain_verified, true);
    assert.equal(proof.evidence.audit_chain_binder, "HASH_CHAIN_ONLY");
    assert.ok(proof.evidence.observed_target?.exists);
    assert.ok(proof.evidence.audit_event_refs.length >= 2);
    assert.equal(proof.evidence.reobserved_content_sha256, proof.evidence.executor_content_sha256);
    assert.ok(proof.evidence.reobservation_invocation_id !== null, "the confirming read must itself be an invocation");
  } finally {
    workspace.dispose();
  }
});

test("'the model says done' with no artefact is COMPLETED and NOT_PROVEN at the same time", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(FINISH_ONLY),
    });

    const mission = startMission(runtime, {
      title: "claim without doing",
      instruction: "Write the summary file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    const result = await runtime.runMission(mission);

    // حالة المهمة تقول اكتملت. هذا صحيح: الحلقة انتهت طبيعيًا.
    assert.equal(result.status, "COMPLETED");
    assert.equal(result.termination, "FINISHED");
    assert.equal(result.summary, "I have written the summary.");

    // وحالة الإثبات تقول لا. الحقلان مستقلان، وهذا هو الغرض من الفصل.
    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_TARGET_MISSING);
  } finally {
    workspace.dispose();
  }
});

test("an artefact that exists but was not produced by an authorised grant is NOT_PROVEN", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    // شيء آخر تمامًا كتب الملف. وجوده ليس نسبةً إلى مهمة.
    writeFileSync(workspace.hostPath("out", "summary.txt"), "planted by something else", "utf8");

    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(FINISH_ONLY),
    });
    const mission = startMission(runtime, {
      title: "claim someone else's work",
      instruction: "Write the summary file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_EFFECT_NOT_PROVEN);
    assert.ok(proof.evidence.observed_target?.exists);
    assert.equal(proof.evidence.execution_grant_id, null);
  } finally {
    workspace.dispose();
  }
});

test("a requirement naming a different target than the one written is NOT_PROVEN", async () => {
  const workspace = makeWorkspace();
  try {
    const written = workspace.path("out", "summary.txt");
    const expected = workspace.path("out", "report.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(writeThenFinish(written, "a real summary") as string[]),
    });

    const mission = startMission(runtime, {
      title: "write the wrong file",
      instruction: "Write the report file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    const proof = await runtime.prove(requireArtefact(mission.mission_id, expected), mission);
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_TARGET_MISSING);
  } finally {
    workspace.dispose();
  }
});

test("an artefact changed after the authorised write is NOT_PROVEN", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(writeThenFinish(target, "the authorised content") as string[]),
    });

    const mission = startMission(runtime, {
      title: "write then be tampered with",
      instruction: "Write the summary file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    // شيء خارج المسار المصرَّح به يغيّر الملف بعد الكتابة.
    writeFileSync(workspace.hostPath("out", "summary.txt"), "content nobody authorised", "utf8");

    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_EFFECT_NOT_PROVEN);
    assert.notEqual(proof.evidence.reobserved_content_sha256, proof.evidence.executor_content_sha256);
  } finally {
    workspace.dispose();
  }
});

test("a broken audit chain forces NOT_PROVEN whatever the filesystem says", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(writeThenFinish(target, "a real summary") as string[]),
    });

    const mission = startMission(runtime, {
      title: "write the summary",
      instruction: "Write the summary file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);

    // الأثر وقع فعلًا، ولكن الدفتر عُبث به. الإثبات يجب أن ينهار مع الدفتر.
    const records = runtime.audit.chain.records() as readonly AuditLedgerRecord[];
    const victim = records[1];
    assert.ok(victim !== undefined);
    (victim.event as Doc)["metadata"] = { tampered: "true" };

    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);
    assert.equal(proof.status, "NOT_PROVEN");
    assert.equal(proof.reason_code, W5ErrorCode.COMPLETION_AUDIT_CHAIN_INVALID);
    assert.equal(proof.evidence.audit_chain_verified, false);
  } finally {
    workspace.dispose();
  }
});

test("the proof is recorded in the chain it rests on, with its status and reason", async () => {
  const workspace = makeWorkspace();
  try {
    const target = workspace.path("out", "summary.txt");
    const { runtime } = buildW5Runtime({
      workspace,
      writeRoots: [workspace.path("out")],
      model: new ScriptedModel(FINISH_ONLY),
    });
    const mission = startMission(runtime, {
      title: "claim without doing",
      instruction: "Write the summary file.",
      authorization: { authorized_read_roots: [workspace.logical], authorized_write_roots: [workspace.path("out")] },
    });
    await runtime.runMission(mission);
    const proof = await runtime.prove(requireArtefact(mission.mission_id, target), mission);

    const recorded = runtime.audit
      .forCorrelation(mission.correlation_id)
      .find((e) => e["event_type"] === "COMPLETION_PROOF_FAILED");
    assert.ok(recorded !== undefined, "a failed proof must still be recorded");
    const metadata = recorded["metadata"] as Record<string, string>;
    assert.equal(metadata["completion_proof_id"], proof.completion_proof_id);
    assert.equal(metadata["proof_status"], "NOT_PROVEN");
    assert.equal(metadata["reason_code"], W5ErrorCode.COMPLETION_TARGET_MISSING);
    assert.equal(runtime.audit.rejected().length, 0, JSON.stringify(runtime.audit.rejected()));
  } finally {
    workspace.dispose();
  }
});
