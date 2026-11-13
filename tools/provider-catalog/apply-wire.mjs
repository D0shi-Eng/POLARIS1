// يكتب جدول الصياغة (wire.mjs) في الفهرس المولَّد القائم دون إعادة تنزيل اللقطة. المولّد نفسه يستورد الجدول، فإعادة
// التوليد لاحقًا تحمله كذلك.
//
//   node tools/provider-catalog/apply-wire.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIRE } from "./wire.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "desktop", "host", "providers", "data", "hosted-catalog.json");
const catalog = JSON.parse(readFileSync(out, "utf8"));
let applied = 0;
for (const entry of catalog.hosted) {
  if (WIRE[entry.id]) {
    entry.wire = WIRE[entry.id];
    applied += 1;
  } else {
    delete entry.wire;
  }
}
const missing = Object.keys(WIRE).filter((id) => !catalog.hosted.some((h) => h.id === id));
writeFileSync(out, JSON.stringify(catalog) + "\n", "utf8");
console.log(`wire applied to ${applied}; not in catalog: ${missing.join(", ") || "none"}`);
