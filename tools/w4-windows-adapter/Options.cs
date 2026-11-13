using System;
using System.Collections.Generic;

namespace Polaris.W4.WindowsAdapter
{
    internal sealed class Options
    {
        private readonly Dictionary<string, string> _values =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        public static Options Parse(string[] args)
        {
            Options options = new Options();
            for (int i = 0; i < args.Length; i++)
            {
                if (!args[i].StartsWith("--", StringComparison.Ordinal)) { continue; }
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

        public string Get(string key, string fallback)
        {
            string value;
            if (_values.TryGetValue(key, out value) && !string.IsNullOrEmpty(value)) { return value; }
            return fallback;
        }

        public bool Has(string key) { return _values.ContainsKey(key); }
    }
}
