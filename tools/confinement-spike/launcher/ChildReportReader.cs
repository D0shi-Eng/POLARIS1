using System;
using System.Collections.Generic;
using System.IO;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Launcher
{
    // قراءة تقرير البرنامج العدائي.
    // إن تعذر كتابة الملف نعود إلى مخرجات stdout، لأن فقدان الدليل غير مقبول
    public static class ChildReportReader
    {
        public static List<ProbeOutcome> Read(string tsvPath, string stdoutPath)
        {
            List<ProbeOutcome> outcomes = new List<ProbeOutcome>();

            if (File.Exists(tsvPath))
            {
                string[] lines = File.ReadAllLines(tsvPath);
                for (int i = 0; i < lines.Length; i++)
                {
                    ProbeOutcome outcome = RecordLine.Parse(lines[i]);
                    if (outcome != null) { outcomes.Add(outcome); }
                }
                if (outcomes.Count > 0) { return outcomes; }
            }

            if (File.Exists(stdoutPath))
            {
                string[] lines = File.ReadAllLines(stdoutPath);
                for (int i = 0; i < lines.Length; i++)
                {
                    if (!lines[i].StartsWith("PROBE\t", StringComparison.Ordinal)) { continue; }
                    ProbeOutcome outcome = RecordLine.Parse(lines[i].Substring("PROBE\t".Length));
                    if (outcome != null) { outcomes.Add(outcome); }
                }
            }

            return outcomes;
        }
    }
}
