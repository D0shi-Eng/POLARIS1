// حقل رقم (E-1 / T-9، تدقيق 2026-10-19): `input[type=number]` في Chromium وWebView2 يعرض الأرقام بأرقام لغة المتصفّح أو النظام، فظهر
// «١٠٠» في الواجهة الإنجليزية على نظام عربي مع أن القيمة 100. الحقل هنا نصّ بلوحة أرقام (`inputMode="numeric"`) يعرض الأرقام
// اللاتينية دائمًا، ويقبل ما يكتبه المستخدم بالأرقام العربية-الهندية أو الفارسية فيحوّله، ويبقي التحقّق: الحدّان يُعلنان للقارئ
// الآلي ويُعلَّم الحقل غير صالح خارجهما، والمضيف يتحقّق مرة أخرى عند الحفظ.

import type { ChangeEvent } from "react";

import { inRange, normalizeDigits } from "../../localization/digits";

export function NumberField({
  id,
  value,
  onChange,
  min,
  max,
  className,
  describedBy,
}: {
  readonly id: string;
  readonly value: string | number;
  onChange(value: string): void;
  readonly min?: number | null | undefined;
  readonly max?: number | null | undefined;
  readonly className?: string | undefined;
  readonly describedBy?: string | undefined;
}) {
  const negative = (min ?? 0) < 0;
  const text = normalizeDigits(String(value), negative);
  const invalid = text !== "" && !inRange(text, min, max);
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      dir="ltr"
      lang="en"
      autoComplete="off"
      className={className}
      aria-describedby={describedBy}
      aria-invalid={invalid}
      // الحدّان للقارئ الآلي كما كان يقرؤهما من حقل رقم.
      aria-valuemin={min ?? undefined}
      aria-valuemax={max ?? undefined}
      value={text}
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(normalizeDigits(event.target.value, negative))}
    />
  );
}
