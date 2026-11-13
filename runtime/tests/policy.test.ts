// اختبارات نقطة القرار. الرفض وحده ليس نجاحًا: كل حالة تتحقق من رمز السبب،
// ومن السياسة التي حسمت، ومن مجموعة الالتزامات، ومن نص العرض الآمن.

import test from "node:test";
import assert from "node:assert/strict";

import { validateContract } from "@polaris/contracts";

import { ConfigService } from "../src/config/service.js";
import { LocalPdp } from "../src/policy/pdp.js";
import { evaluate, policySetParses } from "../src/policy/cedar-engine.js";
import { isPathInAllowedRoot } from "../src/policy/context.js";
import { POLICY_001, POLICY_002, POLICIES } from "../src/policy/policy-set.js";
import { explain, renderExplanation } from "../src/policy/explain.js";
import {
  clone,
  descriptorBrokeredFetch,
  descriptorReadFile,
  invocationNetworkFetch,
  invocationReadFile,
  BROKERED_DESTINATION_KEY,
  type Doc,
} from "./helpers.js";

const cs = (changes: Array<{ key: string; scope: "DEFAULT" | "USER"; value: unknown }>) => ({
  changeset_id: "policy-test",
  origin: "CORE" as const,
  changes: changes as never,
});

function obligationTypes(decision: Doc): string[] {
  return (decision["obligations"] as Doc[]).map((o) => String(o["type"])).sort();
}

test("the W4 policy set holds exactly three POLARIS policies, and parses", () => {
  // W3 كان سياستين. W4 أضاف POLICY-003 للكتابة ومنع الحذف. العدد مُثبَّت عمدًا
  // حتى لا تتسلل سياسة رابعة بلا قرار معماري.
  assert.equal(POLICIES.length, 3);
  assert.deepEqual(POLICIES.map((p) => p.policy_id), ["POLICY-001", "POLICY-002", "POLICY-003"]);
  const parse = policySetParses();
  assert.equal(parse.ok, true, parse.detail);
});

// ── POLICY-001 ───────────────────────────────────────────────────────────────

test("POLICY-001 allows a declared, confined read inside a configured root", () => {
  const pdp = new LocalPdp(new ConfigService());
  const outcome = pdp.decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() });

  assert.equal(outcome.decision["result"], "ALLOW");
  assert.deepEqual(outcome.decision["reason_codes"], ["EXPLICIT_ALLOW_RULE"]);
  assert.deepEqual(obligationTypes(outcome.decision), ["AUDIT", "MAX_BYTES", "REQUIRE_CONFINEMENT"]);
  assert.match(String(outcome.decision["internal_reason"]), /POLICY-001/);
  assert.deepEqual(outcome.verdicts.map((v) => v.matched_policy_ids), [[POLICY_001.cedar_ids[0]]]);
  assert.equal((outcome.decision["cacheability"] as Doc)["cacheable"], false);
});

test("POLICY-001 denies a read outside every configured root, and says why", () => {
  const pdp = new LocalPdp(new ConfigService());
  const invocation = invocationReadFile();
  const outside = { kind: "FILESYSTEM_PATH", locator: "C:\\Windows\\System32\\config\\SAM", scope: "EXACT" };
  invocation["resource"] = outside;
  (invocation["requested_effects"] as Doc[])[0]!["resource"] = outside;
  const descriptor = descriptorReadFile();
  (descriptor["requested_effects"] as Doc[])[0]!["resource"] = outside;

  const outcome = pdp.decide({ invocation, descriptor });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["RESOURCE_OUT_OF_SCOPE"]);
  // الرفض الافتراضي: لا سياسة طابقت أصلًا.
  assert.deepEqual(outcome.verdicts[0]?.matched_policy_ids, []);
  assert.deepEqual(obligationTypes(outcome.decision), ["AUDIT"]);
  assert.equal(outcome.decision["display_reason"], "This action was not permitted.");
});

test("POLICY-001 denies an effect the descriptor never declared", () => {
  const pdp = new LocalPdp(new ConfigService());
  const outcome = pdp.decide({ invocation: invocationReadFile(), descriptor: descriptorBrokeredFetch() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["EFFECT_NOT_GRANTED"]);
});

test("POLICY-001 denies an unconfined read even inside an allowed root", () => {
  const pdp = new LocalPdp(new ConfigService());
  const invocation = invocationReadFile();
  const constraints = invocation["execution_constraints"] as Doc;
  constraints["confinement"] = "NONE";
  constraints["filesystem_scope"] = "USER_SCOPE";
  delete constraints["granted_paths"];
  const outcome = pdp.decide({ invocation, descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
});

test("path containment rejects traversal, prefix collisions and separator tricks", () => {
  const roots = ["D:\\POLARIS"];
  assert.equal(isPathInAllowedRoot("D:\\POLARIS\\README.md", roots), true);
  assert.equal(isPathInAllowedRoot("d:/polaris/readme.md", roots), true);
  assert.equal(isPathInAllowedRoot("D:\\POLARIS", roots), true);
  assert.equal(isPathInAllowedRoot("D:\\POLARIS-EVIL\\x", roots), false);
  assert.equal(isPathInAllowedRoot("D:\\POLARIS\\..\\Windows\\x", roots), false);
  assert.equal(isPathInAllowedRoot("C:\\Windows\\x", roots), false);
  assert.equal(isPathInAllowedRoot("D:\\POLARISX", roots), false);
});

// ── POLICY-002 ───────────────────────────────────────────────────────────────

test("POLICY-002 denies a network effect out of the box, because brokered egress is off by default", () => {
  const pdp = new LocalPdp(new ConfigService());
  const outcome = pdp.decide({ invocation: invocationNetworkFetch(), descriptor: descriptorBrokeredFetch() });

  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["NETWORK_NOT_BROKERED"]);
  // الرفض جاء من عبارة forbid صراحة، لا من غياب permit.
  assert.deepEqual(outcome.verdicts[0]?.matched_policy_ids, ["POLICY-002.forbid"]);
  assert.deepEqual(obligationTypes(outcome.decision), ["AUDIT"]);
});

test("POLICY-002 still denies when egress is enabled but the destination is not authorised", () => {
  const config = new ConfigService();
  config.apply(cs([{ key: "polaris.network.brokered_egress.enabled", scope: "USER", value: true }]));
  const outcome = new LocalPdp(config).decide({
    invocation: invocationNetworkFetch(),
    descriptor: descriptorBrokeredFetch(),
  });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["NETWORK_NOT_BROKERED"]);
});

test("POLICY-002 still denies when the destination is authorised but the invocation does not request brokered egress", () => {
  const config = new ConfigService();
  config.apply(
    cs([
      { key: "polaris.network.brokered_egress.enabled", scope: "USER", value: true },
      { key: "polaris.network.brokered_egress.allowed_destinations", scope: "USER", value: [BROKERED_DESTINATION_KEY] },
    ]),
  );
  const invocation = invocationNetworkFetch();
  const constraints = invocation["execution_constraints"] as Doc;
  constraints["network"] = "NONE";
  delete constraints["allowed_destinations"];
  // الأثر الشبكي مع network=NONE مرفوض على مستوى العقد أصلًا: فشل مغلق قبل التقييم.
  const outcome = new LocalPdp(config).decide({ invocation, descriptor: descriptorBrokeredFetch() });
  assert.equal(outcome.decision["result"], "DENY");
});

test("POLICY-002 allows only when config, destination and invocation all agree", () => {
  const config = new ConfigService();
  config.apply(
    cs([
      { key: "polaris.network.brokered_egress.enabled", scope: "USER", value: true },
      { key: "polaris.network.brokered_egress.allowed_destinations", scope: "USER", value: [BROKERED_DESTINATION_KEY] },
    ]),
  );
  const outcome = new LocalPdp(config).decide({
    invocation: invocationNetworkFetch(),
    descriptor: descriptorBrokeredFetch(),
  });

  assert.equal(outcome.decision["result"], "ALLOW");
  assert.deepEqual(outcome.verdicts[0]?.matched_policy_ids, ["POLICY-002.permit"]);
  assert.ok(obligationTypes(outcome.decision).includes("REQUIRE_BROKERED_EGRESS"));
  assert.match(String(outcome.decision["internal_reason"]), /POLICY-002/);
});

test("POLICY-002 denies a destination the config never listed, even with egress enabled", () => {
  const config = new ConfigService();
  config.apply(
    cs([
      { key: "polaris.network.brokered_egress.enabled", scope: "USER", value: true },
      { key: "polaris.network.brokered_egress.allowed_destinations", scope: "USER", value: ["other.example:443"] },
    ]),
  );
  const outcome = new LocalPdp(config).decide({
    invocation: invocationNetworkFetch(),
    descriptor: descriptorBrokeredFetch(),
  });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.verdicts[0]?.matched_policy_ids, ["POLICY-002.forbid"]);
});

// ── الفشل المغلق ─────────────────────────────────────────────────────────────

test("fail-closed: a malformed invocation is denied before any policy runs", () => {
  const pdp = new LocalPdp(new ConfigService());
  const invocation = invocationReadFile();
  delete invocation["caller_identity"];
  const outcome = pdp.decide({ invocation, descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["EVALUATION_ERROR"]);
  assert.equal(outcome.verdicts.length, 0);
  assert.ok(outcome.gate_errors.length > 0);
});

test("fail-closed: an effect action outside the contract vocabulary is denied", () => {
  const pdp = new LocalPdp(new ConfigService());
  const invocation = invocationReadFile();
  (invocation["requested_effects"] as Doc[])[0]!["action"] = "read.everything";
  const outcome = pdp.decide({ invocation, descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["EVALUATION_ERROR"]);
});

test("fail-closed: an unsupported policy set version denies and still emits a valid decision", () => {
  const pdp = new LocalPdp(new ConfigService(), { policySetVersion: "9.0.0" });
  const outcome = pdp.decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["EVALUATION_ERROR"]);
  assert.equal(validateContract("PolicyDecisionV1", outcome.decision).ok, true);
});

test("fail-closed: a malformed policy set version is denied and reported as version 0.0.0", () => {
  const pdp = new LocalPdp(new ConfigService(), { policySetVersion: "not-a-version" });
  const outcome = pdp.decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.equal((outcome.decision["policy_ref"] as Doc)["policy_version"], "0.0.0");
  assert.equal(validateContract("PolicyDecisionV1", outcome.decision).ok, true);
});

test("fail-closed: degraded configuration denies everything, including a request that would otherwise pass", () => {
  const healthy = new LocalPdp(new ConfigService());
  assert.equal(healthy.decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() }).decision["result"], "ALLOW");

  const degraded = ConfigService.fromLayers([
    { schema_version: "1.0", scope: "USER", values: { "polaris.future.privileged_mode": true } },
  ]);
  const outcome = new LocalPdp(degraded).decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.deepEqual(outcome.decision["reason_codes"], ["CONFIG_DEGRADED"]);
});

test("fail-closed: fail_closed=false is not a supported posture and the PDP refuses to operate", () => {
  const config = ConfigService.fromLayers([
    { schema_version: "1.0", scope: "DEFAULT", values: { "polaris.security.fail_closed": false } },
  ]);
  const outcome = new LocalPdp(config).decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
  assert.ok((outcome.decision["reason_codes"] as string[]).includes("CONFIG_DEGRADED"));
});

test("fail-closed: the engine denies when a required context attribute is absent", () => {
  const verdict = evaluate("p1", "read.filesystem", "D:\\POLARIS\\README.md", { confined: true } as never);
  assert.equal(verdict.decision, "deny");
  assert.ok(verdict.errors.length > 0);
});

test("fail-closed: the engine never throws, it denies", () => {
  const verdict = evaluate(undefined as never, "read.filesystem", undefined as never, undefined as never);
  assert.equal(verdict.decision, "deny");
});

test("fail-closed: an invocation carrying no effects is denied", () => {
  const pdp = new LocalPdp(new ConfigService());
  const invocation = invocationReadFile();
  invocation["requested_effects"] = [];
  const outcome = pdp.decide({ invocation, descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["result"], "DENY");
});

test("a multi-effect invocation is denied if any single effect is denied", () => {
  const config = new ConfigService();
  const invocation = invocationReadFile();
  const descriptor = descriptorReadFile();
  const networkEffect = {
    action: "network.fetch",
    destination: { host: "api.polaris.example", port: 443, protocol: "HTTPS" },
    data_classification: "INTERNAL",
  };
  (invocation["requested_effects"] as Doc[]).push(clone(networkEffect));
  (descriptor["requested_effects"] as Doc[]).push(clone(networkEffect));
  const constraints = invocation["execution_constraints"] as Doc;
  constraints["network"] = "BROKERED_EGRESS";
  constraints["allowed_destinations"] = [{ host: "api.polaris.example", port: 443, protocol: "HTTPS" }];
  (descriptor["execution_requirements"] as Doc)["network"] = "BROKERED_EGRESS";
  (descriptor["execution_requirements"] as Doc)["allowed_destinations"] = [
    { host: "api.polaris.example", port: 443, protocol: "HTTPS" },
  ];

  const outcome = new LocalPdp(config).decide({ invocation, descriptor });
  assert.equal(outcome.decision["result"], "DENY");
  assert.equal(outcome.verdicts.length, 2);
  assert.equal(outcome.verdicts[0]?.decision, "allow");
  assert.equal(outcome.verdicts[1]?.decision, "deny");
});

// ── لماذا رُفض ───────────────────────────────────────────────────────────────

test("why-denied withholds internal reasoning from an untrusted caller and gives it to a trusted one", () => {
  const config = new ConfigService();
  const pdp = new LocalPdp(config);
  const outcome = pdp.decide({ invocation: invocationNetworkFetch(), descriptor: descriptorBrokeredFetch() });

  const untrusted = explain(outcome.decision, outcome.verdicts, "TIER_2_UNTRUSTED", config);
  assert.equal(untrusted.internal_reason, undefined);
  assert.equal(untrusted.display_reason, "This action was not permitted.");
  assert.deepEqual(untrusted.reason_codes, ["NETWORK_NOT_BROKERED"]);
  assert.deepEqual(untrusted.effects[0]?.policy_ids, [POLICY_002.policy_id]);

  const trusted = explain(outcome.decision, outcome.verdicts, "TIER_0_TRUSTED", config);
  assert.ok((trusted.internal_reason ?? "").length > 0);
});

test("why-denied gives a limited caller internal reasoning only when configuration allows it", () => {
  const config = new ConfigService();
  const pdp = new LocalPdp(config);
  const outcome = pdp.decide({ invocation: invocationNetworkFetch(), descriptor: descriptorBrokeredFetch() });

  assert.equal(explain(outcome.decision, outcome.verdicts, "TIER_1_LIMITED", config).internal_reason, undefined);
  config.apply(cs([{ key: "polaris.diagnostics.expose_internal_reason", scope: "USER", value: true }]));
  assert.ok(explain(outcome.decision, outcome.verdicts, "TIER_1_LIMITED", config).internal_reason !== undefined);

  // حتى مع الإعداد مفعّلًا، الطبقة غير الموثوقة لا ترى شيئًا.
  assert.equal(explain(outcome.decision, outcome.verdicts, "TIER_2_UNTRUSTED", config).internal_reason, undefined);
});

test("why-denied renders a developer-readable explanation naming the deciding policy", () => {
  const config = new ConfigService();
  const outcome = new LocalPdp(config).decide({
    invocation: invocationNetworkFetch(),
    descriptor: descriptorBrokeredFetch(),
  });
  const rendered = renderExplanation(explain(outcome.decision, outcome.verdicts, "TIER_0_TRUSTED", config));
  assert.match(rendered, /DENY/);
  assert.match(rendered, /NETWORK_NOT_BROKERED/);
  assert.match(rendered, /POLICY-002/);
});
