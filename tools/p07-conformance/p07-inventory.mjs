// جرد Phase-07: التبعيات ورخصها، وسطح الشبكة، ومواضع المنصّة في النواة.
//
// الجرد يُقرأ من ملفات القفل ومن المصدر نفسه، لا من قائمة مكتوبة باليد تدّعي الحال:
//   - Cargo.lock وpackage-lock.json: كل حزمة، ومصدرها، وخلاصتها.
//   - `cargo metadata`: رخصة كل صندوق، والمجموعة التي تُشحن فعلًا (تبعيات عادية من
//     ثنائيي المنتج والصيانة)، لا شجرة التطوير.
//   - مصدر Rust بلا كتل الاختبار: كل موضع يفتح مقبسًا، وكل مستعمل لعميل HTTP، وكل
//     عنوان خارجي حرفي، وكل شرط منصّة في النواة.
// ما يظهر ولا يطابق الجدول المعلن هنا يُعلن مخالفةً، لا يُضاف بصمت.
//
// الاستعمال: node p07-inventory.mjs --root <root>

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, header, P07_TOOLS, RAW_DIRECTORY, writeEvidence } from "./p07-common.mjs";

// Phase-08 (ADR-028): منافذ ويندوز حزمة مستقلّة، وعُدّة القياس عضو في مساحة العمل لا يُشحن.
export const WORKSPACE_CRATES = Object.freeze(["polaris-host", "polaris-host-core", "polaris-host-providers", "polaris-maint", "polaris-host-win", "polaris-p08-harness"]);
const CRATES_IO = "registry+https://github.com/rust-lang/crates.io-index";
const NPM_REGISTRY = "https://registry.npmjs.org/";

/** رخص تسمح بالشحن في منتج مغلق المصدر أو مفتوحه بلا شرط نسخ متروك قوي. */
export const PERMISSIVE = Object.freeze([
  "MIT", "MIT-0", "Apache-2.0", "Apache-2.0 WITH LLVM-exception", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "0BSD",
  "BSL-1.0", "Unlicense", "CC0-1.0", "Unicode-3.0", "Unicode-DFS-2016", "MPL-2.0", "CDLA-Permissive-2.0", "BlueOak-1.0.0", "Python-2.0",
]);

/** يقرأ Cargo.lock: كتل `[[package]]` بأسمائها وإصداراتها ومصادرها وخلاصاتها. */
export function parseCargoLock(text) {
  const packages = [];
  for (const block of text.split("[[package]]").slice(1)) {
    const field = (name) => {
      const match = new RegExp(`^${name} = "([^"]*)"`, "m").exec(block);
      return match === null ? null : match[1];
    };
    packages.push({ name: field("name"), version: field("version"), source: field("source"), checksum: field("checksum") });
  }
  return packages;
}

export function classifyCrate(entry) {
  if (entry.source === null) return WORKSPACE_CRATES.includes(entry.name) ? "WORKSPACE" : "UNKNOWN_PATH";
  if (entry.source === CRATES_IO) return entry.checksum !== null && /^[0-9a-f]{64}$/.test(entry.checksum) ? "CRATES_IO" : "CRATES_IO_WITHOUT_CHECKSUM";
  if (entry.source.startsWith("git+")) return "GIT";
  return "OTHER_SOURCE";
}

/** هل تعبير رخصة SPDX يترك بديلًا متساهلًا؟ `A OR B` يكفيه بديل واحد، و`A AND B` يطلبهما. */
export function licenseAllows(expression) {
  if (typeof expression !== "string" || expression.trim() === "") return null;
  const normalised = expression.replace(/\//g, " OR ").replace(/[()]/g, " ");
  return normalised
    .split(/\s+OR\s+/)
    .some((alternative) => alternative.split(/\s+AND\s+/).every((term) => PERMISSIVE.includes(term.trim())));
}

function cargoMetadata(root) {
  const cargo = process.platform === "win32" ? "cargo.exe" : "cargo";
  for (const extra of [["--offline"], []]) {
    // على Windows تُحصر الشجرة في هدف الإصدار، فلا تُعدّ تبعيات Linux وmacOS في المشحون.
    const platform = process.platform === "win32" ? ["--filter-platform", "x86_64-pc-windows-msvc"] : [];
    const result = spawnSync(cargo, ["metadata", "--format-version", "1", "--locked", ...platform, ...extra], {
      cwd: join(root, "desktop", "host"),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      shell: false,
    });
    if (result.status === 0) {
      try {
        return { metadata: JSON.parse(result.stdout), mode: extra.length > 0 ? "offline" : "online", error: null };
      } catch (error) {
        return { metadata: null, mode: "unparsable", error: String(error) };
      }
    }
    if (extra.length === 0) return { metadata: null, mode: "failed", error: (result.stderr ?? "").split("\n").slice(-5).join(" ") };
  }
  return { metadata: null, mode: "failed", error: "unreachable" };
}

/** المجموعة المشحونة: كل ما تصل إليه التبعيات العادية من ثنائيي المنتج والصيانة. */
export function shippedCrates(metadata) {
  const byId = new Map(metadata.packages.map((p) => [p.id, p]));
  const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
  const roots = metadata.packages.filter((p) => p.name === "polaris-host" || p.name === "polaris-maint").map((p) => p.id);
  const seen = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dep of nodes.get(id)?.deps ?? []) {
      const normal = (dep.dep_kinds ?? []).some((k) => k.kind === null);
      if (normal) queue.push(dep.pkg);
    }
  }
  return [...seen].map((id) => byId.get(id)).filter((p) => p !== undefined);
}

export function cargoInventory(root) {
  const lockPath = join(root, "desktop", "host", "Cargo.lock");
  const locked = existsSync(lockPath) ? parseCargoLock(readFileSync(lockPath, "utf8")) : [];
  const classes = {};
  for (const entry of locked) classes[classifyCrate(entry)] = (classes[classifyCrate(entry)] ?? 0) + 1;
  const offenders = locked.filter((e) => !["WORKSPACE", "CRATES_IO"].includes(classifyCrate(e))).map((e) => `${e.name}@${e.version} ${classifyCrate(e)}`);
  const { metadata, mode, error } = cargoMetadata(root);
  let licenses = { measured: false, mode, error };
  if (metadata !== null) {
    const shipped = shippedCrates(metadata).filter((p) => !WORKSPACE_CRATES.includes(p.name));
    const rows = shipped.map((p) => ({ name: p.name, version: p.version, license: p.license ?? null, license_file: p.license_file !== null && p.license_file !== undefined }));
    const unknown = rows.filter((r) => r.license === null && !r.license_file);
    const restrictive = rows.filter((r) => r.license !== null && licenseAllows(r.license) === false);
    const byLicense = {};
    for (const r of rows) byLicense[r.license ?? "(license file)"] = (byLicense[r.license ?? "(license file)"] ?? 0) + 1;
    licenses = {
      measured: true,
      mode,
      error: null,
      shipped_crates: rows.length,
      by_license: byLicense,
      unknown: unknown.map((r) => `${r.name}@${r.version}`),
      without_permissive_alternative: restrictive.map((r) => `${r.name}@${r.version} (${r.license})`),
      license_file_only: rows.filter((r) => r.license === null && r.license_file).map((r) => `${r.name}@${r.version}`),
    };
  }
  return { lock_present: locked.length > 0, packages: locked.length, classes, offenders, licenses };
}

export function npmInventory(root, directory) {
  const path = join(root, directory, "package-lock.json");
  if (!existsSync(path)) return { directory, present: false };
  const lock = JSON.parse(readFileSync(path, "utf8"));
  const entries = Object.entries(lock.packages ?? {}).filter(([key]) => key !== "" && key.includes("node_modules/"));
  const rows = entries.map(([key, value]) => ({
    name: key.slice(key.lastIndexOf("node_modules/") + "node_modules/".length),
    version: value.version ?? null,
    resolved: value.resolved ?? null,
    integrity: value.integrity ?? null,
    license: value.license ?? null,
    dev: value.dev === true,
    // حزمة من المستودع نفسه (`file:../contracts`) ليست تبعية خارجية: مصدرها هنا ورخصتها رخصة المشروع.
    link: value.link === true || String(value.resolved ?? "").startsWith("file:"),
    install_script: value.hasInstallScript === true,
  }));
  const registry = rows.filter((r) => !r.link);
  const offenders = registry
    .filter((r) => r.resolved === null || !r.resolved.startsWith(NPM_REGISTRY) || r.integrity === null || !r.integrity.startsWith("sha512-"))
    .map((r) => `${r.name}@${r.version}`);
  const shipped = registry.filter((r) => !r.dev);
  const restrictive = shipped.filter((r) => licenseAllows(r.license) === false).map((r) => `${r.name}@${r.version} (${r.license})`);
  const unknown = shipped.filter((r) => licenseAllows(r.license) === null).map((r) => `${r.name}@${r.version}`);
  return {
    directory,
    present: true,
    packages: rows.length,
    links: rows.filter((r) => r.link).map((r) => r.name),
    offenders,
    install_scripts: rows.filter((r) => r.install_script).map((r) => `${r.name}@${r.version}`),
    shipped: shipped.map((r) => `${r.name}@${r.version} ${r.license ?? "?"}`),
    shipped_without_permissive_alternative: restrictive,
    shipped_license_unknown: unknown,
  };
}

// ——— المصدر

function walk(directory, extensions, found = []) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "target", "target-e2e", "dist", "build-tests", "generated", "gen"].includes(entry.name)) continue;
      walk(full, extensions, found);
    } else if (extensions.includes(extname(entry.name).toLowerCase())) {
      found.push(full);
    }
  }
  return found;
}

/** مصدر المنتج: بلا كتلة الاختبارات وبلا التعليقات السطرية. */
export function productCode(text) {
  const index = text.indexOf("#[cfg(test)]");
  const body = index >= 0 ? text.slice(0, index) : text;
  return body
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
}

const rel = (root, file) => relative(root, file).replace(/\\/g, "/");

/** المواضع المعلنة التي يجوز أن تفتح مقبسًا، ومستعملو عميل HTTP وحارس كل منهم. */
export const DECLARED_SOCKET_FILES = Object.freeze([
  "desktop/host/providers/src/net/http.rs",
  // Phase-08 (ADR-028): مستمع رجوع OAuth على 127.0.0.1:0، ومقبس CDP إلى متصفّح يملكه POLARIS. حلقة محلية حرفية وحدها.
  "desktop/host/providers/src/net/loopback.rs",
]);
export const DECLARED_SOCKET_USERS = Object.freeze(["desktop/host/providers/src/net/cancel.rs", "desktop/host/providers/src/net/sliced.rs"]);
export const DECLARED_HTTP_USERS = Object.freeze({
  "desktop/host/core/src/p02/mod.rs": "constructs the single process HTTP client",
  "desktop/host/core/src/p02/providers/discovery.rs": "model discovery: endpoint policy",
  "desktop/host/core/src/p02/invocation/service.rs": "model invocation: routing, local-only, egress policy, budgets",
  "desktop/host/core/src/p04/broker.rs": "tool broker passes the client to approved tools only",
  "desktop/host/core/src/p04/mcp/client.rs": "MCP servers the user registered, loopback by default",
  "desktop/host/core/src/p04/service.rs": "wires the MCP client",
  "desktop/host/core/src/p05/browser/engine.rs": "browser fetch: navigation policy, no private network",
  "desktop/host/core/src/p05/browser/runtime.rs": "browser sessions under approval",
  "desktop/host/core/src/p05/browser/tools.rs": "browser tools behind the tool gateway",
  "desktop/host/core/src/p05/service.rs": "wires the browser runtime",
  "desktop/host/core/src/p06/connector/rest.rs": "REST connector: fixed base, paths, no redirects",
  "desktop/host/core/src/p06/connector/gateway.rs": "connector gateway: policy, privacy, egress, approval",
  "desktop/host/core/src/p06/service.rs": "wires the connector gateway",
  // Phase-08 (ADR-028).
  "desktop/host/core/src/p08/service.rs": "wires the browser, OAuth and transcription services",
  "desktop/host/core/src/p08/browser/intercept.rs": "real browser: every intercepted request passes the navigation policy; no redirects followed; writes need approval",
  "desktop/host/core/src/p08/browser/service.rs": "real browser sessions, one per mission",
  "desktop/host/core/src/p08/browser/session.rs": "real browser session: hands the client to its interceptor only",
  "desktop/host/core/src/p08/oauth.rs": "OAuth token endpoint of a documented provider template the user configured",
  "desktop/host/core/src/p08/integrations/voice.rs": "transcription: loopback server only, refused otherwise",
});
/** شروط المنصّة المعلنة في النواة، وسبب كل منها. شرط جديد لا يُضاف بصمت. */
export const DECLARED_CORE_PLATFORM_SITES = Object.freeze({
  "desktop/host/core/src/services/platform_info.rs": "reports the platform identity to the renderer; a fact, not a behaviour",
  "desktop/host/core/src/p05/browser/runtime.rs": "writes the Windows Zone.Identifier (Mark of the Web) on quarantined downloads",
  "desktop/host/core/src/p02/projects/workspace.rs": "Windows path case-insensitivity when confining a workspace",
  "desktop/host/core/src/p02/mod.rs": "the test configuration names the platform it runs on",
});
/** العناوين الخارجية الحرفية المعلنة: نقاط نهاية افتراضية لمزوّدين لا تُستعمل إلا إن فعّلها المستخدم. */
export const DECLARED_URL_FILES = Object.freeze([
  "desktop/host/providers/src/catalog.rs",
  // Phase-08 (ADR-028): نقاط تفويض ورموز موثّقة لقالبَي Google وMicrosoft، لا تُستعمل إلا إن ربطها المستخدم بمعرّف عميله.
  "desktop/host/core/src/p08/oauth.rs",
]);
/** مضيفو معرّفات أسماء XML (OOXML وDublin Core وSVG): معرّفات داخل الملف لا عناوين يُتصل بها أبدًا. */
export const DECLARED_NAMESPACE_HOSTS = Object.freeze(["schemas.openxmlformats.org", "schemas.microsoft.com", "purl.org", "www.w3.org"]);

const LOOPBACK = /^(127\.|localhost|\[?::1|tauri\.localhost|ipc\.localhost|0\.0\.0\.0)/;

export function networkSurface(root) {
  const rust = ["desktop/host/core/src", "desktop/host/providers/src", "desktop/host/app/src", "desktop/host/maint/src", "desktop/host/win/src"].flatMap((d) => walk(join(root, d), [".rs"]));
  const sockets = [];
  const socketUsers = [];
  const httpUsers = [];
  const literals = [];
  for (const file of rust) {
    const text = productCode(readFileSync(file, "utf8"));
    const name = rel(root, file);
    if (/TcpStream::connect|UdpSocket::bind|TcpListener::bind/.test(text)) sockets.push(name);
    else if (/\b(TcpStream|UdpSocket|TcpListener)\b/.test(text)) socketUsers.push(name);
    if (/\bHttpClient\b/.test(text) && name.startsWith("desktop/host/core/")) httpUsers.push(name);
    for (const match of text.matchAll(/https?:\/\/([A-Za-z0-9.\-\[\]:]+)/g)) {
      if (!LOOPBACK.test(match[1]) && !DECLARED_NAMESPACE_HOSTS.includes(match[1])) literals.push(`${name}: ${match[1]}`);
    }
  }
  const renderer = walk(join(root, "desktop", "renderer", "src"), [".ts", ".tsx"]);
  const rendererNetwork = [];
  for (const file of renderer) {
    const text = readFileSync(file, "utf8");
    if (/\b(fetch\s*\(|XMLHttpRequest|new\s+WebSocket|EventSource|sendBeacon)/.test(text)) rendererNetwork.push(rel(root, file));
  }
  const tauri = JSON.parse(readFileSync(join(root, "desktop", "host", "app", "tauri.conf.json"), "utf8"));
  const csp = tauri?.app?.security?.csp ?? "";
  const connect = /connect-src ([^;]*)/.exec(csp)?.[1]?.trim() ?? "";
  return {
    socket_openers: sockets,
    undeclared_socket_openers: sockets.filter((f) => !DECLARED_SOCKET_FILES.includes(f)),
    socket_users: socketUsers,
    undeclared_socket_users: socketUsers.filter((f) => !DECLARED_SOCKET_USERS.includes(f) && !DECLARED_SOCKET_FILES.includes(f)),
    http_client_users: httpUsers.map((f) => ({ file: f, guard: DECLARED_HTTP_USERS[f] ?? null })),
    undeclared_http_users: httpUsers.filter((f) => DECLARED_HTTP_USERS[f] === undefined),
    external_literals: literals,
    undeclared_literals: literals.filter((l) => !DECLARED_URL_FILES.some((f) => l.startsWith(`${f}:`))),
    renderer_network_api_files: rendererNetwork,
    csp_connect_src: connect,
    telemetry: "no telemetry endpoint: every external literal is a user-enabled provider default",
  };
}

export function platformSites(root) {
  const sites = [];
  for (const file of walk(join(root, "desktop", "host", "core", "src"), [".rs"])) {
    const text = productCode(readFileSync(file, "utf8"));
    const count = (text.match(/cfg!\(windows\)|cfg\(windows\)|target_os|cfg\(unix\)|cfg\(not\(windows\)\)/g) ?? []).length;
    if (count > 0) sites.push({ file: rel(root, file), sites: count, reason: DECLARED_CORE_PLATFORM_SITES[rel(root, file)] ?? null });
  }
  const app = ["lib.rs", "platform.rs", "credentials.rs", "desktop_win32.rs", "shutdown.rs", "window.rs"].map((f) => `desktop/host/app/src/${f}`).filter((f) => existsSync(join(root, f)));
  return {
    core_sites: sites,
    undeclared_core_sites: sites.filter((s) => s.reason === null).map((s) => s.file),
    windows_adapter_files: app,
    non_windows_fallbacks: {
      desktop_port: /UnavailableDesktop/.test(readFileSync(join(root, "desktop/host/app/src/lib.rs"), "utf8")),
      credential_store: /UnavailableCredentialStore/.test(readFileSync(join(root, "desktop/host/app/src/platform.rs"), "utf8")),
      managed_policy_path: /if !cfg!\(windows\)/.test(readFileSync(join(root, "desktop/host/app/src/platform.rs"), "utf8")),
    },
    macos_native_verified: false,
    macos_note: "no macOS machine is part of this run: nothing here was built or executed on macOS",
  };
}

export function inventory(root) {
  return {
    cargo: cargoInventory(root),
    npm: ["contracts", "runtime", "desktop/renderer"].map((d) => npmInventory(root, d)),
    network: networkSurface(root),
    platform: platformSites(root),
  };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = inventory(root);
  writeEvidence(join(root, RAW_DIRECTORY, "inventory.local.json"), { ...header(P07_TOOLS.inventory, root), ...result });
  const c = result.cargo;
  console.log(`cargo: ${c.packages} locked, offenders ${c.offenders.length}; licenses ${c.licenses.measured ? `${c.licenses.shipped_crates} shipped, unknown ${c.licenses.unknown.length}, no permissive alternative ${c.licenses.without_permissive_alternative.length}` : `NOT MEASURED (${c.licenses.mode})`}`);
  for (const n of result.npm) console.log(`npm ${n.directory}: ${n.present ? `${n.packages} packages, offenders ${n.offenders.length}, shipped ${n.shipped.length}, restrictive ${n.shipped_without_permissive_alternative.length}, unknown ${n.shipped_license_unknown.length}` : "absent"}`);
  const w = result.network;
  console.log(`network: socket openers ${w.socket_openers.join(",")}; undeclared ${w.undeclared_socket_openers.length + w.undeclared_socket_users.length + w.undeclared_http_users.length + w.undeclared_literals.length}; renderer network files ${w.renderer_network_api_files.length}; connect-src ${w.csp_connect_src}`);
  console.log(`platform: core sites ${result.platform.core_sites.length}, undeclared ${result.platform.undeclared_core_sites.length}`);
}
