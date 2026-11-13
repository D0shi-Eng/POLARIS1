// يولّد desktop/host/app/icons/icon.ico من المصدر المعتمد icons/icon.png.
//
// حتمي: المصدر نفسه يعطي البايتات نفسها. لا مكتبة صور ولا شبكة.
// الاستعمال:
//   node tools\p01-conformance\make-app-icon.mjs --root D:\POLARIS
//   node tools\p01-conformance\make-app-icon.mjs --root D:\POLARIS --check
// مع --check لا يكتب شيئًا، ويفشل إن اختلفت صور الملف الموجود عن المصدر.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isCliEntrypoint } from "../evidence-contract/evidence-bytes.mjs";
import { buildIco, decodeRgbaPng, icoMatchesSource, inspectIco } from "./app-icon.mjs";
import { argument } from "./p01-groups.mjs";

export function generateAppIcon(root) {
  const icons = join(root, "desktop", "host", "app", "icons");
  const source = decodeRgbaPng(readFileSync(join(icons, "icon.png")));
  return { target: join(icons, "icon.ico"), source, bytes: buildIco(source) };
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const root = argument("--root", process.cwd());
  const { target, source, bytes } = generateAppIcon(root);
  const { frames, problems } = inspectIco(bytes);
  if (problems.length > 0) {
    console.error(`generated icon is invalid: ${problems.join("; ")}`);
    process.exit(1);
  }
  if (process.argv.includes("--check")) {
    const same = existsSync(target) && icoMatchesSource(readFileSync(target), source);
    console.log(same ? `icon.ico matches its source (${frames.length} frames)` : "icon.ico drifted from icon.png");
    process.exit(same ? 0 : 1);
  }
  writeFileSync(target, bytes);
  console.log(`wrote ${target} (${bytes.length} bytes, ${frames.map((frame) => frame.width).join("/")})`);
}
