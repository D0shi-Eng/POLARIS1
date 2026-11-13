using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Launcher
{
    // يحوّل النتائج الخام إلى أحكام، ويكتب الأدلة.
    // الحكم هنا آلي بحت بناءً على مصفوفة التوقعات، بلا أي تدخل يدوي
    public sealed class TestResultCollector
    {
        private readonly List<TestRecord> _records = new List<TestRecord>();

        public IList<TestRecord> Records { get { return _records; } }

        public TestRecord Judge(VariantDefinition variant, ProbeOutcome outcome, string evidencePath)
        {
            Expectation expectation = ExpectationMatrix.For(variant, outcome.Id);

            TestRecord record = new TestRecord();
            record.Variant = variant.Id;
            record.TestId = outcome.Id;
            record.Category = TestCategory.FromId(outcome.Id);
            record.Attempt = outcome.Attempt;
            record.Expected = expectation.Expected;
            record.Actual = outcome.Outcome;
            record.EnforcementLayer = expectation.EnforcementLayer;
            record.OsErrorName = outcome.OsErrorName;
            record.OsErrorCode = outcome.OsErrorCode;
            record.EvidencePath = evidencePath;
            record.Notes = Combine(expectation.Note, outcome.Detail);

            Evaluate(record, expectation, outcome);
            _records.Add(record);
            return record;
        }

        public void AddDerived(TestRecord record)
        {
            _records.Add(record);
        }

        private static void Evaluate(TestRecord record, Expectation expectation, ProbeOutcome outcome)
        {
            if (expectation.Expected == ExpectedValue.Control)
            {
                record.Result = ResultValue.Control;
                record.Passed = false;
                return;
            }

            if (outcome.Outcome == OutcomeKind.Skipped)
            {
                record.Result = ResultValue.NotTested;
                record.Passed = false;
                return;
            }

            bool detailSatisfied = true;
            if (!string.IsNullOrEmpty(expectation.RequiredDetailSubstring) && outcome.Outcome == OutcomeKind.Allow)
            {
                detailSatisfied = outcome.Detail != null
                    && outcome.Detail.IndexOf(expectation.RequiredDetailSubstring, StringComparison.Ordinal) >= 0;
                if (!detailSatisfied)
                {
                    record.Notes = record.Notes + " | REQUIRED DETAIL MISSING: " + expectation.RequiredDetailSubstring;
                }
            }

            if (expectation.Expected == ExpectedValue.Documented)
            {
                record.Result = detailSatisfied ? ResultValue.Documented : ResultValue.Fail;
                record.Passed = detailSatisfied;
                return;
            }

            bool matches = string.Equals(expectation.Expected, outcome.Outcome, StringComparison.Ordinal);
            record.Passed = matches && detailSatisfied;
            record.Result = record.Passed ? ResultValue.Pass : ResultValue.Fail;
        }

        private static string Combine(string note, string detail)
        {
            if (string.IsNullOrEmpty(note)) { return detail; }
            if (string.IsNullOrEmpty(detail)) { return note; }
            return note + " | " + detail;
        }

        public void WriteJson(string path)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("{\n");
            builder.Append("  \"generated_utc\": \"").Append(DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture)).Append("\",\n");
            builder.Append("  \"results\": [\n");
            for (int i = 0; i < _records.Count; i++)
            {
                TestRecord r = _records[i];
                builder.Append("    {\n");
                builder.Append("      \"variant\": \"").Append(JsonText.Escape(r.Variant)).Append("\",\n");
                builder.Append("      \"test_id\": \"").Append(JsonText.Escape(r.TestId)).Append("\",\n");
                builder.Append("      \"category\": \"").Append(JsonText.Escape(r.Category)).Append("\",\n");
                builder.Append("      \"attempt\": \"").Append(JsonText.Escape(r.Attempt)).Append("\",\n");
                builder.Append("      \"expected\": \"").Append(JsonText.Escape(r.Expected)).Append("\",\n");
                builder.Append("      \"actual\": \"").Append(JsonText.Escape(r.Actual)).Append("\",\n");
                builder.Append("      \"enforcement_layer\": \"").Append(JsonText.Escape(r.EnforcementLayer)).Append("\",\n");
                builder.Append("      \"os_error\": \"").Append(JsonText.Escape(r.OsErrorName)).Append("\",\n");
                builder.Append("      \"os_error_code\": ").Append(r.OsErrorCode.ToString(CultureInfo.InvariantCulture)).Append(",\n");
                builder.Append("      \"result\": \"").Append(JsonText.Escape(r.Result)).Append("\",\n");
                builder.Append("      \"passed\": ").Append(r.Passed ? "true" : "false").Append(",\n");
                builder.Append("      \"evidence_path\": \"").Append(JsonText.Escape(r.EvidencePath)).Append("\",\n");
                builder.Append("      \"notes\": \"").Append(JsonText.Escape(r.Notes)).Append("\"\n");
                builder.Append(i == _records.Count - 1 ? "    }\n" : "    },\n");
            }
            builder.Append("  ]\n");
            builder.Append("}\n");

            File.WriteAllText(path, builder.ToString(), new UTF8Encoding(false));
        }
    }
}
