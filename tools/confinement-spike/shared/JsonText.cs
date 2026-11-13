using System.Globalization;
using System.Text;

namespace Polaris.ConfinementSpike.Shared
{
    // كاتب JSON مبسط جدًا. الهدف إخراج أدلة قابلة للقراءة الآلية
    // دون إدخال أي اعتمادية خارجية على المشروع في هذه المرحلة
    public static class JsonText
    {
        public static string Escape(string value)
        {
            if (value == null)
            {
                return "";
            }

            StringBuilder builder = new StringBuilder(value.Length + 16);
            for (int i = 0; i < value.Length; i++)
            {
                char c = value[i];
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < ' ')
                        {
                            builder.Append("\\u");
                            builder.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            builder.Append(c);
                        }
                        break;
                }
            }
            return builder.ToString();
        }

        public static void WriteStringField(StringBuilder builder, string name, string value, bool trailingComma)
        {
            builder.Append("    \"").Append(name).Append("\": \"").Append(Escape(value)).Append('"');
            builder.Append(trailingComma ? ",\n" : "\n");
        }

        public static void WriteRawField(StringBuilder builder, string name, string rawValue, bool trailingComma)
        {
            builder.Append("    \"").Append(name).Append("\": ").Append(rawValue);
            builder.Append(trailingComma ? ",\n" : "\n");
        }
    }
}
