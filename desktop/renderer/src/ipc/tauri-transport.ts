// تحقيق النقل فوق Tauri. الملف الوحيد في العارض الذي يستورد الإطار.
//
// معزول عمدًا: اختبارات العارض تحقن نقلًا آخر ولا تحمّل هذا الملف، ولذلك تعمل
// خارج نافذة أصلية. وتغيير المضيف لاحقًا يبدّل هذا الملف وحده.

import { invoke } from "@tauri-apps/api/core";

import type { Transport } from "./transport";
import { TransportUnavailable } from "./transport";

/** هل نحن داخل المضيف الأصلي فعلًا؟ */
export function hasNativeHost(): boolean {
  return typeof (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "object";
}

/** الأمر الوحيد الذي يعرفه العارض. لا اسم عملية يُمرَّر هنا: الظرف يحمل ذلك. */
const COMMAND = "polaris_ipc";

export const tauriTransport: Transport = {
  async send(envelope: unknown): Promise<unknown> {
    if (!hasNativeHost()) throw new TransportUnavailable();
    return invoke<unknown>(COMMAND, { envelope });
  },
};
