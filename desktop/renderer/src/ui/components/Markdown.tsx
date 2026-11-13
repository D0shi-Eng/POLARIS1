// عرض Markdown آمن للتقارير التي يكتبها الوكيل: يحوّل النصّ إلى عناصر React فقط، ولا يمرّ شيء عبر
// HTML خام (لا innerHTML ولا srcDoc). المحتوى غير موثوق: الروابط تُعرض نصًّا مع عنوانها ولا تُفتح،
// والصور لا تُحمَّل. يغطّي ما تكتبه التقارير عادةً: العناوين، والفقرات، والقوائم (ومنها قوائم المهامّ)،
// والجداول، والاقتباس، والفواصل، وكتل الشيفرة، والتأكيد والشيفرة داخل السطر. كل كتلة `dir="auto"`،
// وبنود القوائم وخلايا الجداول وأسطر كتل الشيفرة `unicode-bidi: plaintext` في polaris.css: كلٌّ يأخذ
// اتجاه لغته (عربي أو إنجليزي) من نصّه نفسه، لا من أوّل بند في الكتلة.

import type { ReactNode } from "react";

type Block =
  | { readonly kind: "heading"; readonly level: number; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly ordered: boolean; readonly items: readonly { readonly text: string; readonly checked: boolean | null }[] }
  | { readonly kind: "code"; readonly text: string }
  | { readonly kind: "quote"; readonly text: string }
  | { readonly kind: "rule" }
  | { readonly kind: "table"; readonly head: readonly string[]; readonly rows: readonly (readonly string[])[] };

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;
const TASK = /^\[( |x|X)\]\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/** يقسم النصّ إلى كتل. حدّ أعلى لعدد الأسطر كي لا يثقل ملف ضخم الواجهة. */
export function parseMarkdown(source: string, maxLines = 4000): readonly Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n").slice(0, maxLines);
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i += 1;
      blocks.push({ kind: "code", text: body.join("\n") });
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading !== null) {
      blocks.push({ kind: "heading", level: (heading[1] ?? "#").length, text: (heading[2] ?? "").replace(/\s*#+\s*$/, "") });
      i += 1;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i += 1;
      continue;
    }
    if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim() !== "") rows.push(cells(lines[i++] ?? ""));
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? "")) body.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""));
      blocks.push({ kind: "quote", text: body.join(" ") });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item !== null) {
      const ordered = /\d/.test(item[1] ?? "");
      const items: { text: string; checked: boolean | null }[] = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i] ?? "");
        if (m === null) break;
        const task = TASK.exec(m[2] ?? "");
        items.push(task === null ? { text: m[2] ?? "", checked: null } : { text: task[2] ?? "", checked: (task[1] ?? " ").trim() !== "" });
        i += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && (lines[i] ?? "").trim() !== "" && !/^(#{1,6}\s|\s*```|\s*>)/.test(lines[i] ?? "") && LIST_ITEM.exec(lines[i] ?? "") === null) body.push((lines[i++] ?? "").trim());
    blocks.push({ kind: "paragraph", text: body.join(" ") });
  }
  return blocks;
}

/**
 * معادلة حسابية داخل سطر (أرقام بينها = − + × ÷ /، والحدّ العريض **150,000 ريال** حدّ واحد): تُعزل اتجاهًا من اليسار
 * إلى اليمين، وإلا قلبها النصّ العربي فصارت «150,000 = 350,000 − 500,000» (قيس 2026-10-01).
 */
const EQUATION = /(?:\*\*\d[^*]*\*\*|\d[\d,.]*%?)(?:\s*[=−\-+×÷/]\s*(?:\*\*\d[^*]*\*\*|\d[\d,.]*%?))+/g;

/** السطر بمعادلاته معزولة الاتجاه، وما بينها تأكيد وشيفرة وروابط. */
export function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(EQUATION)) {
    const at = m.index ?? 0;
    if (at > last) out.push(...inlineMarks(text.slice(last, at), `t${key++}`));
    out.push(
      <bdi key={`e${key++}`} dir="ltr" className="md__math">
        {inlineMarks(m[0], `m${key}`)}
      </bdi>,
    );
    last = at + m[0].length;
  }
  if (last < text.length) out.push(...inlineMarks(text.slice(last), `t${key++}`));
  return out;
}

/** التأكيد والشيفرة والروابط داخل السطر، عناصرَ لا HTML. */
function inlineMarks(text: string, prefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let n = 0;
  const key = () => `${prefix}-${n++}`;
  for (const m of text.matchAll(pattern)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    // معزولة الاتجاه: مسار مثل `outputs/hello.txt` لا يختلط بالجملة العربية حوله ولا يقلب ترقيمها.
    if (token.startsWith("`")) out.push(<code key={key()} dir="auto">{token.slice(1, -1)}</code>);
    else if (token.startsWith("**") || token.startsWith("__")) out.push(<strong key={key()}>{token.slice(2, -2)}</strong>);
    else if (token.startsWith("*")) out.push(<em key={key()}>{token.slice(1, -1)}</em>);
    else {
      // رابط من محتوى غير موثوق: نصّه ثم عنوانه ظاهرًا، ولا يُفتح من هنا
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      out.push(
        <span key={key()} className="md__link" title={link?.[2] ?? ""}>
          {link?.[1] ?? token}
        </span>,
      );
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source }: { readonly source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <div className="md">
      {blocks.map((b, index) => {
        switch (b.kind) {
          case "heading": {
            const Tag = (`h${Math.min(b.level + 1, 6)}`) as "h2";
            return (
              <Tag key={index} className={`md__h md__h${b.level}`} dir="auto">
                {inline(b.text)}
              </Tag>
            );
          }
          case "paragraph":
            return (
              <p key={index} className="md__p" dir="auto">
                {inline(b.text)}
              </p>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={index} className={b.items.some((it) => it.checked !== null) ? "md__list md__list--tasks" : "md__list"} dir="auto">
                {b.items.map((it, n) => (
                  <li key={n} className={it.checked === null ? undefined : it.checked ? "md__task is-done" : "md__task"}>
                    {it.checked === null ? null : <span className="md__check" aria-hidden="true" />}
                    {inline(it.text)}
                  </li>
                ))}
              </Tag>
            );
          }
          case "code":
            return (
              <pre key={index} className="md__code" dir="ltr">
                <code>{b.text}</code>
              </pre>
            );
          case "quote":
            return (
              <blockquote key={index} className="md__quote" dir="auto">
                {inline(b.text)}
              </blockquote>
            );
          case "rule":
            return <hr key={index} className="md__rule" />;
          case "table":
            return (
              <div key={index} className="md__table-wrap">
                <table className="md__table" dir="auto">
                  <thead>
                    <tr>
                      {b.head.map((h, n) => (
                        <th key={n} scope="col">
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((c, n) => (
                          <td key={n}>{inline(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
