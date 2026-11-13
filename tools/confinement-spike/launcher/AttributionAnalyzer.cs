using System;
using System.Collections.Generic;

namespace Polaris.ConfinementSpike.Launcher
{
    // يمنع نجاح الاختبار لسبب خاطئ.
    // إذا مُنعت محاولة في نمط محصور، ومُنعت أيضًا في خط الأساس غير المحصور،
    // فالمنع لا يُنسب إلى آلية الحصر ويُصنَّف غير حاسم
    public static class AttributionAnalyzer
    {
        public static void Apply(IList<TestRecord> records)
        {
            Dictionary<string, TestRecord> baseline = new Dictionary<string, TestRecord>(StringComparer.Ordinal);
            for (int i = 0; i < records.Count; i++)
            {
                if (records[i].Variant == "V0_BASELINE")
                {
                    baseline[records[i].TestId] = records[i];
                }
            }

            for (int i = 0; i < records.Count; i++)
            {
                TestRecord record = records[i];
                if (record.Variant == "V0_BASELINE")
                {
                    continue;
                }

                TestRecord control;
                if (!baseline.TryGetValue(record.TestId, out control))
                {
                    record.Notes = record.Notes + " | NO BASELINE for this probe, attribution unverified";
                    continue;
                }

                // منع مطابق في خط الأساس يعني أن السبب ليس آلية الحصر
                if (record.Result == ResultValue.Pass
                    && record.Expected == ExpectedValue.Deny
                    && control.Actual != "allow")
                {
                    record.Result = ResultValue.Inconclusive;
                    record.Passed = false;
                    record.Notes = record.Notes
                        + " | NOT ATTRIBUTABLE: baseline outcome was '" + control.Actual
                        + "' (" + control.OsErrorName + "), so the denial is not caused by the confinement layer";
                    continue;
                }

                // فشل السماح في نمط محصور بينما خط الأساس سمح، يعني أن المشكلة في المنح لا في الاختبار
                if (record.Expected == ExpectedValue.Allow
                    && record.Actual != "allow"
                    && control.Actual == "allow")
                {
                    record.Notes = record.Notes
                        + " | baseline allowed this, so the failure is inside the granted scope configuration";
                }
            }
        }
    }
}
