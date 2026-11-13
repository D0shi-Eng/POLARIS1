// تدقيق الوصول (Phase-07): قواعد تُقاس على DOM مرسوم، وعلى رموز الألوان في ملف الأنماط.
//
// ما يُقاس هنا بنية ودلالة وتباين محسوب: الاسم الذي يسمعه قارئ الشاشة لكل عنصر
// تفاعلي، وسمات اللغة والاتجاه، والمعرّفات، والمراجع، وترتيب التنقّل. وما لا يُقاس
// هنا — قارئ شاشة حقيقي على Windows، وتكبير النظام — لا يُدّعى.

export interface A11yFinding {
  readonly rule: string;
  readonly detail: string;
}

const INTERACTIVE = "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], [role=link], [role=checkbox], [role=switch]";

function textOf(element: Element): string {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

function byIds(doc: Document, ids: string | null): string {
  if (ids === null) return "";
  return ids
    .split(/\s+/)
    .filter((id) => id.length > 0)
    .map((id) => (doc.getElementById(id) === null ? "" : textOf(doc.getElementById(id) as Element)))
    .join(" ")
    .trim();
}

/** الاسم المتاح لعنصر تفاعلي، بترتيب مبسّط من خوارزمية الاسم المتاح. */
export function accessibleName(element: Element): string {
  const doc = element.ownerDocument;
  const labelledBy = byIds(doc, element.getAttribute("aria-labelledby"));
  if (labelledBy.length > 0) return labelledBy;
  const aria = (element.getAttribute("aria-label") ?? "").trim();
  if (aria.length > 0) return aria;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea") {
    const id = element.getAttribute("id");
    if (id !== null) {
      const label = doc.querySelector(`label[for="${CSS_ESCAPE(id)}"]`);
      if (label !== null && textOf(label).length > 0) return textOf(label);
    }
    const wrapping = element.closest("label");
    if (wrapping !== null && textOf(wrapping).length > 0) return textOf(wrapping);
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    if ((type === "submit" || type === "button" || type === "reset") && (element.getAttribute("value") ?? "").trim().length > 0) {
      return (element.getAttribute("value") ?? "").trim();
    }
    return (element.getAttribute("title") ?? "").trim();
  }
  const text = textOf(element);
  if (text.length > 0) return text;
  const img = element.querySelector("img[alt]");
  if (img !== null && (img.getAttribute("alt") ?? "").trim().length > 0) return (img.getAttribute("alt") ?? "").trim();
  return (element.getAttribute("title") ?? "").trim();
}

function CSS_ESCAPE(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

function describe(element: Element): string {
  const id = element.getAttribute("id");
  const cls = element.getAttribute("class");
  return `<${element.tagName.toLowerCase()}${id === null ? "" : ` id="${id}"`}${cls === null ? "" : ` class="${cls}"`}>`;
}

/** يدقّق المستند المرسوم كما هو الآن. */
export function auditDocument(doc: Document): A11yFinding[] {
  const findings: A11yFinding[] = [];
  const html = doc.documentElement;
  const lang = html.getAttribute("lang") ?? "";
  const dir = html.getAttribute("dir") ?? "";
  if (lang.length === 0) findings.push({ rule: "document-lang", detail: "<html> has no lang" });
  if (dir !== "ltr" && dir !== "rtl") findings.push({ rule: "document-dir", detail: `<html dir="${dir}">` });

  for (const element of Array.from(doc.querySelectorAll(INTERACTIVE))) {
    if (element.closest("[hidden], [aria-hidden=true]") !== null) continue;
    if (accessibleName(element).length === 0) findings.push({ rule: "control-name", detail: describe(element) });
  }
  for (const img of Array.from(doc.querySelectorAll("img"))) {
    if (!img.hasAttribute("alt")) findings.push({ rule: "img-alt", detail: describe(img) });
  }
  for (const element of Array.from(doc.querySelectorAll("[tabindex]"))) {
    const value = Number(element.getAttribute("tabindex"));
    if (Number.isFinite(value) && value > 0) findings.push({ rule: "tabindex-positive", detail: describe(element) });
  }
  const seen = new Map<string, number>();
  for (const element of Array.from(doc.querySelectorAll("[id]"))) {
    const id = element.getAttribute("id") as string;
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const [id, count] of seen) if (count > 1) findings.push({ rule: "id-unique", detail: `${id} ×${count}` });
  for (const attribute of ["aria-labelledby", "aria-describedby", "aria-controls"]) {
    for (const element of Array.from(doc.querySelectorAll(`[${attribute}]`))) {
      for (const id of (element.getAttribute(attribute) ?? "").split(/\s+/).filter((v) => v.length > 0)) {
        if (doc.getElementById(id) === null) findings.push({ rule: "aria-reference", detail: `${describe(element)} ${attribute}=${id}` });
      }
    }
  }
  const mains = doc.querySelectorAll("main, [role=main]").length;
  if (mains !== 1) findings.push({ rule: "landmark-main", detail: `${mains} main landmark(s)` });
  if (doc.querySelector("h1") === null) findings.push({ rule: "heading-h1", detail: "no h1" });
  return findings;
}

// ——— التباين: WCAG 2.x، نسبة النصوص العادية 4.5:1.

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (match === null) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1] as string, 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** رموز الألوان في كتلة سمة: `--name: #rrggbb;`. */
export function themeTokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no ${selector} block`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const tokens: Record<string, string> = {};
  for (const match of css.slice(open + 1, close).matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    tokens[match[1] as string] = match[2] as string;
  }
  return tokens;
}

/** أزواج النص والخلفية التي يرسمها المنتج فعلًا. */
export const TEXT_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["text-primary", "surface-canvas"],
  ["text-primary", "surface-raised"],
  ["text-primary", "surface-sunken"],
  ["text-primary", "surface-hover"],
  ["text-primary", "surface-selected"],
  ["text-secondary", "surface-canvas"],
  ["text-secondary", "surface-raised"],
  ["text-secondary", "surface-sunken"],
  ["text-muted", "surface-canvas"],
  ["text-muted", "surface-raised"],
  ["text-muted", "surface-sunken"],
  ["accent-text", "accent-subtle"],
  ["accent-text", "surface-raised"],
  ["text-inverted", "accent"],
  ["tone-positive", "tone-positive-subtle"],
  ["tone-neutral", "tone-neutral-subtle"],
  ["tone-muted", "tone-muted-subtle"],
  ["tone-warning", "tone-warning-subtle"],
];
