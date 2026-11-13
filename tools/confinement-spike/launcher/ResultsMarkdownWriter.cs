using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Polaris.ConfinementSpike.Launcher
{
    // يكتب جدول النتائج. لا يخفي أي فشل ولا يعيد ترتيب الحقائق
    public static class ResultsMarkdownWriter
    {
        public static void Write(string path, IList<TestRecord> records, IList<VariantDefinition> variants,
            string environmentJson, IList<string> runLog)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("# PHASE-00 / W1 — RESULTS\n\n");
            builder.Append("Generated: ").Append(DateTime.UtcNow.ToString("u", CultureInfo.InvariantCulture)).Append("\n\n");
            builder.Append("> This file is generated from an actual execution run. ");
            builder.Append("Rows are not hand written and no expectation was changed after seeing a result.\n\n");

            builder.Append("## Environment\n\n```json\n").Append(environmentJson).Append("```\n\n");

            builder.Append("## Variants executed\n\n");
            builder.Append("| Variant | Enforcement layer | Description |\n|---|---|---|\n");
            for (int i = 0; i < variants.Count; i++)
            {
                builder.Append("| ").Append(variants[i].Id)
                       .Append(" | ").Append(variants[i].EnforcementLayer)
                       .Append(" | ").Append(variants[i].Description).Append(" |\n");
            }
            builder.Append('\n');

            builder.Append("## Summary\n\n");
            builder.Append(BuildSummary(records));

            for (int v = 0; v < variants.Count; v++)
            {
                string variantId = variants[v].Id;
                builder.Append("\n## ").Append(variantId).Append("\n\n");
                builder.Append("| ID | Category | Attempt | Expected | Actual | Enforcement | OS result | Result |\n");
                builder.Append("|---|---|---|---|---|---|---|---|\n");
                for (int i = 0; i < records.Count; i++)
                {
                    TestRecord r = records[i];
                    if (r.Variant != variantId) { continue; }
                    builder.Append("| ").Append(r.TestId)
                           .Append(" | ").Append(r.Category)
                           .Append(" | ").Append(Escape(r.Attempt))
                           .Append(" | ").Append(r.Expected)
                           .Append(" | ").Append(r.Actual)
                           .Append(" | ").Append(r.EnforcementLayer)
                           .Append(" | ").Append(r.OsErrorName).Append(" (").Append(r.OsErrorCode.ToString(CultureInfo.InvariantCulture)).Append(")")
                           .Append(" | ").Append(r.Result).Append(" |\n");
                }
            }

            builder.Append("\n## Non obvious cases and notes\n\n");
            for (int i = 0; i < records.Count; i++)
            {
                TestRecord r = records[i];
                if (r.Result == ResultValue.Pass || r.Result == ResultValue.Control) { continue; }
                builder.Append("- **").Append(r.Variant).Append(" / ").Append(r.TestId).Append("** — ")
                       .Append(r.Result).Append(": ").Append(Escape(r.Notes)).Append('\n');
            }

            builder.Append("\n## Run log\n\n```\n");
            for (int i = 0; i < runLog.Count; i++) { builder.Append(runLog[i]).Append('\n'); }
            builder.Append("```\n");

            File.WriteAllText(path, builder.ToString(), new UTF8Encoding(false));
        }

        private static string BuildSummary(IList<TestRecord> records)
        {
            Dictionary<string, int> counts = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < records.Count; i++)
            {
                string key = records[i].Variant + "|" + records[i].Result;
                if (!counts.ContainsKey(key)) { counts[key] = 0; }
                counts[key] = counts[key] + 1;
            }

            StringBuilder builder = new StringBuilder();
            builder.Append("| Variant | Result | Count |\n|---|---|---|\n");
            List<string> keys = new List<string>(counts.Keys);
            keys.Sort(StringComparer.Ordinal);
            for (int i = 0; i < keys.Count; i++)
            {
                string[] parts = keys[i].Split('|');
                builder.Append("| ").Append(parts[0]).Append(" | ").Append(parts[1])
                       .Append(" | ").Append(counts[keys[i]].ToString(CultureInfo.InvariantCulture)).Append(" |\n");
            }
            return builder.ToString();
        }

        private static string Escape(string value)
        {
            if (value == null) { return ""; }
            return value.Replace("|", "\\|").Replace("\r", " ").Replace("\n", " ");
        }
    }
}
