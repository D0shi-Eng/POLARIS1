using System;
using System.Collections.Generic;
using System.Globalization;

namespace Polaris.ConfinementSpike.Child
{
    // محلل وسائط بسيط بصيغة مفتاح وقيمة. مسؤولية واحدة فقط
    internal sealed class CommandLineOptions
    {
        private readonly Dictionary<string, string> _values =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static CommandLineOptions Parse(string[] args)
        {
            CommandLineOptions options = new CommandLineOptions();
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--", StringComparison.Ordinal))
                {
                    continue;
                }
                string key = args[i].Substring(2);
                string value = "";
                if (i + 1 < args.Length && !args[i + 1].StartsWith("--", StringComparison.Ordinal))
                {
                    value = args[i + 1];
                    i++;
                }
                options._values[key] = value;
            }
            return options;
        }

        public string GetString(string key, string fallback)
        {
            string value;
            if (_values.TryGetValue(key, out value) && !string.IsNullOrEmpty(value))
            {
                return value;
            }
            return fallback;
        }

        public int GetInt32(string key, int fallback)
        {
            string value = GetString(key, null);
            if (value == null)
            {
                return fallback;
            }
            int parsed;
            if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed))
            {
                return parsed;
            }
            return fallback;
        }

        public IntPtr GetHandle(string key)
        {
            string value = GetString(key, null);
            if (value == null)
            {
                return IntPtr.Zero;
            }
            long parsed;
            if (long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out parsed) && parsed != 0)
            {
                return new IntPtr(parsed);
            }
            return IntPtr.Zero;
        }
    }
}
