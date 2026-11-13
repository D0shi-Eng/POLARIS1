// مجموعة QA الشاملة للعناصر التفاعلية (2026-10-15)، داخل النافذة الحقيقية على ثنائي القياس.
//
// تمرّ على كل مسار مسجَّل، وتجمع كل عنصر تفاعلي ظاهر، وتفحص لكلٍّ منها: الاسم الوصولي، وبقاءه
// داخل حدود النافذة أفقيًا، وأنه غير مغطّى بعنصر آخر، وأن نصّه غير مقصوص، وأنه يقبل التركيز.
// ثم تضغط العناصر الآمنة ضغطًا حقيقيًا (أحداث المؤشّر ثم click) وتقيس الأثر: تغيّر DOM، أو
// المسار، أو ظهور حوار أو قائمة، أو تغيّر قيمة. الحوار المفتوح يُغلق بـEscape ويُسجَّل إن لم يُغلق.
//
// ما لا يُضغط آليًا يُسجَّل باسمه وسببه، لا نجاحًا: ما يفتح نافذة نظام (مفتاح، ملف)، أو يرسل إلى
// نموذج، أو يحذف، أو يغادر التطبيق. هذه تغطّيها مجموعات المراحل بمسارات محدّدة أو تبقى NOT_TESTED.
// تمرّ المجموعة مرتين: بالعربية ثم بالإنجليزية (اللغة تُضبط من الإعدادات وتُعاد تهيئة الصفحة).

import type { Phase02Client } from "../ipc/p02-client";
import type { Phase03Client } from "../ipc/p03-client";
import type { Phase04Client } from "../ipc/p04-client";
import type { Phase06Client } from "../ipc/p06-client";
import type { Phase08Client } from "../ipc/p08-client";
import { createTranslator } from "../localization/translate";
import { ROUTES, SECONDARY_ROUTES } from "../routes/registry";

export interface QaSuiteConfig {
  readonly stage: "qa-controls";
  readonly marker: string | null;
}

export function qaConfig(): QaSuiteConfig | null {
  const value = (globalThis as { __POLARIS_E2E_QA__?: QaSuiteConfig }).__POLARIS_E2E_QA__;
  return value !== undefined && typeof value === "object" && value !== null ? value : null;
}

type Verdict = "EFFECT" | "NO_EFFECT" | "SKIPPED_EFFECTFUL" | "DISABLED" | "ERROR" | "NOT_CLICKED";

interface ControlRow {
  readonly locale: string;
  readonly route: string;
  readonly key: string;
  readonly tag: string;
  readonly role: string | null;
  readonly name: string;
  readonly disabled: boolean;
  readonly disabled_reason: string | null;
  readonly checks: Readonly<Record<string, boolean | string>>;
  verdict: Verdict;
  effect: string;
  errors: string[];
  ms: number;
}

const doc = (): Document => globalThis.document;
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const STATE_KEY = "polaris.qa.state";

// الأسماء التي لا تُضغط آليًا: أثر خارج النافذة، أو حذف، أو إرسال إلى نموذج، أو نافذة نظام.
const EFFECTFUL =
  /delete|remove|clear|reset|restore default|disconnect|uninstall|archive|send|submit|run now|run\b|start|stop|cancel mission|approve|deny|allow once|always allow|api key|key\b|credential|upload|attach|browse|import|export|download|open folder|reveal|show in|sign in|sign out|log ?out|quit|exit|voice|microphone|dictat|record|install|forget|purge|wipe|حذف|احذف|إزالة|أزل|مسح|امسح|إعادة الضبط|إعادة تعيين|الافتراضي|قطع الاتصال|افصل|فصل|أرشف|أرشفة|إرسال|أرسل|تشغيل الآن|شغّل|ابدأ|بدء|إيقاف|أوقف|موافقة|وافق|ارفض|رفض|مفتاح|رفع|إرفاق|أرفق|استيراد|تصدير|تنزيل|نزّل|فتح المجلد|أظهر في|خروج|صوت|ميكروفون|إملاء|تثبيت|انسَ|تفريغ/i;

function accessibleName(el: Element): string {
  const aria = el.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const text = labelledBy.split(/\s+/).map((id) => doc().getElementById(id)?.textContent ?? "").join(" ").trim();
    if (text !== "") return text;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const labels = el.labels ? [...el.labels].map((l) => l.textContent ?? "").join(" ").trim() : "";
    if (labels !== "") return labels;
    if (el instanceof HTMLInputElement && el.placeholder) return el.placeholder;
    if (el instanceof HTMLTextAreaElement && el.placeholder) return el.placeholder;
  }
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text !== "") return text.slice(0, 80);
  const title = el.getAttribute("title");
  return title !== null ? title.trim() : "";
}

const SELECTOR =
  "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=menuitem], [role=menuitemradio], [role=switch], [role=checkbox], [role=option], [role=link], [role=radio], [role=slider]";

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.01;
}

function controls(): Element[] {
  const all = [...doc().querySelectorAll(SELECTOR)].filter(visible);
  // عنصر داخل عنصر تفاعلي آخر (أيقونة داخل زر) يُعدّ مرة واحدة: الخارجي.
  return all.filter((el) => !all.some((other) => other !== el && other.contains(el) && other.matches("button, a[href], [role=button], [role=menuitem], [role=tab]")));
}

function keyOf(el: Element, seen: Map<string, number>): string {
  const base = `${el.tagName.toLowerCase()}|${el.getAttribute("role") ?? ""}|${accessibleName(el)}`;
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return `${base}#${n}`;
}

function findByKey(key: string): Element | null {
  const seen = new Map<string, number>();
  for (const el of controls()) if (keyOf(el, seen) === key) return el;
  return null;
}

function staticChecks(el: Element): Record<string, boolean | string> {
  const modal = topDialog();
  const behindModal = modal !== null && !modal.contains(el);
  // التركيز أولًا: رابط «تخطَّ إلى المحتوى» وأمثاله لا يظهر إلا عند التركيز.
  if (!behindModal && el instanceof HTMLElement) el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "center", inline: "nearest" });
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = doc().elementFromPoint(Math.min(Math.max(cx, 0), innerWidth - 1), Math.min(Math.max(cy, 0), innerHeight - 1));
  const occludedBy = !behindModal && hit !== null && hit !== el && !el.contains(hit) && !hit.contains(el) ? describe(hit) : "";
  if (el instanceof HTMLElement && doc().activeElement === el) el.blur();
  const style = getComputedStyle(el);
  const clipped =
    el instanceof HTMLElement &&
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLSelectElement) &&
    el.scrollWidth > el.clientWidth + 2 &&
    style.overflowX !== "visible" &&
    style.textOverflow !== "ellipsis";
  const focusable = el instanceof HTMLElement && (el.tabIndex >= 0 || el.matches("a[href], button, input, select, textarea, summary"));
  return {
    has_name: accessibleName(el) !== "",
    inside_window_x: r.left >= -1 && r.right <= innerWidth + 1,
    behind_modal: behindModal,
    occluded_by: occludedBy,
    clipped,
    focusable,
    min_target_24px: r.width >= 24 && r.height >= 24,
  };
}

function describe(el: Element): string {
  const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 2).join(".") : "";
  return `${el.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
}

/** الطبقات الظاهرة الآن. المسار قد يكون هو نفسه داخل حوار (الإعدادات)، فالمقارنة بالعدد لا بالوجود. */
function overlays(): { dialogs: number; menus: number } {
  const count = (selector: string): number => [...doc().querySelectorAll(selector)].filter(visible).length;
  return { dialogs: count("[role=dialog], [role=alertdialog], dialog[open]"), menus: count("[role=menu], [role=listbox]") };
}

function overlayDelta(before: { dialogs: number; menus: number }): string {
  const now = overlays();
  if (now.dialogs > before.dialogs) return "dialog";
  if (now.menus > before.menus) return "menu";
  return "";
}

/** أعلى حوار ظاهر؛ ما خارجه «خلف حوار» لا «مغطّى». */
function topDialog(): Element | null {
  const all = [...doc().querySelectorAll("[role=dialog], [role=alertdialog], dialog[open]")].filter(visible);
  return all.length > 0 ? (all[all.length - 1] as Element) : null;
}

/** حالة التبديل كما يراها المستخدم: سمات ARIA أو خاصية checked الأصلية. */
function toggleState(el: Element): string | null {
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) return String(el.checked);
  return el.getAttribute("aria-pressed") ?? el.getAttribute("aria-checked") ?? el.getAttribute("aria-expanded") ?? el.getAttribute("aria-selected");
}

/** بصمة بنيوية: عناصر كثيرة بالبصمة نفسها (بطاقات الوكلاء) تُمثَّل بعيّنة معلنة. */
function family(el: Element): string {
  const cls = (e: Element | null): string => (e !== null && typeof e.className === "string" ? e.className.split(/\s+/).filter(Boolean).sort().join(".") : "");
  return `${el.tagName}|${cls(el)}|${cls(el.parentElement)}|${cls(el.parentElement?.parentElement ?? null)}`;
}

/** ينتظر حتى يهدأ DOM 150 ms (أو 5 s): زمن استقرار المسار المقيس، لا انتظار ثابت. */
async function settleDom(maxMs = 5000): Promise<number> {
  const t0 = performance.now();
  let last = performance.now();
  const observer = new MutationObserver(() => { last = performance.now(); });
  observer.observe(doc().body, { subtree: true, childList: true, attributes: true, characterData: true });
  while (performance.now() - last < 150 && performance.now() - t0 < maxMs) await pause(25);
  observer.disconnect();
  return Math.round(last - t0);
}

function pressEscape(): void {
  const target = doc().activeElement ?? doc().body;
  for (const type of ["keydown", "keyup"]) {
    target.dispatchEvent(new KeyboardEvent(type, { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  }
}

function realClick(el: Element): void {
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, pointerType: "mouse", isPrimary: true };
  el.dispatchEvent(new PointerEvent("pointerdown", init));
  el.dispatchEvent(new MouseEvent("mousedown", init));
  if (el instanceof HTMLElement) el.focus();
  el.dispatchEvent(new PointerEvent("pointerup", init));
  el.dispatchEvent(new MouseEvent("mouseup", init));
  (el as HTMLElement).click();
}

function effectfulReason(el: Element, name: string): string | null {
  if (el instanceof HTMLInputElement && el.type === "file") return "native file picker";
  if (el instanceof HTMLButtonElement && el.type === "submit") return "submits a form";
  if (el instanceof HTMLAnchorElement && /^https?:/i.test(el.getAttribute("href") ?? "")) return "external link";
  if (el instanceof HTMLInputElement && el.type === "password") return "secret field";
  if (EFFECTFUL.test(name)) return "effectful label";
  if (el.closest("[data-qa-skip]") !== null) return "marked skip";
  return null;
}

async function waitForMain(timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (doc().querySelector("main") !== null) return true;
    await pause(100);
  }
  return false;
}

async function go(path: string): Promise<number> {
  const t0 = performance.now();
  if (globalThis.location.hash !== `#${path}`) globalThis.location.hash = `#${path}`;
  await pause(30);
  await waitForMain();
  await settleDom();
  return Math.round(performance.now() - t0 - 150);
}

interface ErrorSink {
  take(): string[];
}

function installErrorSink(): ErrorSink {
  const buffer: string[] = [];
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    buffer.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ").slice(0, 300));
    original(...args);
  };
  globalThis.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    buffer.push(`unhandledrejection: ${reason instanceof Error ? reason.message : String(reason)}`.slice(0, 300));
  });
  globalThis.addEventListener("error", (event) => buffer.push(`error: ${(event as ErrorEvent).message}`.slice(0, 300)));
  return { take: () => buffer.splice(0, buffer.length) };
}

async function exerciseInput(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): Promise<string> {
  const before = el.value;
  const prototype = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  const assign = (value: string): void => {
    if (setter !== undefined) setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (el instanceof HTMLSelectElement) {
    const other = [...el.options].find((o) => o.value !== before && !o.disabled);
    if (other === undefined) return "single option";
    assign(other.value);
    await pause(250);
    const took = el.value === other.value;
    assign(before);
    await pause(150);
    return took ? "select changes value" : "select ignored change";
  }
  if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio" || el.type === "range" || el.type === "number" || el.type === "color")) {
    return `input type ${el.type}: covered by click`;
  }
  // نص عربي من الكتالوج نفسه، لا نصّ مكتوب في الشيفرة: يقيس أن الحقل يقبل الكتابة من اليمين.
  const probe = `QA ${createTranslator("ar").t("nav.home")} 42`;
  assign(probe);
  await pause(200);
  const took = el.value === probe;
  assign(before);
  await pause(150);
  return took ? "field accepts text" : "field ignored text";
}

async function sweepRoute(locale: string, route: string, sink: ErrorSink, rows: ControlRow[], budget: { clicks: number }): Promise<Record<string, unknown>> {
  const settleMs = await go(route);
  const pageErrors = sink.take();
  const root = doc().documentElement;
  const page = {
    locale,
    route,
    load_ms: settleMs,
    main: doc().querySelector("main") !== null,
    dir: root.dir || getComputedStyle(doc().body).direction,
    horizontal_overflow: root.scrollWidth > root.clientWidth + 1,
    errors_on_load: pageErrors,
    controls: 0,
    families_sampled: 0,
  };
  const baseline = overlays();
  const seen = new Map<string, number>();
  const found = controls();
  const keys = found.map((el) => keyOf(el, seen));
  // العائلات الكبيرة (أكثر من 8 عناصر بالبصمة نفسها) تُمثَّل بأول ثلاثة وآخر واحد، ويُعلن ذلك في كل صف.
  const families = new Map<string, number[]>();
  found.forEach((el, index) => { const f = family(el); families.set(f, [...(families.get(f) ?? []), index]); });
  const sampledOut = new Set<number>();
  for (const members of families.values()) {
    if (members.length <= 8) continue;
    page.families_sampled += 1;
    members.slice(3, -1).forEach((index) => sampledOut.add(index));
  }
  page.controls = keys.length;
  for (const [index, key] of keys.entries()) {
    const el = findByKey(key);
    if (el === null) {
      rows.push({ locale, route, key, tag: "", role: null, name: key, disabled: false, disabled_reason: null, checks: {}, verdict: "NOT_CLICKED", effect: "gone after earlier interaction", errors: [], ms: 0 });
      continue;
    }
    const name = accessibleName(el);
    const disabled = (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
    const reason = disabled ? el.getAttribute("title") ?? (el.getAttribute("aria-describedby") !== null ? "described" : null) : null;
    const row: ControlRow = {
      locale, route, key, tag: el.tagName.toLowerCase(), role: el.getAttribute("role"), name, disabled, disabled_reason: reason,
      checks: staticChecks(el), verdict: "NOT_CLICKED", effect: "", errors: [], ms: 0,
    };
    rows.push(row);
    if (disabled) { row.verdict = "DISABLED"; continue; }
    const skip = effectfulReason(el, name);
    if (skip !== null) { row.verdict = "SKIPPED_EFFECTFUL"; row.effect = skip; continue; }
    if (sampledOut.has(index)) { row.effect = "represented by sample of its family"; continue; }
    if (row.checks.behind_modal === true) { row.effect = "behind an open modal"; continue; }
    if (budget.clicks <= 0) { row.effect = "click budget exhausted"; continue; }
    budget.clicks -= 1;
    const t0 = performance.now();
    sink.take();
    if ((el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "range", "color"].includes(el.type)) || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      row.effect = await exerciseInput(el);
      row.verdict = /accepts|changes|covered/.test(row.effect) ? "EFFECT" : row.effect === "single option" ? "NOT_CLICKED" : "NO_EFFECT";
      row.errors = sink.take();
      if (row.errors.length > 0) row.verdict = "ERROR";
      row.ms = Math.round(performance.now() - t0);
      continue;
    }
    const before = overlays();
    let mutations = 0;
    const observer = new MutationObserver((list) => { mutations += list.length; });
    observer.observe(doc().body, { subtree: true, childList: true, attributes: true, characterData: true });
    const hashBefore = globalThis.location.hash;
    const stateBefore = toggleState(el);
    const wasActive = el.getAttribute("aria-current") !== null || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true";
    realClick(el);
    await pause(450);
    observer.disconnect();
    const opened = overlayDelta(before);
    const hashAfter = globalThis.location.hash;
    const stateAfter = el.isConnected ? toggleState(el) : "detached";
    const parts: string[] = [];
    if (hashAfter !== hashBefore) parts.push(`navigated ${hashAfter}`);
    if (opened !== "") parts.push(`opened ${opened}`);
    if (stateAfter !== stateBefore) parts.push(`state ${String(stateBefore)}→${String(stateAfter)}`);
    if (mutations > 0) parts.push(`dom ${mutations}`);
    row.verdict = parts.length > 0 ? "EFFECT" : "NO_EFFECT";
    row.effect = parts.length > 0 ? parts.join("; ") : wasActive ? "already the current item" : "";
    if (opened !== "") {
      pressEscape();
      await pause(300);
      if (overlayDelta(before) !== "") {
        row.effect += "; escape did not close";
        const closeNames = new Set(["ar", "en"].map((code) => createTranslator(code as "ar" | "en").t("ui.close")));
        const close = [...doc().querySelectorAll("[role=dialog] button, [role=menu] button")].find((b) => closeNames.has(accessibleName(b)) || /close|cancel/i.test(accessibleName(b)));
        if (close !== undefined) { realClick(close); await pause(300); }
        if (overlayDelta(before) !== "") row.effect += "; overlay stuck";
      }
    }
    // أي تبديل بقي على حالته الجديدة (بلا طبقة ولا تنقّل) يُعاد كي لا يغيّر ما بعده — ومنه طيّ الشريط الجانبي.
    if (el.isConnected && opened === "" && hashAfter === hashBefore && stateAfter !== stateBefore && toggleState(el) !== stateBefore) {
      realClick(el);
      await pause(300);
      row.effect += toggleState(el) === stateBefore ? "; restored" : "; restore failed";
    }
    row.errors = sink.take();
    if (row.errors.length > 0) row.verdict = "ERROR";
    row.ms = Math.round(performance.now() - t0);
    if (globalThis.location.hash !== `#${route}`) await go(route);
    if (overlays().dialogs > baseline.dialogs) { pressEscape(); await pause(300); }
  }
  return page;
}

interface QaState {
  readonly pass: number;
  readonly results: unknown[];
}

function readState(): QaState {
  try {
    const raw = globalThis.sessionStorage.getItem(STATE_KEY);
    return raw !== null ? (JSON.parse(raw) as QaState) : { pass: 0, results: [] };
  } catch {
    return { pass: 0, results: [] };
  }
}

/** السجلات كما يعيدها المضيف عبر النقل الحقيقي: ما يسجّله فعلًا، لا ما تقوله الملفات. */
async function registries(phase03: Phase03Client | undefined, phase04: Phase04Client | undefined, phase08: Phase08Client | undefined): Promise<Record<string, unknown>> {
  const take = async (label: string, call: (() => Promise<{ ok: boolean }>) | undefined): Promise<[string, unknown]> => {
    if (call === undefined) return [label, "client unavailable"];
    try {
      const result = await call();
      return [label, result];
    } catch (error) {
      return [label, `threw: ${error instanceof Error ? error.message : String(error)}`];
    }
  };
  const entries = await Promise.all([
    take("tools", phase04 && (() => phase04.listTools())),
    take("skills", phase04 && (() => phase04.listSkills())),
    take("mcp_servers", phase04 && (() => phase04.listServers())),
    take("agents", phase03 && (() => phase03.listAgents())),
    take("skill_packages", phase08 && (() => phase08.listSkillPackages())),
    take("schedules", phase08 && (() => phase08.listSchedules())),
  ]);
  return Object.fromEntries(entries);
}

/** تعيد التقرير حين تنتهي المرّتان، و`null` حين تُعاد تهيئة الصفحة للمرّة الثانية. */
export async function runQaSuite(
  phase02: Phase02Client,
  phase06: Phase06Client | undefined,
  config: QaSuiteConfig,
  phase03?: Phase03Client,
  phase04?: Phase04Client,
  phase08?: Phase08Client,
): Promise<Record<string, unknown> | null> {
  const state = readState();
  const sink = installErrorSink();
  await waitForMain(15_000);
  await pause(800);
  const marker = config.marker ?? "qa";
  const seed: Record<string, unknown> = {};
  let projectRoute: string | null = null;
  if (state.pass === 0) {
    const created = await phase02.createProject({ name: `QA project ${marker}`, description: "QA control sweep fixture" });
    seed.project = created.ok ? "created" : `failed: ${JSON.stringify(created).slice(0, 200)}`;
    seed.registries = await registries(phase03, phase04, phase08);
  }
  const projects = await phase02.listProjects();
  if (projects.ok) {
    const first = (projects.value as unknown as { projects?: { project_id: string }[] }).projects?.[0];
    if (first !== undefined) projectRoute = `/projects/${first.project_id}`;
  }
  const locale = state.pass === 0 ? "ar" : "en";
  // مسبار رابط التخطّي: يُقاس بعد انتهاء انتقاله، لا لحظة التركيز.
  const probes: Record<string, unknown> = {};
  const skip = doc().querySelector<HTMLAnchorElement>("a.skip-link");
  if (skip !== null) {
    skip.focus();
    await pause(450);
    const r = skip.getBoundingClientRect();
    const hit = doc().elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    probes.skip_link = { focused: doc().activeElement === skip, top: Math.round(r.top), on_screen: r.top >= 0 && r.bottom <= innerHeight, topmost: hit === skip || (hit !== null && skip.contains(hit)), hit: hit === null ? null : describe(hit) };
    skip.blur();
  } else {
    probes.skip_link = "absent";
  }
  const routes = [...ROUTES, ...SECONDARY_ROUTES].map((r) => r.path);
  if (projectRoute !== null) routes.push(projectRoute);
  const rows: ControlRow[] = [];
  const pages: unknown[] = [];
  const budget = { clicks: 1200 };
  for (const route of routes) pages.push(await sweepRoute(locale, route, sink, rows, budget));
  const result = { locale, seed, probes, pages, rows };
  const results = [...state.results, result];
  if (state.pass === 0 && phase06 !== undefined) {
    const set = await phase06.setConfig({ layer: "USER" }, "language.locale", "en");
    globalThis.sessionStorage.setItem(STATE_KEY, JSON.stringify({ pass: 1, results }));
    if (set.ok) {
      globalThis.location.hash = "#/";
      globalThis.location.reload();
      return null;
    }
    return { suite: "qa-controls", stage: config.stage, fatal: "could not switch language", results };
  }
  globalThis.sessionStorage.removeItem(STATE_KEY);
  return { suite: "qa-controls", stage: config.stage, results };
}
