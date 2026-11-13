// نقطة دخول العارض. الملف الوحيد الذي يعرف النقل الحقيقي ويستورد الأنماط.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AppRoot } from "./app/AppRoot";
import { DesktopIpcClient } from "./ipc/client";
import { Phase02Client } from "./ipc/p02-client";
import { Phase03Client } from "./ipc/p03-client";
import { Phase04Client } from "./ipc/p04-client";
import { Phase05Client } from "./ipc/p05-client";
import { Phase06Client } from "./ipc/p06-client";
import { Phase08Client } from "./ipc/p08-client";
import { createId } from "./ipc/envelope";
import { tauriTransport } from "./ipc/tauri-transport";
import { absentTransport, withTimeout } from "./ipc/transport";
import { hasNativeHost } from "./ipc/tauri-transport";
import { isE2EEnabled } from "./e2e/flag";
// ملف تنسيق واحد (وُحِّد من سبعة في 2026-10-01؛ tools/css/consolidate.mjs).
import "./ui/polaris.css";

/** المهلة. رسالة بلا ردّ تصير خطأً مصنَّفًا بدل انتظار بلا نهاية. */
const IPC_TIMEOUT_MS = 8000;

const transport = withTimeout(hasNativeHost() ? tauriTransport : absentTransport, IPC_TIMEOUT_MS);
// الهوية التي يرسلها العارض ادّعاء؛ المضيف يكتب فوقها من النقل. تُولَّد هنا
// لتبقى السلسلة السببية متصلة داخل الجلسة الواحدة.
const identity = { principalId: createId(), sessionId: createId() };
const client = new DesktopIpcClient({ transport, identity });
// نفس النقل ونفس الهوية: عميل ثانٍ مُصنَّف، لا قناة ثانية.
const phase02 = new Phase02Client({ transport, identity });
const phase03 = new Phase03Client({ transport, identity });
const phase04 = new Phase04Client({ transport, identity });
const phase05 = new Phase05Client({ transport, identity });
const phase06 = new Phase06Client({ transport, identity });
const phase08 = new Phase08Client({ transport, identity });

const container = document.getElementById("root");
if (container === null) throw new Error("the renderer has no mount point");

createRoot(container).render(
  <StrictMode>
    <AppRoot
      client={client}
      phase03={phase03}
      phase02={phase02}
      phase04={phase04}
      phase05={phase05}
      phase06={phase06}
      phase08={phase08}
      onReady={(outcome) => {
        // مجموعات القياس تُحمَّل في بناء القياس وحده، فلا تثقل حزمة الإقلاع في المنتج.
        if (isE2EEnabled()) void import("./e2e/run").then(({ runE2ESuite }) => runE2ESuite(client, outcome, phase02, phase03, phase04, phase05, phase06, phase08));
      }}
    />
  </StrictMode>,
);
