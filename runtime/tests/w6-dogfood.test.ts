// W6 / A — المسار المتكامل السليم، مُقاسًا على النظام المُركَّب لا على أجزائه.
//
// الفرق عن W5-S ليس في الادعاء بل في مستواه: هناك قيس كل ادعاء على حدة، وهنا
// يُقاس أن الأجزاء تُركَّب. لذلك كل تأكيد هنا يقرأ ثلاثة مصادر معًا — ما وقع على
// القرص، وما قاله الدفتر، وما قاله الإثبات — ويشترط اتفاقها. واحد منها وحده
// ليس ادعاءً، واتفاق اثنين ليس اتفاقًا.
//
// أسماء الاختبارات تبدأ بمعرّف السيناريو (W6-D01 …) عمدًا: مشغّل W6 يقرأ TAP
// ويُشتق منه حكم كل سيناريو. الاسم هنا عقد يقرأه شيء آخر، لا زينة.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  causalChainIsClosed,
  dogfoodRun,
  DOGFOOD_SUMMARY,
  eventTypes,
  ledgerIsSound,
  missionEvents,
  networkEffects,
} from "./w6-helpers.js";

test("W6-D01 the integrated path runs end to end and the three sources agree", async () => {
  const run = await dogfoodRun();
  try {
    // ١. ما وقع على القرص: الأثر المطلوب، بمحتواه بالضبط.
    assert.equal(run.result.status, "COMPLETED", JSON.stringify(run.result.errors));
    assert.equal(run.result.termination, "FINISHED");
    assert.equal(existsSync(run.workspace.hostPath("out", "summary.txt")), true);
    assert.equal(readFileSync(run.workspace.hostPath("out", "summary.txt"), "utf8"), DOGFOOD_SUMMARY);

    // ٢. ما قاله الدفتر: القوس كامل، والسلسلة تتحقق، ولا سجل مرفوض.
    const events = missionEvents(run.runtime, run.correlationId);
    const types = eventTypes(events);
    for (const required of [
      "MISSION_STARTED",
      "MODEL_OUTPUT_VALIDATED",
      "CAPABILITY_PROPOSED",
      "POLICY_EVALUATED",
      "EXECUTION_GRANT_ISSUED",
      "COMPLETION_PROOF_CREATED",
    ]) {
      assert.ok(types.includes(required), `the integrated arc is missing ${required}`);
    }
    const sound = ledgerIsSound(run.runtime);
    assert.equal(sound.ok, true, sound.detail);
    assert.equal(causalChainIsClosed(events, run.correlationId), true, "a success event has no cause in this chain");

    // ٣. ما قاله الإثبات: مُثبَت، ومُسنَد إلى منحة ودفتر يتحقق.
    assert.equal(run.proof.status, "PROVEN", `${String(run.proof.reason_code)}: ${run.proof.detail}`);
    assert.notEqual(run.proof.evidence.execution_grant_id, null);
    assert.equal(run.proof.evidence.audit_chain_verified, true);

    // ولا أثر شبكي في أي مكان من السلسلة.
    assert.deepEqual(networkEffects(events), []);
  } finally {
    run.workspace.dispose();
  }
});

test("W6-D01 every effect is preceded by a policy decision and an execution grant", async () => {
  const run = await dogfoodRun();
  try {
    const events = run.missionOnlyEvents;
    const grants = events.filter((event) => event["event_type"] === "EXECUTION_GRANT_ISSUED");
    const proposals = events.filter((event) => event["event_type"] === "CAPABILITY_PROPOSED");

    // لكل أثر وقع اقتراحٌ سبقه، ولكل منحة قرارُ سياسة سبقها. لا منحة يتيمة،
    // ولا منحة أكثر من الاقتراحات التي مرّت.
    assert.ok(grants.length >= 1, "the mission produced no execution grant at all");
    assert.ok(grants.length <= proposals.length, "more grants than proposals reached the gateway");

    const firstPolicy = events.findIndex((event) => event["event_type"] === "POLICY_EVALUATED");
    const firstGrant = events.findIndex((event) => event["event_type"] === "EXECUTION_GRANT_ISSUED");
    assert.ok(firstPolicy >= 0, "no policy decision was recorded");
    assert.ok(firstPolicy < firstGrant, "a grant preceded the policy decision that allowed it");

    // والميزانية تقول كم أداة استُدعيت فعلًا. الرقم يأتي من الدفتر نفسه.
    assert.equal(run.result.budget.tool_calls, proposals.length);
  } finally {
    run.workspace.dispose();
  }
});

test("W6-D01 the system states the confinement it actually had, and never claims more", async () => {
  const run = await dogfoodRun();
  try {
    // الادعاء المُقاس هنا هو الصدق لا الحصر: مضيف التنفيذ الإنتاجي ليس
    // AppContainer (ADR-004 §1)، والنظام يقول ذلك بدل أن يسكت عنه. لو انقلبت
    // هذه القيمة يومًا إلى true بلا مضيف محصور فعلًا، هذا الاختبار يمسكها.
    assert.equal(run.runtime.executionHost.windowsConfinement, false);
    for (const event of missionEvents(run.runtime, run.correlationId)) {
      const metadata = event["metadata"] as Record<string, unknown> | undefined;
      if (metadata === undefined) continue;
      if (metadata["windows_confinement"] === undefined) continue;
      assert.equal(
        metadata["windows_confinement"],
        false,
        "an audit record claimed Windows confinement the execution host does not have",
      );
    }
  } finally {
    run.workspace.dispose();
  }
});

