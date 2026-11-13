// مخرجات الإصدار المرشّح تحت release/rc: ما يحتاجه من يوزّع الإصدار لاحقًا، مكتوبًا
// من القياس لا من الأمل.
//
//   SHA256SUMS.txt                 خلاصة كل ملف مُسلَّم.
//   release-manifest.json          الإصدار، والملفات، وحالة التوقيع، وأحكام المنصّات.
//   update-manifest.unsigned.json  بيان تحديث بصيغة polaris.update/1، غير موقَّع: يوقّعه
//                                  مفتاح الإصدار حين يوجد، ولا يُوقَّع هنا بمفتاح مخترع.
//   sbom.json                      التبعيات المشحونة (Rust وnpm) بإصداراتها ورخصها وخلاصاتها.
//
// لا شيء هنا يُرفع أو يُنشر.
//
// الاستعمال: node p07-release.mjs --root <root>

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { argument, canonicalJson, header, P07_TOOLS, RAW_DIRECTORY, readJson, RELEASE_DIRECTORY, stamp, writeEvidence } from "./p07-common.mjs";
import { parseCargoLock } from "./p07-inventory.mjs";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function releaseArtifacts(root) {
  const dir = join(root, RELEASE_DIRECTORY);
  mkdirSync(dir, { recursive: true });
  const conf = JSON.parse(readFileSync(join(root, "desktop", "host", "app", "tauri.conf.json"), "utf8"));
  const version = conf.version;
  const installers = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith("-setup.exe")) : [];
  const current = installers.filter((f) => f.includes(`_${version}_`));
  const files = current.map((name) => {
    const path = join(dir, name);
    return { name, platform: "windows-x86_64", sha256: sha256(path), bytes: readFileSync(path).length };
  });
  const signing = readJson(join(root, RAW_DIRECTORY, "signing.local.json"));
  const inventory = readJson(join(root, RAW_DIRECTORY, "inventory.local.json"));

  writeFileSync(join(dir, "SHA256SUMS.txt"), files.map((f) => `${f.sha256}  ${f.name}`).join("\n") + (files.length > 0 ? "\n" : ""), "utf8");

  const unsigned = {
    format: "polaris.update/1",
    product: "POLARIS",
    channel: "rc",
    version,
    released_at: stamp(),
    artifacts: files,
  };
  writeFileSync(join(dir, "update-manifest.unsigned.json"), canonicalJson(unsigned), "utf8");

  const lock = existsSync(join(root, "desktop", "host", "Cargo.lock")) ? parseCargoLock(readFileSync(join(root, "desktop", "host", "Cargo.lock"), "utf8")) : [];
  const checksums = new Map(lock.map((p) => [`${p.name}@${p.version}`, p.checksum]));
  const crates = inventory?.cargo?.licenses?.measured === true ? inventory.cargo : null;
  const rendererNpm = (inventory?.npm ?? []).find((n) => n.directory === "desktop/renderer");
  const sbom = {
    format: "polaris.sbom/1",
    product: "POLARIS",
    version,
    generated_at: stamp(),
    note: "components that ship: normal dependencies of the product and maintenance binaries (Rust) and the renderer's runtime packages (npm)",
    rust: crates === null ? { measured: false } : { measured: true, components: crates.licenses.shipped_crates, by_license: crates.licenses.by_license, lock_checksums: lock.filter((p) => p.checksum !== null).length },
    rust_components: lock.filter((p) => p.source !== null).map((p) => ({ name: p.name, version: p.version, checksum: checksums.get(`${p.name}@${p.version}`) })),
    npm_components: rendererNpm?.shipped ?? [],
  };
  writeFileSync(join(dir, "sbom.json"), canonicalJson(sbom), "utf8");

  const manifest = {
    format: "polaris.release/1",
    product: "POLARIS",
    version,
    channel: "rc",
    built_at: stamp(),
    artifacts: files,
    signing: signing === null ? { status: "NOT_MEASURED" } : { status: signing.status, reason: signing.reason, files: signing.files },
    platforms: {
      windows: "release platform: Windows 11 x64, per-user NSIS installer",
      macos: "FOUNDATION_ONLY: not built or executed on macOS in this run",
    },
    published: false,
  };
  writeFileSync(join(dir, "release-manifest.json"), canonicalJson(manifest), "utf8");
  return { directory: RELEASE_DIRECTORY.replace(/\\/g, "/"), version, installers: current, files, written: ["SHA256SUMS.txt", "update-manifest.unsigned.json", "sbom.json", "release-manifest.json"], signing: manifest.signing.status };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const result = releaseArtifacts(root);
  writeEvidence(join(root, RAW_DIRECTORY, "release.local.json"), { ...header(P07_TOOLS.release, root), ...result });
  console.log(`release ${result.version}: installers ${result.installers.join(", ") || "none"}; signing ${result.signing}`);
}
