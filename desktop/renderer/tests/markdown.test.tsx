// عرض Markdown من مخرجات النموذج: بيانات لا HTML، ومعادلاته تُقرأ بترتيبها داخل النصّ العربي.

import "./support/dom";

import assert from "node:assert/strict";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { Markdown } from "../src/ui/components/Markdown";

function render(source: string): HTMLElement {
  const host = document.createElement("div");
  host.setAttribute("dir", "rtl");
  document.body.appendChild(host);
  act(() => {
    createRoot(host).render(<Markdown source={source} />);
  });
  return host;
}

test("an arithmetic equation inside Arabic text is isolated left-to-right, bold parts included", () => {
  // قيس 2026-10-01: «500,000 − 350,000 = 150,000» عُرضت مقلوبة داخل سطر عربي.
  const host = render("- صافي الربح = 500,000 − 350,000 = **150,000** ريال\n- الربح = 150,000 − 80,000 = **70,000 ريال**\n\nالهامش 30% من الإيرادات.");
  const math = [...host.querySelectorAll("bdi.md__math")];
  assert.equal(math.length, 2, "only the equations are isolated");
  assert.equal(math[0]?.getAttribute("dir"), "ltr");
  assert.equal(math[0]?.textContent, "500,000 − 350,000 = 150,000");
  assert.ok(math[0]?.querySelector("strong")?.textContent === "150,000", "the bold result lost its emphasis");
  // عريض يضمّ الرقم ووحدته حدٌّ واحد: لا تبقى علامات ** ظاهرة.
  assert.equal(math[1]?.textContent, "150,000 − 80,000 = 70,000 ريال");
  assert.ok(!host.textContent?.includes("**"), "raw emphasis markers leaked");
  // رقم منفرد ليس معادلة: يبقى في مجرى النصّ.
  assert.ok(host.textContent?.includes("الهامش 30% من الإيرادات."));
  // لا HTML من المصدر.
  const hostile = render("1 + 1 = <img src=x onerror=alert(1)>");
  assert.equal(hostile.querySelectorAll("img").length, 0);
});
