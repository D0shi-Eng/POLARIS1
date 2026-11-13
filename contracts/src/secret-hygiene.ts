// كشف الأسرار في الحقول المسموح فيها بنص حر محدود (metadata في سجل التدقيق).
// هذا حارس احتياطي وليس ضمانًا: يمنع الأنماط المعروفة، ولا يدّعي منع كل سر ممكن.
// الادعاء المُثبَت في W2 هو أن المفاتيح والقيم المطابقة لهذه الأنماط تُرفض، لا أكثر.

/** أسماء مفاتيح تدل على سر بحكم التسمية. */
const SECRET_KEY_PATTERN =
  /(^|[._-])(password|passwd|secret|token|api_key|apikey|access_key|private_key|credential|credentials|authorization|auth_token|session_token|refresh_token|client_secret|bearer)([._-]|$)/i;

/** بادئات ورموز اعتماد معروفة الشكل. */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/i,
];

export interface SecretFinding {
  readonly pointer: string;
  readonly reason: "SECRET_LIKE_KEY" | "SECRET_LIKE_VALUE";
  readonly detail: string;
}

/** يفحص خريطة metadata المحدودة. لا يُستدعى على الحمولات المعتمة التي لا يملكها التدقيق. */
export function findSecrets(metadata: Record<string, unknown> | undefined, basePointer: string): SecretFinding[] {
  if (metadata === undefined) return [];

  const findings: SecretFinding[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    const pointer = `${basePointer}/${key}`;

    if (SECRET_KEY_PATTERN.test(key)) {
      findings.push({ pointer, reason: "SECRET_LIKE_KEY", detail: `key "${key}" names a credential` });
      continue;
    }

    if (typeof value !== "string") continue;

    for (const pattern of SECRET_VALUE_PATTERNS) {
      if (pattern.test(value)) {
        // لا نُدرج القيمة نفسها في التقرير حتى لا نسرّب السر داخل رسالة الخطأ.
        findings.push({ pointer, reason: "SECRET_LIKE_VALUE", detail: "value matches a known credential shape" });
        break;
      }
    }
  }
  return findings;
}

/** يهرب مقطع مفتاح إلى مؤشر RFC 6901 صالح. */
function escapePointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * فحص عميق لحمولة كاملة، لا لخريطة مسطحة.
 *
 * يستعمل الأنماط نفسها أعلاه ولا يعرّف كشفًا ثانيًا: قاعدة واحدة، ومستهلكان.
 * الحاجة إليه ظهرت مع حمولات سطح المكتب في P01: هناك الأسرار المحتملة تسكن
 * داخل مصفوفات وكائنات متداخلة، لا في خريطة metadata من مستوى واحد.
 *
 * العمق محدود عمدًا: حمولة أعمق من هذا الحد تُبلَّغ عيبًا بدل أن تُفحص جزئيًا،
 * لأن فحصًا يتوقف في المنتصف ويقول «نظيف» أسوأ من فحص يقول «لم أستطع».
 */
export function findSecretsDeep(value: unknown, basePointer: string, maxDepth = 12): SecretFinding[] {
  const findings: SecretFinding[] = [];

  const walk = (node: unknown, pointer: string, depth: number): void => {
    if (depth > maxDepth) {
      findings.push({ pointer, reason: "SECRET_LIKE_VALUE", detail: "payload nesting exceeds the scanned depth" });
      return;
    }

    if (typeof node === "string") {
      for (const pattern of SECRET_VALUE_PATTERNS) {
        if (pattern.test(node)) {
          findings.push({ pointer, reason: "SECRET_LIKE_VALUE", detail: "value matches a known credential shape" });
          return;
        }
      }
      return;
    }

    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pointer}/${String(index)}`, depth + 1));
      return;
    }

    if (typeof node !== "object" || node === null) return;

    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      const childPointer = `${pointer}/${escapePointerSegment(key)}`;
      if (SECRET_KEY_PATTERN.test(key)) {
        findings.push({ pointer: childPointer, reason: "SECRET_LIKE_KEY", detail: `key "${key}" names a credential` });
        continue;
      }
      walk(child, childPointer, depth + 1);
    }
  };

  walk(value, basePointer, 0);
  return findings;
}
