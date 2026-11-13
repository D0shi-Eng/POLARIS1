// اختبارات الشاشة: البنية، والحالات، والاتجاه، والسمة، والوصول.
//
// تهيئة DOM أولًا وقبل أي استيراد يرسم.

import "./support/dom";

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AppRoot } from "../src/app/AppRoot";
import { DesktopIpcClient } from "../src/ipc/client";
import { TransportUnavailable, type Transport } from "../src/ipc/transport";
import { memoryLocation, type LocationPort } from "../src/routes/location";
import { ROUTES } from "../src/routes/registry";
import { fakeHost, IDENTITY } from "./support/fake-host";
import { resetDocument, setSystemPrefersDark } from "./support/dom";

interface Mounted {
  readonly root: Root;
  readonly container: HTMLElement;
  readonly location: LocationPort;
  unmount(): void;
}

async function mount(transport: Transport = fakeHost(), path = "/"): Promise<Mounted> {
  const container = resetDocument();
  const root = createRoot(container);
  const location = memoryLocation(path);
  const client = new DesktopIpcClient({ transport, identity: IDENTITY });
  await act(async () => {
    root.render(<AppRoot client={client} location={location} />);
  });
  // دورة إضافية حتى تستقرّ القراءات التابعة للإقلاع.
  await act(async () => {
    await Promise.resolve();
  });
  return {
    root,
    container,
    location,
    unmount() {
      act(() => root.unmount());
    },
  };
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? "";
}

function all(selector: string): Element[] {
  return [...document.querySelectorAll(selector)];
}

// ── P01-H4 — الإقلاع والترطيب ───────────────────────────────────────────────

test("the shell hydrates from the host snapshot", async () => {
  const app = await mount();
  assert.equal(textOf(".page-title"), "Home");
  assert.equal(document.documentElement.getAttribute("lang"), "en");
  assert.equal(document.documentElement.getAttribute("dir"), "ltr");
  app.unmount();
});

// ── P01-H5 — فشل الإقلاع ────────────────────────────────────────────────────

test("a failed bootstrap shows an honest recoverable error and no invented defaults", async () => {
  const app = await mount({ async send() { throw new TransportUnavailable(); } });
  assert.match(textOf(".state__title"), /could not start/);
  assert.equal(all(".shell").length, 0, "the shell must not render as if it had booted");
  assert.ok(textOf(".state__code").includes("DEPENDENCY_UNAVAILABLE"));
  const retry = document.querySelector<HTMLButtonElement>(".state .button");
  assert.ok(retry !== null, "a failed bootstrap offers a retry");
  app.unmount();
});

test("a failed bootstrap never renders a stack or a host path", async () => {
  const app = await mount({ async send() { throw new Error("boom at D:\\POLARIS\\desktop\\host\\src\\ipc.rs:41"); } });
  const body = document.body.textContent ?? "";
  assert.ok(!body.includes("D:\\"), "a host path reached the screen");
  assert.ok(!body.includes(".rs:"), "a source location reached the screen");
  app.unmount();
});

// ── P01-N1 / P01-N2 — التنقّل ───────────────────────────────────────────────

test("every one of the ten sections is reachable and renders a titled page", async () => {
  const app = await mount();
  assert.equal(all(".nav__item").length, 10);
  for (const route of ROUTES) {
    await act(async () => {
      app.location.write(route.path);
    });
    await act(async () => {
      await Promise.resolve();
    });
    assert.notEqual(textOf(".page-title"), "", `${route.id} rendered no title`);
  }
  app.unmount();
});

test("an unknown route fails safely with the shell intact and a way back", async () => {
  const app = await mount(fakeHost(), "/not-a-section");
  assert.equal(textOf(".page-title"), "No such section");
  assert.equal(all(".shell__rail").length, 1, "the shell must survive an unknown route");
  assert.ok((document.body.textContent ?? "").includes("/not-a-section"));
  const back = document.querySelector<HTMLButtonElement>(".state .button");
  assert.ok(back !== null);
  await act(async () => back?.click());
  assert.equal(app.location.read(), "/");
  app.unmount();
});

// ── P01-U1 / P01-U2 / P01-U3 — الرئيسية ─────────────────────────────────────

test("Home shows only real host facts and no invented operational data", async () => {
  const app = await mount();
  const body = document.body.textContent ?? "";
  for (const fake of [
    "tokens saved",
    "agents running",
    "missions completed",
    "productivity",
    "security score",
    "requests today",
  ]) {
    assert.ok(!body.toLowerCase().includes(fake), `Home displayed invented data: ${fake}`);
  }
  assert.ok(body.includes("0.1.0"), "the real version is shown");
  assert.ok(body.includes("WINDOWS"));
  app.unmount();
});

test("with no models configured Home says so and offers the settings entry point", async () => {
  const app = await mount();
  const body = document.body.textContent ?? "";
  assert.ok(body.includes("No models configured"));
  assert.ok(body.includes("Manage models"));
  // ولا اسم نموذج مخترع.
  for (const invented of ["gpt", "claude", "llama", "mistral"]) {
    assert.ok(!body.toLowerCase().includes(invented), `an invented model name appeared: ${invented}`);
  }
  app.unmount();
});

test("every unavailable capability is shown with a state and a reason", async () => {
  const app = await mount();
  const pills = all(".pill").map((pill) => pill.textContent ?? "");
  const unavailable = pills.filter((text) => text.startsWith("Unavailable"));
  assert.ok(unavailable.length > 0, "no unavailable capability was rendered");
  for (const text of unavailable) {
    assert.ok(text.includes("—"), `"${text}" is unavailable with no reason`);
  }
  app.unmount();
});

test("an unbuilt section is a declared state, not a screen pretending to load", async () => {
  const app = await mount(fakeHost(), "/missions");
  assert.equal(textOf(".page-title"), "Missions");
  assert.equal(all(".state").length, 1);
  // لا زر فعل داخل حالة غير متاحة: لا شيء يوحي بأن الضغط سيفعل شيئًا.
  assert.equal(all(".state .button").length, 0);
  app.unmount();
});

// ── P01-U4 / P01-U5 — الإعدادات ─────────────────────────────────────────────

test("the settings shell opens and every setting declares a mode", async () => {
  const app = await mount(fakeHost(), "/settings");
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(textOf(".page-title"), "Settings");
  const rows = all(".settings .row");
  assert.ok(rows.length > 0, "no settings rendered");
  for (const row of rows) {
    const modes = [...row.querySelectorAll(".pill")].map((pill) => pill.textContent ?? "");
    assert.ok(
      modes.some((mode) => ["Editable", "Read only", "Not in this build"].includes(mode)),
      `a setting row declared no mode: ${row.textContent}`,
    );
  }
  app.unmount();
});

test("no control appears editable while doing nothing", async () => {
  const app = await mount(fakeHost(), "/settings");
  await act(async () => {
    await Promise.resolve();
  });
  // لا مربع اختيار ولا حقل إدخال في قشرة لا تكتب إعدادًا.
  assert.equal(all(".settings input").length, 0);
  assert.equal(all(".settings textarea").length, 0);
  assert.equal(all(".settings select").length, 0);
  // وكل زر في شجرة الإعدادات هو تنقّل بين الأقسام.
  for (const button of all(".settings button")) {
    assert.ok(button.classList.contains("nav__item"), `an unexplained control exists: ${button.textContent}`);
  }
  app.unmount();
});

test("a settings read failure surfaces as a classified error with a retry", async () => {
  const failing = fakeHost({
    failWith: { code: "DEPENDENCY_UNAVAILABLE", display_message: "desktop.error.config_unavailable", retryable: true },
    // الإقلاع ينجح والقراءة وحدها تفشل: هذا هو الفشل الجزئي الذي تصفه الشاشة.
    failOperations: ["desktop.settings.read"],
  });
  const app = await mount(failing, "/settings");
  await act(async () => {
    await Promise.resolve();
  });
  const body = document.body.textContent ?? "";
  assert.ok(body.includes("Settings could not be read."), body.slice(0, 400));
  assert.ok(body.includes("DEPENDENCY_UNAVAILABLE"), "the classified code is shown");
  assert.ok(body.includes("Try again"), "a retryable error offers a retry");
  app.unmount();
});

// ── P01-L1 / P01-L2 / P01-U6 — اللغة والاتجاه والسمة ────────────────────────

test("switching to Arabic switches the document to RTL and back", async () => {
  const app = await mount();
  const select = document.getElementById("session-locale") as HTMLSelectElement;
  await act(async () => {
    select.value = "ar";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(document.documentElement.getAttribute("dir"), "rtl");
  assert.equal(document.documentElement.getAttribute("lang"), "ar");
  assert.equal(textOf(".page-title"), "الرئيسية");

  await act(async () => {
    const next = document.getElementById("session-locale") as HTMLSelectElement;
    next.value = "en";
    next.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(document.documentElement.getAttribute("dir"), "ltr");
  assert.equal(textOf(".page-title"), "Home");
  app.unmount();
});

// قِيس 2026-10-05: سبع لغات بأقل من 1% من النصوص كانت تُعرض؛ المحدّد يعرض المكتملة (العربية والإنجليزية) وحدها.
test("the complete interface languages are offered and each renders", async () => {
  const app = await mount();
  const select = document.getElementById("session-locale") as HTMLSelectElement;
  assert.deepEqual([...select.options].map((o) => o.value).sort(), ["ar", "en"]);
  for (const option of [...select.options]) {
    await act(async () => {
      const live = document.getElementById("session-locale") as HTMLSelectElement;
      live.value = option.value;
      live.dispatchEvent(new Event("change", { bubbles: true }));
    });
    assert.notEqual(textOf(".page-title"), "", `${option.value} rendered nothing`);
  }
  app.unmount();
});

test("theme switching covers light, dark and system", async () => {
  setSystemPrefersDark(true);
  const app = await mount();
  const seen = new Set<string>();
  for (const value of ["LIGHT", "DARK", "SYSTEM"]) {
    await act(async () => {
      const choice = document.querySelector<HTMLButtonElement>(`#session-appearance [data-appearance="${value}"]`);
      assert.ok(choice !== null, `no ${value} appearance choice`);
      choice.click();
    });
    seen.add(document.documentElement.getAttribute("data-theme") ?? "");
  }
  assert.deepEqual([...seen].sort(), ["dark", "light"]);
  // النظام يفضّل الداكن، فـSYSTEM انتهت إلى الداكن: «اتبع النظام» سلوك لا اسم.
  assert.equal(document.documentElement.getAttribute("data-theme"), "dark");
  setSystemPrefersDark(false);
  app.unmount();
});

// ── P01-A1 / P01-A2 / P01-A3 — الوصول ───────────────────────────────────────

test("the page declares its landmarks", async () => {
  const app = await mount();
  assert.equal(all("[role='banner']").length, 1);
  assert.equal(all("main[role='main']").length, 1);
  assert.ok(all("nav[aria-label]").length >= 1);
  assert.equal(document.querySelector("main")?.getAttribute("id"), "main-content");
  app.unmount();
});

test("a skip link targets the main landmark", async () => {
  const app = await mount();
  const skip = document.querySelector<HTMLAnchorElement>(".skip-link");
  assert.ok(skip !== null);
  assert.equal(skip?.getAttribute("href"), "#main-content");
  assert.notEqual((skip?.textContent ?? "").trim(), "");
  app.unmount();
});

test("every interactive element is a real control with an accessible name", async () => {
  const app = await mount();
  for (const element of all("button, a, select, input")) {
    const name =
      element.getAttribute("aria-label") ??
      (element.id !== "" ? document.querySelector(`label[for="${element.id}"]`)?.textContent : null) ??
      element.textContent ??
      "";
    assert.notEqual(name.trim(), "", `an interactive element has no accessible name: ${element.outerHTML.slice(0, 120)}`);
  }
  app.unmount();
});

test("the current section is announced, not only coloured", async () => {
  const app = await mount();
  const current = all("[aria-current='page']");
  assert.equal(current.length, 1);
  // النقطة الملوّنة مخفية عن قارئ الشاشة لأن الحالة مقروءة نصًّا في التسمية.
  for (const dot of all(".nav__dot")) {
    assert.equal(dot.getAttribute("aria-hidden"), "true");
  }
  for (const item of all(".nav__item")) {
    assert.ok((item.getAttribute("aria-label") ?? "").length > 0);
  }
  app.unmount();
});

test("no interactive element is removed from the tab order", async () => {
  const app = await mount();
  for (const element of all("button, a[href], select")) {
    const tabindex = element.getAttribute("tabindex");
    assert.notEqual(tabindex, "-1", `an interactive element was taken out of the tab order: ${element.outerHTML.slice(0, 80)}`);
  }
  app.unmount();
});

test("busy states are announced politely", async () => {
  const slow: Transport = { send: () => new Promise(() => undefined) };
  const container = resetDocument();
  const root = createRoot(container);
  await act(async () => {
    root.render(<AppRoot client={new DesktopIpcClient({ transport: slow, identity: IDENTITY })} location={memoryLocation("/")} />);
  });
  const status = document.querySelector("[role='status']");
  assert.ok(status !== null, "a loading state must be announced");
  assert.equal(status?.getAttribute("aria-live"), "polite");
  assert.equal(status?.getAttribute("aria-busy"), "true");
  act(() => root.unmount());
});

// ── Tauri freezePrototype ────────────────────────────────────────────────────
// WebView يعمل و`Object.prototype` مجمَّد. خاصية JSX تحمل اسم عضو من النموذج
// الأولي (`valueOf` مثلًا) ترمي هناك وتُسقط الشجرة كلها، ولا يراها jsdom العادي.
// المسبار يعمل في عملية منفصلة لأن التجميد لا رجعة فيه.

test("every section renders with Object.prototype frozen, as Tauri runs it", () => {
  const probe = spawnSync(process.execPath, [join(__dirname, "support", "frozen-prototype-probe.js")], {
    encoding: "utf8",
    timeout: 60_000,
  });
  assert.equal(probe.status, 0, `probe exited ${String(probe.status)}: ${probe.stderr}`);
  const report = JSON.parse(probe.stdout.trim().split("\n").pop() ?? "{}") as {
    frozen?: boolean;
    outcomes?: Array<{ path: string; title: string; shell: boolean }>;
    errors?: string[];
  };
  assert.equal(report.frozen, true, "the probe did not freeze Object.prototype");
  assert.deepEqual(report.errors, [], "rendering threw under a frozen prototype");
  assert.equal(report.outcomes?.length, ROUTES.length + 1);
  for (const outcome of report.outcomes ?? []) {
    assert.notEqual(outcome.title, "", `${outcome.path} rendered no title under a frozen prototype`);
    assert.equal(outcome.shell, true, `${outcome.path} lost the shell under a frozen prototype`);
  }
});

// ── أداة القياس: onReady بعد الرسم لا قبله ───────────────────────────────────
// مجموعة E2E الأصلية تقرأ DOM لحظة `onReady`. استدعاؤه قبل أن يُرسم الهيكل جعل
// D2 يعدّ 0/0 أقسام في ثنائي القياس على مضيف أصلي سريع.

test("onReady reports HYDRATED only once the hydrated shell is in the document", async () => {
  const container = resetDocument();
  const root = createRoot(container);
  const client = new DesktopIpcClient({ transport: fakeHost(), identity: IDENTITY });
  const seen: Array<{ outcome: string; navItems: number; title: string }> = [];
  await act(async () => {
    root.render(
      <AppRoot
        client={client}
        location={memoryLocation("/")}
        onReady={(outcome) => {
          seen.push({
            outcome,
            navItems: document.querySelectorAll(".nav__item").length,
            title: document.querySelector(".page-title")?.textContent?.trim() ?? "",
          });
        }}
      />,
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
  assert.equal(seen.length, 1, `onReady fired ${seen.length} times`);
  assert.deepEqual(seen[0], { outcome: "HYDRATED", navItems: 10, title: "Home" });
  act(() => root.unmount());
});

test("onReady reports FAILED only once the honest error screen is in the document", async () => {
  const container = resetDocument();
  const root = createRoot(container);
  const client = new DesktopIpcClient({
    transport: { async send() { throw new TransportUnavailable(); } },
    identity: IDENTITY,
  });
  const seen: Array<{ outcome: string; errorShown: boolean }> = [];
  await act(async () => {
    root.render(
      <AppRoot
        client={client}
        location={memoryLocation("/")}
        onReady={(outcome) => {
          seen.push({ outcome, errorShown: document.querySelector(".state__code") !== null });
        }}
      />,
    );
  });
  assert.deepEqual(seen, [{ outcome: "FAILED", errorShown: true }]);
  act(() => root.unmount());
});
