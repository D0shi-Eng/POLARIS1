// عرض Phase-08: تحويل ما يقيسه المضيف إلى سطور يقرؤها المستخدم، بلا تفكير داخلي للنموذج.
//
// سطر النشاط يُبنى من معرّف الأداة وحالتها وملخّصها الذي كتبه المضيف، لا من نثر الوكيل.

import type { ToolInvocationViewV1 } from "../generated/types/desktop-p04-result-v1";

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

/** مفتاح توطين لفعل أداة. أداة غير معروفة تُعرض بمعرّفها ضمن صياغة عامّة. */
export function activityKey(toolId: string): string {
  const known = [
    "polaris.execution.command",
    "polaris.execution.python",
    "polaris.artifact.document",
    "polaris.artifact.presentation",
    "polaris.artifact.spreadsheet",
    "polaris.artifact.register",
    "polaris.workspace.list",
    "polaris.workspace.read",
    "polaris.workspace.write",
    "polaris.workspace.export",
    "polaris.workspace.move",
    "polaris.workspace.delete",
    "polaris.browser.open",
    "polaris.browser.read",
    "polaris.browser.click",
    "polaris.browser.type",
    "polaris.browser.select",
    "polaris.browser.press",
    "polaris.browser.scroll",
    "polaris.browser.wait",
    "polaris.browser.history",
    "polaris.browser.screenshot",
    "polaris.browser.upload",
    "polaris.browser.tabs",
    "polaris.browser.permit_write",
    "polaris.browser.close",
    "polaris.web.navigate",
    "polaris.web.read_page",
    "polaris.memory.propose",
    "polaris.package.zip",
    "polaris.provider.rate_limited",
  ];
  return known.includes(toolId) ? `p08.act.${toolId.replace(/^polaris\./, "").replace(/\./g, "_")}` : "p08.act.other";
}

/** طور المهمّة الظاهر للمستخدم (Phase-08): من حالتها وآخر نداء أداة وملخّصه الذي قاسه المضيف.
 * لا نثر نموذج ولا سلسلة تفكير: مفتاح توطين ثابت فقط. */
export function phaseKey(state: string, stopping: boolean, hasTasks: boolean, last: ToolInvocationViewV1 | undefined, pendingApprovals: number): string {
  if (state === "CANCELLED") return "p08.phase.cancelled";
  if (stopping) return "p08.phase.cancelling";
  if (pendingApprovals > 0 || state === "WAITING_FOR_APPROVAL") return "p08.phase.waiting_approval";
  if (state === "PLANNING" || !hasTasks) return "p08.phase.planning";
  if (last === undefined) return "p08.phase.working";
  const summary = last.summary ?? "";
  const id = last.tool_id;
  if (summary.includes("tests: TESTS_FAILED")) return "p08.phase.tests_failed";
  if (summary.includes("tests: TESTS_PASSED")) return "p08.phase.tests_passed";
  if (id === "polaris.execution.command" || id === "polaris.execution.python") return last.status === "SUCCEEDED" ? "p08.phase.code_ran" : "p08.phase.running_code";
  if (id === "polaris.workspace.read" || id === "polaris.workspace.list") return "p08.phase.reading_files";
  if (id === "polaris.workspace.write") return "p08.phase.editing_file";
  if (id === "polaris.artifact.spreadsheet") return "p08.phase.creating_spreadsheet";
  if (id === "polaris.artifact.document") return summary.startsWith("PDF") ? "p08.phase.generating_pdf" : "p08.phase.creating_document";
  if (id === "polaris.artifact.register") return "p08.phase.verifying_artifact";
  if (id === "polaris.package.zip") return "p08.phase.packaging";
  if (id.startsWith("polaris.browser.") || id.startsWith("polaris.web.")) return "p08.phase.browsing";
  return "p08.phase.working";
}

export function invocationTone(invocation: ToolInvocationViewV1): Tone {
  switch (invocation.status) {
    case "SUCCEEDED":
      return "ok";
    case "AWAITING_APPROVAL":
      return "warn";
    case "DENIED":
    case "FAILED":
      return "bad";
    default:
      return "info";
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

/** أيقونة نصّية لنوع ملف، للعرض فقط. */
export function fileGlyph(path: string, isDir: boolean): string {
  if (isDir) return "▸";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (["docx", "doc", "md", "txt", "pdf"].includes(ext)) return "¶";
  if (["xlsx", "csv"].includes(ext)) return "▦";
  if (["pptx"].includes(ext)) return "▭";
  if (["png", "jpg", "jpeg", "gif", "webp"].includes(ext)) return "◩";
  if (["html", "htm", "css", "js", "ts", "py", "rs", "json"].includes(ext)) return "‹›";
  return "•";
}

export const QUICK_ACTIONS: readonly { readonly id: string; readonly titleKey: string; readonly promptKey: string }[] = [
  { id: "research", titleKey: "p08.quick.research", promptKey: "p08.quick.research.prompt" },
  { id: "report", titleKey: "p08.quick.report", promptKey: "p08.quick.report.prompt" },
  { id: "data", titleKey: "p08.quick.data", promptKey: "p08.quick.data.prompt" },
  { id: "deck", titleKey: "p08.quick.deck", promptKey: "p08.quick.deck.prompt" },
  { id: "website", titleKey: "p08.quick.website", promptKey: "p08.quick.website.prompt" },
  { id: "code", titleKey: "p08.quick.code", promptKey: "p08.quick.code.prompt" },
];

/** عنوان مهمّة من أول سطر في الطلب: مقتضب، بلا اختراع. */
export function titleFromPrompt(prompt: string): string {
  const first = prompt.trim().split(/\n/)[0] ?? "";
  const cleaned = first.replace(/\s+/g, " ").trim();
  return cleaned.length <= 80 ? cleaned : `${cleaned.slice(0, 77)}…`;
}
