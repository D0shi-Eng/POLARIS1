// التكامل: Config → Effective Config → PDP → PolicyDecisionV1.
// الادعاء المركزي هنا أن القرار يمر فعلًا عبر حد خدمة الإعدادات، وأن مخرجه مستند
// عقد صالح يحترم ثوابت W2 العابرة للعقود.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { invariantViolations, validateContract } from "@polaris/contracts";

import { ConfigService } from "../src/config/service.js";
import { LocalPdp } from "../src/policy/pdp.js";
import {
  descriptorBrokeredFetch,
  descriptorReadFile,
  invocationNetworkFetch,
  invocationReadFile,
  runtimeSrcPath,
  BROKERED_DESTINATION_KEY,
  type Doc,
} from "./helpers.js";

const enableEgress = {
  changeset_id: "enable-egress",
  origin: "CORE" as const,
  changes: [
    { key: "polaris.network.brokered_egress.enabled", scope: "USER" as const, value: true },
    { key: "polaris.network.brokered_egress.allowed_destinations", scope: "USER" as const, value: [BROKERED_DESTINATION_KEY] },
  ],
};

test("an ALLOW decision is a valid PolicyDecisionV1", () => {
  const outcome = new LocalPdp(new ConfigService()).decide({
    invocation: invocationReadFile(),
    descriptor: descriptorReadFile(),
  });
  const result = validateContract("PolicyDecisionV1", outcome.decision);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
});

test("a DENY decision is a valid PolicyDecisionV1", () => {
  const outcome = new LocalPdp(new ConfigService()).decide({
    invocation: invocationNetworkFetch(),
    descriptor: descriptorBrokeredFetch(),
  });
  const result = validateContract("PolicyDecisionV1", outcome.decision);
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.errors, null, 2));
});

test("every decision the PDP can produce validates against the contract", () => {
  const cases: Array<[ConfigService, Doc, Doc]> = [];
  const healthy = new ConfigService();
  cases.push([healthy, invocationReadFile(), descriptorReadFile()]);
  cases.push([healthy, invocationNetworkFetch(), descriptorBrokeredFetch()]);

  const withEgress = new ConfigService();
  withEgress.apply(enableEgress);
  cases.push([withEgress, invocationNetworkFetch(), descriptorBrokeredFetch()]);

  const degraded = ConfigService.fromLayers([
    { schema_version: "1.0", scope: "USER", values: { "polaris.future.privileged_mode": true } },
  ]);
  cases.push([degraded, invocationReadFile(), descriptorReadFile()]);

  const broken = invocationReadFile();
  delete broken["caller_identity"];
  cases.push([healthy, broken, descriptorReadFile()]);

  for (const [config, invocation, descriptor] of cases) {
    const outcome = new LocalPdp(config).decide({ invocation, descriptor });
    const result = validateContract("PolicyDecisionV1", outcome.decision);
    assert.ok(result.ok, `decision invalid: ${JSON.stringify(result.ok ? {} : result.errors)}`);
  }
});

test("a valid atomic changeset flips the effective decision from DENY to ALLOW", () => {
  const config = new ConfigService();
  const pdp = new LocalPdp(config);
  const request = { invocation: invocationNetworkFetch(), descriptor: descriptorBrokeredFetch() };

  assert.equal(pdp.decide(request).decision["result"], "DENY");
  assert.equal(config.apply(enableEgress).applied, true);
  assert.equal(pdp.decide(request).decision["result"], "ALLOW");
});

test("a REJECTED changeset does not change the decision: the resolver cannot be bypassed", () => {
  const config = new ConfigService();
  const pdp = new LocalPdp(config);
  const request = { invocation: invocationNetworkFetch(), descriptor: descriptorBrokeredFetch() };
  assert.equal(pdp.decide(request).decision["result"], "DENY");

  // ذرّية: أحد التغييرين باطل، فلا يُطبَّق أي منهما، ويبقى القرار رفضًا.
  const partial = config.apply({
    changeset_id: "half-valid",
    origin: "CORE",
    changes: [
      { key: "polaris.network.brokered_egress.enabled", scope: "USER", value: true },
      { key: "polaris.network.brokered_egress.allowed_destinations", scope: "USER", value: ["not a destination"] },
    ],
  });
  assert.equal(partial.applied, false);
  assert.equal(config.get("polaris.network.brokered_egress.enabled"), false);
  assert.equal(pdp.decide(request).decision["result"], "DENY");
});

test("tightening configuration flips an ALLOW back to a DENY", () => {
  const config = new ConfigService();
  const pdp = new LocalPdp(config);
  const request = { invocation: invocationReadFile(), descriptor: descriptorReadFile() };
  assert.equal(pdp.decide(request).decision["result"], "ALLOW");

  assert.equal(
    config.apply({
      changeset_id: "narrow-roots",
      origin: "CORE",
      changes: [{ key: "polaris.filesystem.allowed_read_roots", scope: "USER", value: ["D:\\SOMEWHERE_ELSE"] }],
    }).applied,
    true,
  );
  const after = pdp.decide(request);
  assert.equal(after.decision["result"], "DENY");
  assert.deepEqual(after.decision["reason_codes"], ["RESOURCE_OUT_OF_SCOPE"]);
});

test("correlation and invocation identity survive from invocation into the decision", () => {
  const invocation = invocationReadFile();
  const outcome = new LocalPdp(new ConfigService()).decide({ invocation, descriptor: descriptorReadFile() });
  assert.equal(outcome.decision["correlation_id"], invocation["correlation_id"]);
  assert.equal(outcome.decision["invocation_id"], invocation["invocation_id"]);
  assert.equal(outcome.decision["causation_id"], invocation["invocation_id"]);
});

test("decisions satisfy the W2 cross-contract invariants, obligations included", () => {
  const config = new ConfigService();
  config.apply(enableEgress);
  for (const [invocation, descriptor] of [
    [invocationReadFile(), descriptorReadFile()],
    [invocationNetworkFetch(), descriptorBrokeredFetch()],
  ] as Array<[Doc, Doc]>) {
    const outcome = new LocalPdp(config).decide({ invocation, descriptor });
    assert.deepEqual(invariantViolations({ descriptor, invocation, decision: outcome.decision }), []);
  }
});

test("an obligation never raises the output ceiling above what the invocation carries", () => {
  const config = new ConfigService();
  config.apply({
    changeset_id: "raise-ceiling",
    origin: "CORE",
    changes: [{ key: "polaris.execution.max_output_bytes", scope: "USER", value: 1073741824 }],
  });
  const invocation = invocationReadFile();
  const ceiling = (invocation["execution_constraints"] as Doc)["max_output_bytes"] as number;
  const outcome = new LocalPdp(config).decide({ invocation, descriptor: descriptorReadFile() });
  const maxBytes = (outcome.decision["obligations"] as Doc[]).find((o) => o["type"] === "MAX_BYTES");
  assert.equal(maxBytes?.["max_bytes"], ceiling);
});

test("the audit obligation level follows configuration", () => {
  const config = new ConfigService();
  const pdp = new LocalPdp(config);
  const request = { invocation: invocationReadFile(), descriptor: descriptorReadFile() };
  const audit = (decision: Doc): unknown =>
    (decision["obligations"] as Doc[]).find((o) => o["type"] === "AUDIT")?.["level"];

  assert.equal(audit(pdp.decide(request).decision), "STANDARD");
  config.apply({
    changeset_id: "detailed-audit",
    origin: "CORE",
    changes: [{ key: "polaris.audit.detail_level", scope: "USER", value: "DETAILED" }],
  });
  assert.equal(audit(pdp.decide(request).decision), "DETAILED");
});

test("every decision is marked non-cacheable, because it depends on argument values", () => {
  const config = new ConfigService();
  for (const [invocation, descriptor] of [
    [invocationReadFile(), descriptorReadFile()],
    [invocationNetworkFetch(), descriptorBrokeredFetch()],
  ] as Array<[Doc, Doc]>) {
    const outcome = new LocalPdp(config).decide({ invocation, descriptor });
    assert.deepEqual(outcome.decision["cacheability"], { cacheable: false });
  }
});

test("the policy layer reads no file and opens no socket: configuration arrives only through the service", () => {
  // ادعاء بنيوي قابل للإثبات: لا استيراد لنظام ملفات أو شبكة في طبقة السياسة كلها.
  const directory = join(runtimeSrcPath(), "policy");
  const forbidden = /from\s+"node:(fs|net|http|https|dns|child_process)("|\/)/;
  for (const file of readdirSync(directory).filter((f) => f.endsWith(".ts"))) {
    const source = readFileSync(join(directory, file), "utf8");
    assert.equal(forbidden.test(source), false, `policy/${file} reaches outside the Config Service boundary`);
  }
});

test("the PDP performs no side effect: it returns a decision and changes no configuration", () => {
  const config = new ConfigService();
  const before = JSON.stringify(config.effective());
  new LocalPdp(config).decide({ invocation: invocationReadFile(), descriptor: descriptorReadFile() });
  assert.equal(JSON.stringify(config.effective()), before);
});

test("two decisions on the same input differ only in decision identity and timestamp", () => {
  const pdp = new LocalPdp(new ConfigService());
  const request = { invocation: invocationReadFile(), descriptor: descriptorReadFile() };
  const strip = (d: Doc): string => {
    const { decision_id: _id, decided_at: _at, ...rest } = d;
    return JSON.stringify(rest);
  };
  assert.equal(strip(pdp.decide(request).decision), strip(pdp.decide(request).decision));
});
