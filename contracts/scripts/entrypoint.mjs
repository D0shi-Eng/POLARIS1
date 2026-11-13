// كشف الاستدعاء المباشر لوحدة ESM كسكربت سطر أوامر.
//
// السبب الجذري الذي يعالجه هذا الملف: المولّد كان يقارن import.meta.url بالقالب
// `file://${process.argv[1]}`. على Windows يكون الطرف الأول
// file:///D:/POLARIS/contracts/scripts/generate-types.mjs والثاني
// file://D:\POLARIS\contracts\scripts\generate-types.mjs، فلا يتساويان أبدًا.
// النتيجة: `npm run generate` ينتهي بنجاح دون أن يكتب شيئًا ودون أي رسالة،
// فيبقى الملف المولَّد القديم على القرص ويكشفه اختبار الانجراف.
//
// الحل: تحويل مسار argv إلى URL بنفس القواعد التي يستخدمها Node لبناء
// import.meta.url (مسار مطلق، realpath، ثم pathToFileURL) ومقارنة الناتجين.

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * يعيد true إذا كانت الوحدة ذات العنوان moduleUrl هي نقطة دخول العملية.
 * @param {string} moduleUrl قيمة import.meta.url للوحدة.
 * @param {string | undefined} argvPath عادةً process.argv[1].
 * @returns {boolean}
 */
export function isDirectInvocation(moduleUrl, argvPath = process.argv[1]) {
  if (typeof argvPath !== "string" || argvPath.length === 0) return false;
  let absolute = resolve(argvPath);
  try {
    // Node يحلّ الروابط الرمزية لنقطة الدخول قبل بناء import.meta.url.
    absolute = realpathSync(absolute);
  } catch {
    // مسار غير موجود لا يمكن أن يكون نقطة الدخول الحالية؛ المقارنة ستفشل بأمان.
  }
  return pathToFileURL(absolute).href === moduleUrl;
}
