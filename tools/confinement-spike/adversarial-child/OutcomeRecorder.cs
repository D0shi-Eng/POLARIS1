using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // يجمع نتائج المحاولات ويكتبها بصيغتين: سطور للـ launcher، وJSON للمراجعة البشرية
    public sealed class OutcomeRecorder
    {
        private readonly List<ProbeOutcome> _outcomes = new List<ProbeOutcome>();

        public void Add(ProbeOutcome outcome)
        {
            _outcomes.Add(outcome);
            // الطباعة الفورية تضمن بقاء الدليل حتى لو فشلت الكتابة على القرص لاحقًا
            Console.Out.WriteLine("PROBE\t" + RecordLine.Format(outcome));
            Console.Out.Flush();
        }

        public IList<ProbeOutcome> Outcomes
        {
            get { return _outcomes; }
        }

        public string BuildJson(string variant)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append("{\n");
            builder.Append("  \"variant\": \"").Append(JsonText.Escape(variant)).Append("\",\n");
            builder.Append("  \"probes\": [\n");
            for (int i = 0; i < _outcomes.Count; i++)
            {
                ProbeOutcome o = _outcomes[i];
                builder.Append("    {\n");
                builder.Append("      \"id\": \"").Append(JsonText.Escape(o.Id)).Append("\",\n");
                builder.Append("      \"attempt\": \"").Append(JsonText.Escape(o.Attempt)).Append("\",\n");
                builder.Append("      \"outcome\": \"").Append(JsonText.Escape(o.Outcome)).Append("\",\n");
                builder.Append("      \"os_error_code\": ").Append(o.OsErrorCode.ToString(CultureInfo.InvariantCulture)).Append(",\n");
                builder.Append("      \"os_error_name\": \"").Append(JsonText.Escape(o.OsErrorName)).Append("\",\n");
                builder.Append("      \"detail\": \"").Append(JsonText.Escape(o.Detail)).Append("\"\n");
                builder.Append(i == _outcomes.Count - 1 ? "    }\n" : "    },\n");
            }
            builder.Append("  ]\n");
            builder.Append("}\n");
            return builder.ToString();
        }

        // تُرجع true إذا نجحت الكتابة. الفشل ليس كارثة لأن stdout يحمل نفس البيانات
        public bool TryWriteReport(string reportPath, string variant)
        {
            try
            {
                StringBuilder lines = new StringBuilder();
                for (int i = 0; i < _outcomes.Count; i++)
                {
                    lines.Append(RecordLine.Format(_outcomes[i])).Append("\n");
                }
                File.WriteAllText(reportPath, lines.ToString(), new UTF8Encoding(false));
                File.WriteAllText(Path.ChangeExtension(reportPath, ".json"), BuildJson(variant), new UTF8Encoding(false));
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
