using System.Globalization;
using System.Text;

namespace Polaris.ConfinementSpike.Shared
{
    // صيغة نقل بسيطة بين البرنامج العدائي والـ launcher.
    // اخترنا سطورًا مفصولة بعلامة جدولة بدل JSON لتجنب كتابة محلل JSON كامل
    // داخل spike هدفه إثبات الحصر لا بناء بنية تحتية للتسلسل
    public static class RecordLine
    {
        private const char Separator = '\t';

        public static string Sanitize(string value)
        {
            if (value == null)
            {
                return "";
            }
            return value.Replace('\t', ' ').Replace('\r', ' ').Replace('\n', ' ');
        }

        public static string Format(ProbeOutcome outcome)
        {
            StringBuilder builder = new StringBuilder();
            builder.Append(Sanitize(outcome.Id)).Append(Separator);
            builder.Append(Sanitize(outcome.Attempt)).Append(Separator);
            builder.Append(Sanitize(outcome.Outcome)).Append(Separator);
            builder.Append(outcome.OsErrorCode.ToString(CultureInfo.InvariantCulture)).Append(Separator);
            builder.Append(Sanitize(outcome.OsErrorName)).Append(Separator);
            builder.Append(Sanitize(outcome.Detail));
            return builder.ToString();
        }

        public static ProbeOutcome Parse(string line)
        {
            if (string.IsNullOrEmpty(line))
            {
                return null;
            }

            string[] parts = line.Split(Separator);
            if (parts.Length < 6)
            {
                return null;
            }

            int code = 0;
            int.TryParse(parts[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out code);
            return new ProbeOutcome(parts[0], parts[1], parts[2], code, parts[4], parts[5]);
        }
    }
}
