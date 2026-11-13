// يضع علامة CommonJS في مجلد الاختبارات المبنيّ.
//
// السبب: الحزمة من نوع module، فملفات .js المُخرَجة تُقرأ كـESM. اختبارات العارض
// تُترجَم إلى CommonJS لأن `node --test` يشغّلها مباشرة، ولأن jsdom وreact-dom
// يعملان تحت CJS دون لواحق صريحة في كل استيراد. العلامة هي الطريقة المدعومة
// لقول ذلك لمجلد واحد دون تغيير الحزمة كلها.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "build-tests");
mkdirSync(root, { recursive: true });
writeFileSync(join(root, "package.json"), '{ "type": "commonjs" }\n', "utf8");
console.log("test build marked as commonjs");
