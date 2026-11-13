// العلامة: نجمة رباعية بسيطة، مرسومة هندسيًا هنا ولا تشبه علامة أحد.
//
// `aria-hidden` لأن الاسم بجوارها نصّ حقيقي؛ إعلانها مرتين ضجيج لقارئ الشاشة.

import { useTranslator } from "../../app/context";

/** النجمة وحدها، بالشكل نفسه الذي في أيقونة التطبيق. */
export function BrandMark({ size = 32, className = "brand__mark" }: { readonly size?: number; readonly className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M16 1.5 L18.9 13.1 L30.5 16 L18.9 18.9 L16 30.5 L13.1 18.9 L1.5 16 L13.1 13.1 Z" fill="var(--accent)" />
      <circle cx="16" cy="16" r="2.6" fill="var(--surface-canvas)" />
    </svg>
  );
}

export function Brand() {
  const translator = useTranslator();
  return (
    <div className="brand">
      <BrandMark />
      <span className="brand__name">
        {translator.t("app.name")}
        <span className="brand__tagline">{translator.t("app.tagline")}</span>
      </span>
    </div>
  );
}
