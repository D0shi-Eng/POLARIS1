// مجموعة E2E التي تعمل داخل النافذة الحقيقية.
//
// لماذا داخل النافذة: الادعاءات التي تحتاج WebView2 حقيقيًا — الاتجاه، والسمة،
// والتنقّل، ورفض عملية غير معروفة عبر النقل الحقيقي — لا تُثبَت في jsdom. وما
// يُثبَت في jsdom يبقى هناك.
//
// الحارس: لا شيء هنا يعمل ما لم يضع المضيفُ العلمَ، والمضيف لا يضعه إلا حين
// يُترجَم بالميزة `e2e`. والأمر الذي يستقبل التقرير غير موجود في ثنائي المنتج
// أصلًا، فالنداء عليه هناك يُرفض.
//
// ملاحظة أمنية مقصودة: المجموعة ترسل ظرفًا غير معروف عمدًا. هذا ليس بابًا خلفيًا:
// أي شيفرة في العارض تستطيع النداء، والخاصية الأمنية ليست عجز العارض عن الإرسال
// بل رفض المضيف للتوجيه. الاختبار يُثبت الرفض.

import { invoke } from "@tauri-apps/api/core";

import type { DesktopIpcClient } from "../ipc/client";
import type { Phase02Client } from "../ipc/p02-client";
import { phase02Config, runPhase02Suite } from "./p02-suite";
import { phase03Config, runPhase03Suite } from "./p03-suite";
import { phase04Config, runPhase04Suite } from "./p04-suite";
import { phase05Config, runPhase05Suite } from "./p05-suite";
import { phase06Config, runPhase06Suite } from "./p06-suite";
import { phase08Config, runPhase08Suite } from "./p08-suite";
import { qaConfig, runQaSuite } from "./qa-suite";
import type { Phase03Client } from "../ipc/p03-client";
import type { Phase04Client } from "../ipc/p04-client";
import type { Phase05Client } from "../ipc/p05-client";
import type { Phase06Client } from "../ipc/p06-client";
import type { Phase08Client } from "../ipc/p08-client";

export type ScenarioStatus = "PASS" | "FAIL" | "NOT_TESTED";

export interface ScenarioResult {
  readonly id: string;
  readonly title: string;
  readonly status: ScenarioStatus;
  readonly detail: string;
}

import { isE2EEnabled } from "./flag";

export { isE2EEnabled };

function doc(): Document {
  return globalThis.document;
}

async function settle(frames = 3): Promise<void> {
  for (let index = 0; index < frames; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
}

function text(selector: string): string {
  return doc().querySelector(selector)?.textContent?.trim() ?? "";
}

function result(id: string, title: string, ok: boolean, detail: string): ScenarioResult {
  return { id, title, status: ok ? "PASS" : "FAIL", detail };
}

/** ظرف صالح البنية باسم عملية لا يوجّهها المضيف. */
function unknownOperationEnvelope(): Record<string, unknown> {
  return {
    contract_version: "1.1",
    protocol_version: "1.1",
    message_type: "REQUEST",
    message_id: "3f2b1a09-8c7d-4e6f-b5a4-0d9c8b7a6e51",
    correlation_id: "5d4c3b2a-1908-4f7e-a6d5-c4b3a2918071",
    session_id: "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50",
    caller_identity: {
      caller_type: "CORE_UI",
      principal_id: "1c9d6f2a-4b3e-4d21-9c7a-2e5f8b1d4a60",
      trust_tier: "TIER_2_UNTRUSTED",
      session_id: "7a5a2c22-1cbb-4a41-9a8f-7b1c2d3e4f50",
    },
    timestamp: "2026-09-15T00:00:00Z",
    operation: "system.ping",
    payload: {},
  };
}

async function sendRaw(envelope: unknown): Promise<Record<string, unknown> | null> {
  try {
    return (await invoke<Record<string, unknown>>("polaris_ipc", { envelope })) ?? null;
  } catch {
    return null;
  }
}

/** حقائق العرض عند هذا التشغيل. تُقرأ ولا تُقدَّر. */
function viewport(): Record<string, number | boolean> {
  const root = doc().documentElement;
  const rail = doc().querySelector(".shell__rail");
  return {
    device_pixel_ratio: globalThis.devicePixelRatio ?? 1,
    inner_width: globalThis.innerWidth ?? 0,
    inner_height: globalThis.innerHeight ?? 0,
    scroll_width: root.scrollWidth,
    client_width: root.clientWidth,
    // تجاوز أفقي بمقدار بكسل واحد ليس عيبًا؛ ما فوقه تخطيط مكسور.
    no_horizontal_overflow: root.scrollWidth <= root.clientWidth + 1,
    rail_visible: (rail?.getBoundingClientRect().width ?? 0) > 0,
    main_visible: (doc().querySelector("main")?.getBoundingClientRect().width ?? 0) > 0,
  };
}

export async function runE2ESuite(
  client: DesktopIpcClient,
  bootstrapOutcome: string,
  phase02?: Phase02Client,
  phase03?: Phase03Client,
  phase04?: Phase04Client,
  phase05?: Phase05Client,
  phase06?: Phase06Client,
  phase08?: Phase08Client,
): Promise<void> {
  // كل مجموعة تُطلب صراحةً بمرحلتها. الأحدث أولًا، ولا مجموعة تعمل بالمصادفة.
  const qa = qaConfig();
  if (qa !== null && phase02 !== undefined) {
    let report: Record<string, unknown> | null;
    try {
      report = await runQaSuite(phase02, phase06, qa, phase03, phase04, phase08);
    } catch (error) {
      report = { suite: "qa-controls", stage: qa.stage, fatal: error instanceof Error ? error.message : String(error), results: [] };
    }
    // `null`: الصفحة أُعيدت تهيئتها للمرّة الثانية بلغة أخرى، والتقرير يُكتب في نهايتها.
    if (report !== null) await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    return;
  }
  const p08 = phase08Config();
  if (p08 !== null && phase02 !== undefined && phase03 !== undefined && phase08 !== undefined) {
    let report: Record<string, unknown>;
    try {
      report = await runPhase08Suite(client, phase02, phase03, phase08, bootstrapOutcome, p08);
    } catch (error) {
      report = { suite: "p08", stage: p08.stage, fatal: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
    try {
      await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    } catch {
      // التقرير لم يُكتب؛ المشغّل الأصلي يسجّل غيابه.
    }
    return;
  }
  const p06 = phase06Config();
  if (p06 !== null && phase02 !== undefined && phase03 !== undefined && phase04 !== undefined && phase06 !== undefined) {
    let report: Record<string, unknown>;
    try {
      report = await runPhase06Suite(client, phase02, phase03, phase04, phase06, bootstrapOutcome, p06, phase05);
    } catch (error) {
      report = { suite: "p06", stage: p06.stage, fatal: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
    try {
      await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    } catch {
      // لا مستقبِل للتقرير في ثنائي المنتج.
    }
    return;
  }
  const p05 = phase05Config();
  if (p05 !== null && phase02 !== undefined && phase03 !== undefined && phase04 !== undefined && phase05 !== undefined) {
    let report: Record<string, unknown>;
    try {
      report = await runPhase05Suite(client, phase02, phase03, phase04, phase05, bootstrapOutcome, p05);
    } catch (error) {
      report = { suite: "p05", stage: p05.stage, fatal: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
    try {
      await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    } catch {
      // لا مستقبِل للتقرير في ثنائي المنتج.
    }
    return;
  }
  const p04 = phase04Config();
  if (p04 !== null && phase02 !== undefined && phase03 !== undefined && phase04 !== undefined) {
    let report: Record<string, unknown>;
    try {
      report = await runPhase04Suite(client, phase02, phase03, phase04, bootstrapOutcome, p04);
    } catch (error) {
      report = { suite: "p04", stage: p04.stage, fatal: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
    try {
      await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    } catch {
      // لا مستقبِل للتقرير في ثنائي المنتج.
    }
    return;
  }
  const p03 = phase03Config();
  if (p03 !== null && phase02 !== undefined && phase03 !== undefined) {
    let report: Record<string, unknown>;
    try {
      report = await runPhase03Suite(client, phase02, phase03, bootstrapOutcome, p03);
    } catch (error) {
      report = { suite: "p03", stage: p03.stage, fatal: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
    try {
      await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    } catch {
      // لا مستقبِل للتقرير في ثنائي المنتج.
    }
    return;
  }
  // مجموعة Phase-02 تعمل بدل مجموعة Phase-01 حين يطلبها المشغّل صراحةً.
  const p02 = phase02Config();
  if (p02 !== null && phase02 !== undefined) {
    let report: Record<string, unknown>;
    try {
      report = await runPhase02Suite(client, phase02, bootstrapOutcome, p02);
    } catch (error) {
      report = { suite: "p02", stage: p02.stage, fatal: error instanceof Error ? error.message : String(error), scenarios: [] };
    }
    try {
      await invoke("polaris_e2e_report", { report: { ...report, viewport: viewport() } });
    } catch {
      // لا مستقبِل للتقرير في ثنائي المنتج.
    }
    return;
  }
  const results: ScenarioResult[] = [];

  // D1 — الإقلاع
  results.push(
    result("D1", "startup completes and the shell hydrates", bootstrapOutcome === "HYDRATED", `bootstrap outcome ${bootstrapOutcome}`),
  );

  // D2 — التنقّل عبر كل الأقسام
  const sections = [...doc().querySelectorAll(".nav__item")].length;
  let navigated = 0;
  for (const item of [...doc().querySelectorAll<HTMLButtonElement>(".nav__item")]) {
    item.click();
    await settle(1);
    if (text(".page-title") !== "") navigated += 1;
  }
  results.push(result("D2", "every section renders a titled page", navigated === sections && sections === 10, `${navigated}/${sections} sections rendered`));

  // D6 — ميزة غير متاحة تُعلن حالتها
  //
  // منذ Phase-06 صارت «الإعدادات» لوحة التحكّم، وعرض المضيف من Phase-01 بقي كما هو
  // على `/settings/host`. القياس هو هو على العرض نفسه: لم يُضعَّف ولم يُنقل ادّعاؤه.
  //
  // الميزة المقيسة هنا ليست ميزةً بعينها: هي ميزةٌ لم تُبنَ بعد. كانت «المهامّ»
  // كذلك حتى بنتها Phase-03، وكانت «المهارات» كذلك حتى بنتها Phase-04، فينتقل
  // القياس في كل مرّة إلى ميزة ما تزال غير مبنيّة. الادّعاء المقيس هو هو ولم
  // يُضعَّف: ميزة غير متاحة تُعلن حالتها وسببها بدل أن تبدو فارغة.
  //
  // بنت Phase-05 الذاكرة والمتصفّح والحاسوب، فلم تبقَ وجهة غير مبنيّة في الشريط
  // الجانبي. الميزات التي ما تزال لمرحلة لاحقة حقًّا هي أقسام الإعدادات المعلَّمة
  // «غير متاحة في هذه المرحلة»، فينتقل القياس إليها: الادّعاء هو هو — حالة معلَنة
  // وسبب مقروء بدل صفحة تبدو فارغة.
  globalThis.location.hash = "#/settings/host";
  await settle(5);
  let unavailableSection = "";
  let unavailableReason = "";
  for (const item of [...doc().querySelectorAll<HTMLButtonElement>(".settings__index .nav__item")]) {
    item.click();
    await settle(2);
    const panel = doc().querySelector(".settings section[aria-live]");
    const muted = panel?.querySelector(".section .pill--MUTED") ?? null;
    const reason = [...(panel?.querySelectorAll(".row__hint") ?? [])].map((node) => node.textContent?.trim() ?? "").find((t) => t !== "") ?? "";
    if (muted !== null && reason !== "") {
      unavailableSection = item.textContent?.trim() ?? "";
      unavailableReason = reason;
      break;
    }
  }
  const unavailable = unavailableSection !== "" && unavailableReason !== "";
  results.push(
    result("D6", "an unavailable feature declares a state and a reason", unavailable, `section "${unavailableSection}" declares "${unavailableReason}"`),
  );

  // D7 — الإعدادات تصف وتقرأ
  globalThis.location.hash = "#/settings/host";
  await settle(5);
  const settingsSections = doc().querySelectorAll(".settings__index .nav__item").length;
  const settingRows = doc().querySelectorAll(".settings .row").length;
  results.push(
    result("D7", "settings describe and read return real structure", settingsSections === 31 && settingRows > 0, `${settingsSections} sections, ${settingRows} rows`),
  );

  // D8 — مسار غير معروف
  globalThis.location.hash = "#/not-a-section";
  await settle();
  const safeFallback = doc().querySelector(".shell__rail") !== null && doc().querySelector(".state") !== null;
  results.push(result("D8", "an unknown route fails safely with the shell intact", safeFallback, `shell intact: ${safeFallback}`));
  globalThis.location.hash = "#/";
  await settle();

  // D4 — تبديل اللغة والاتجاه
  const localeSelect = doc().getElementById("session-locale") as HTMLSelectElement | null;
  let directionSwitched = false;
  if (localeSelect !== null) {
    localeSelect.value = "ar";
    localeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const rtl = doc().documentElement.getAttribute("dir") === "rtl" && doc().documentElement.getAttribute("lang") === "ar";
    localeSelect.value = "en";
    localeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    const ltr = doc().documentElement.getAttribute("dir") === "ltr" && doc().documentElement.getAttribute("lang") === "en";
    directionSwitched = rtl && ltr;
  }
  results.push(result("D4", "language switching drives lang and dir", directionSwitched, `switcher present: ${localeSelect !== null}`));

  // D5 — تبديل السمة
  // المظهر ثلاثة أزرار (فاتح، داكن، النظام) في قائمة الحساب، لا قائمة منسدلة.
  const appearanceSelect = doc().getElementById("session-appearance");
  let themeSwitched = false;
  if (appearanceSelect !== null) {
    const seen = new Set<string>();
    for (const value of ["LIGHT", "DARK", "SYSTEM"]) {
      appearanceSelect.querySelector<HTMLButtonElement>(`[data-appearance="${value}"]`)?.click();
      await settle(1);
      seen.add(doc().documentElement.getAttribute("data-theme") ?? "");
    }
    themeSwitched = seen.has("light") && seen.has("dark");
  }
  results.push(result("D5", "theme switching drives data-theme for light, dark and system", themeSwitched, `switcher present: ${appearanceSelect !== null}`));

  // D9 — عملية غير معروفة تُرفض عبر النقل الحقيقي
  const denied = await sendRaw(unknownOperationEnvelope());
  const deniedOk = denied !== null && typeof denied["error"] === "object" && denied["result"] === undefined;
  results.push(result("D9", "an unknown operation is denied by the host over the real transport", deniedOk, `error present: ${deniedOk}`));

  // D10 — ظرف مشوّه يُرفض
  const malformed = await sendRaw({ message_type: "REQUEST" });
  const malformedOk = malformed !== null && typeof malformed["error"] === "object";
  results.push(result("D10", "a malformed envelope is rejected by the host", malformedOk, `error present: ${malformedOk}`));

  // حارس التسريب: لا تفصيل داخلي ولا أثر مكدّس في أي ردّ خطأ
  const leaked = [denied, malformed].some((response) => {
    const error = response?.["error"];
    if (typeof error !== "object" || error === null) return false;
    return "internal_detail" in error || "stack" in error;
  });
  results.push(result("S5", "no error response carries internal detail", !leaked, `leak detected: ${leaked}`));

  // S6 — واجهة ميزة غير متاحة لا تحمل فعلًا قابلًا للتنفيذ
  // (القياس انتقل مع D6 إلى قسم إعدادات ما يزال لمرحلة لاحقة: تُعدّ عناصر التحكّم
  // داخل لوحة القسم نفسه، لا فهرس الأقسام الذي هو تنقّل لا فعل.)
  globalThis.location.hash = "#/settings/host";
  await settle(5);
  let actionable = -1;
  let checkedSection = "";
  for (const item of [...doc().querySelectorAll<HTMLButtonElement>(".settings__index .nav__item")]) {
    item.click();
    await settle(2);
    const panel = doc().querySelector(".settings section[aria-live]");
    if (panel?.querySelector(".section .pill--MUTED") !== null && panel?.querySelector(".section .pill--MUTED") !== undefined) {
      actionable = panel.querySelectorAll("button, input, select, textarea").length;
      checkedSection = item.textContent?.trim() ?? "";
      break;
    }
  }
  results.push(
    result("S6", "an unavailable feature offers no control that could execute anything", actionable === 0, `${actionable} controls in the panel of "${checkedSection}"`),
  );
  globalThis.location.hash = "#/";
  await settle();

  // D3 — فشل الإقلاع يعطي شاشة خطأ صادقة
  // يُقاس في مسار jsdom بنقل يفشل؛ هنا يُسجَّل كغير مُختبَر بدل أن يُدَّعى.
  results.push({
    id: "D3",
    title: "bootstrap failure shows an honest recoverable error",
    status: "NOT_TESTED",
    detail: "measured in the headless lane with a failing transport; the native lane does not take the host down",
  });

  // D11 / D12 — إعادة التشغيل والخروج النظيف يقيسهما المشغّل الأصلي من خارج النافذة.
  results.push({ id: "D11", title: "restart", status: "NOT_TESTED", detail: "measured by the native runner, not from inside the window" });
  results.push({ id: "D12", title: "clean exit", status: "NOT_TESTED", detail: "measured by the native runner, not from inside the window" });

  const bootstrapAgain = await client.bootstrap();
  results.push(result("H4", "bootstrap is repeatable within a session", bootstrapAgain.ok, `second bootstrap ok: ${bootstrapAgain.ok}`));

  try {
    await invoke("polaris_e2e_report", { report: { scenarios: results, viewport: viewport() } });
  } catch {
    // لا مستقبِل للتقرير: هذا هو السلوك الصحيح في ثنائي المنتج.
  }
}
