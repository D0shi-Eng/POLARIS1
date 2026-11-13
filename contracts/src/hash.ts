// تجزئة SHA-256 فوق التمثيل القانوني. من مكتبة node القياسية، بلا اعتمادية خارجية.

import { createHash } from "node:crypto";

/** يعيد تجزئة سداسية عشرية صغيرة الأحرف لنص UTF-8. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
