// Phase-07: تدقيق الوصول لكل مسار في التطبيق، بالعربية والإنجليزية، ولرموز الألوان في السمتين.
//
// كل مسار يُرسم بمضيف الاختبار الذي يملأ شاشته فعلًا (Phase-02 للمشاريع، وPhase-05
// للذاكرة، وPhase-06 للموصلات والرصد…)، ثم يُدقَّق المستند المرسوم: لكل عنصر تفاعلي اسم،
// ولا tabindex موجب، والمعرّفات فريدة، ومراجع aria موجودة، ومعلم main واحد، وh1، وسمتا
// اللغة والاتجاه. ثم يُقاس تباين أزواج النص والخلفية في السمتين بنسبة WCAG AA (4.5:1).

import "./support/dom";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { ReactElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { Phase02Client } from "../src/ipc/p02-client";
import { Phase03Client } from "../src/ipc/p03-client";
import { Phase04Client } from "../src/ipc/p04-client";
import { Phase05Client } from "../src/ipc/p05-client";
import { Phase06Client } from "../src/ipc/p06-client";
import type { Transport } from "../src/ipc/transport";
import { memoryLocation } from "../src/routes/location";
import { auditDocument, contrast, TEXT_PAIRS, themeTokens, type A11yFinding } from "./support/a11y";
import { resetDocument } from "./support/dom";
import { IDENTITY } from "./support/fake-host";
import { fakePhase02Host } from "./support/fake-p02-host";
import { fakePhase03Host, P03_IDS } from "./support/fake-p03-host";
import { fakePhase04Host } from "./support/fake-p04-host";
import { fakePhase05Host } from "./support/fake-p05-host";
import { fakePhase06Host } from "./support/fake-p06-host";

async function settle(rounds = 8): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

interface Scenario {
  readonly path: string;
  readonly host: () => Transport;
  readonly app: (transport: Transport, path: string) => ReactElement;
}

const client = (t: Transport) => new DesktopIpcClient({ transport: t, identity: IDENTITY });
const p02 = (t: Transport) => new Phase02Client({ transport: t, identity: IDENTITY });
const p03 = (t: Transport) => new Phase03Client({ transport: t, identity: IDENTITY });
const p04 = (t: Transport) => new Phase04Client({ transport: t, identity: IDENTITY });
const p05 = (t: Transport) => new Phase05Client({ transport: t, identity: IDENTITY });
const p06 = (t: Transport) => new Phase06Client({ transport: t, identity: IDENTITY });

const phase02App = (t: Transport, path: string) => <AppRoot client={client(t)} phase02={p02(t)} location={memoryLocation(path)} />;
const phase03App = (t: Transport, path: string) => <AppRoot client={client(t)} phase03={p03(t)} location={memoryLocation(path)} />;
const phase04App = (t: Transport, path: string) => <AppRoot client={client(t)} phase04={p04(t)} location={memoryLocation(path)} />;
const phase05App = (t: Transport, path: string) => <AppRoot client={client(t)} phase03={p03(t)} phase05={p05(t)} location={memoryLocation(path)} />;
const phase06App = (t: Transport, path: string) => <AppRoot client={client(t)} phase04={p04(t)} phase06={p06(t)} location={memoryLocation(path)} />;

const SCENARIOS: readonly Scenario[] = [
  { path: "/", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/projects", host: () => fakePhase02Host().transport, app: phase02App },
  { path: "/providers", host: () => fakePhase02Host().transport, app: phase02App },
  { path: "/models", host: () => fakePhase02Host().transport, app: phase02App },
  { path: "/missions", host: () => fakePhase03Host().transport, app: phase03App },
  { path: "/agents", host: () => fakePhase03Host().transport, app: phase03App },
  { path: `/missions/${P03_IDS.MISSION}`, host: () => fakePhase05Host().transport, app: phase05App },
  { path: "/skills", host: () => fakePhase04Host().transport, app: phase04App },
  { path: "/tools", host: () => fakePhase04Host().transport, app: phase04App },
  { path: "/browser-computer", host: () => fakePhase05Host().transport, app: phase05App },
  { path: "/memory", host: () => fakePhase05Host().transport, app: phase05App },
  { path: "/connectors", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/activity", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/health", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/events", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/usage", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/diagnostics", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/settings", host: () => fakePhase06Host().transport, app: phase06App },
  { path: "/settings/host", host: () => fakePhase06Host().transport, app: phase06App },
];

async function render(scenario: Scenario, locale: "en" | "ar"): Promise<{ findings: A11yFinding[]; root: Root }> {
  const container = resetDocument();
  const root = createRoot(container);
  await act(async () => {
    root.render(scenario.app(scenario.host(), scenario.path));
  });
  await settle();
  if (locale === "ar") {
    const select = document.getElementById("session-locale") as HTMLSelectElement | null;
    assert.ok(select !== null, `${scenario.path}: the language switch is absent`);
    await act(async () => {
      select.value = "ar";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle(4);
    assert.equal(document.documentElement.getAttribute("dir"), "rtl", `${scenario.path}: Arabic did not switch the document to RTL`);
  }
  return { findings: auditDocument(document), root };
}

for (const locale of ["en", "ar"] as const) {
  test(`P07-A11Y-01 every route has named controls, one main landmark, an h1, lang and dir (${locale})`, async () => {
    const report: string[] = [];
    for (const scenario of SCENARIOS) {
      const { findings, root } = await render(scenario, locale);
      for (const finding of findings) report.push(`${scenario.path} ${finding.rule}: ${finding.detail}`);
      act(() => root.unmount());
    }
    assert.deepEqual(report, [], `accessibility findings:\n${report.join("\n")}`);
  });
}

test("P07-A11Y-02 text and background tokens meet WCAG AA contrast in the light and the dark theme", () => {
  const css = readFileSync(join(process.cwd(), "src", "ui", "polaris.css"), "utf8");
  const failures: string[] = [];
  for (const [theme, selector] of [["light", '[data-theme="light"]'], ["dark", '[data-theme="dark"]']] as const) {
    const tokens = themeTokens(css, selector);
    for (const [text, background] of TEXT_PAIRS) {
      const fg = tokens[text];
      const bg = tokens[background];
      assert.ok(fg !== undefined && bg !== undefined, `${theme}: token ${text} or ${background} is not defined`);
      const ratio = contrast(fg, bg);
      if (ratio < 4.5) failures.push(`${theme} ${text} on ${background}: ${ratio.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});

test("P07-A11Y-03 keyboard focus is visible: a focus-visible outline uses the focus token", () => {
  const css = readFileSync(join(process.cwd(), "src", "ui", "polaris.css"), "utf8");
  const rule = /:focus-visible[^{]*\{[^}]*outline[^}]*var\(--focus-ring\)/.exec(css);
  assert.ok(rule !== null, "no :focus-visible rule draws an outline with --focus-ring");
});

test("P07-A11Y-04 reduced motion is honoured", () => {
  const css = readFileSync(join(process.cwd(), "src", "ui", "polaris.css"), "utf8");
  assert.ok(/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(css), "no prefers-reduced-motion rule");
});
