// مسبار «النموذج الأولي المجمَّد».
//
// Tauri يجمّد `Object.prototype` داخل WebView (`freezePrototype: true`). تحت هذا
// القيد يرمي أي إسناد إلى خاصية موروثة للقراءة فقط، مثل `props.valueOf = ...`
// الذي كان React يبنيه من خاصية JSX باسم `valueOf`، فانهارت شاشة الإعدادات وسقطت
// الشجرة كلها في النافذة الأصلية بينما نجحت اختبارات jsdom.
//
// يعمل في عملية مستقلة لأن التجميد لا رجعة فيه: تُحمَّل الوحدات أولًا، ثم يُجمَّد
// النموذج كما يفعل Tauri بعد تحميل سكربتاته، ثم تُرسم كل الأقسام.

import "./dom";

import { act } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "../../src/app/AppRoot";
import { DesktopIpcClient } from "../../src/ipc/client";
import { memoryLocation } from "../../src/routes/location";
import { ROUTES } from "../../src/routes/registry";
import { fakeHost, IDENTITY } from "./fake-host";
import { resetDocument } from "./dom";

interface RouteOutcome {
  readonly path: string;
  readonly title: string;
  readonly shell: boolean;
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (...parts: unknown[]) => {
    errors.push(parts.map((part) => (part instanceof Error ? `${part.name}: ${part.message}` : String(part))).join(" "));
  };

  Object.freeze(Object.prototype);

  const outcomes: RouteOutcome[] = [];
  for (const path of [...ROUTES.map((route) => route.path), "/not-a-section"]) {
    const container = resetDocument();
    const root = createRoot(container);
    const client = new DesktopIpcClient({ transport: fakeHost(), identity: IDENTITY });
    try {
      await act(async () => {
        root.render(<AppRoot client={client} location={memoryLocation(path)} />);
      });
      await act(async () => {
        await Promise.resolve();
      });
    } catch (error) {
      errors.push(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    }
    outcomes.push({
      path,
      title: document.querySelector(".page-title")?.textContent?.trim() ?? "",
      shell: document.querySelector(".shell__rail") !== null,
    });
    act(() => root.unmount());
  }

  console.error = originalError;
  process.stdout.write(`${JSON.stringify({ frozen: Object.isFrozen(Object.prototype), outcomes, errors })}\n`);
}

main().catch((error: unknown) => {
  process.stdout.write(`${JSON.stringify({ fatal: String(error) })}\n`);
  process.exitCode = 1;
});
