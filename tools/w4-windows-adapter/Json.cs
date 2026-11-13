using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    // كاتب JSON صغير. الدليل يجب أن يكون قابلًا للقراءة آليًا، ولا نضيف تبعية لأجله.
    internal sealed class JsonWriter
    {
        private readonly StringBuilder _text = new StringBuilder();
        private bool _needsComma;

        public JsonWriter BeginObject() { Separate(); _text.Append('{'); _needsComma = false; return this; }
        public JsonWriter EndObject() { _text.Append('}'); _needsComma = true; return this; }
        public JsonWriter BeginArray() { Separate(); _text.Append('['); _needsComma = false; return this; }
        public JsonWriter EndArray() { _text.Append(']'); _needsComma = true; return this; }

        public JsonWriter Name(string name)
        {
            Separate();
            _text.Append(Quote(name)).Append(':');
            _needsComma = false;
            return this;
        }

        public JsonWriter Value(string value)
        {
            Separate();
            _text.Append(value == null ? "null" : Quote(value));
            _needsComma = true;
            return this;
        }

        public JsonWriter Value(long value)
        {
            Separate();
            _text.Append(value.ToString(CultureInfo.InvariantCulture));
            _needsComma = true;
            return this;
        }

        public JsonWriter Value(bool value)
        {
            Separate();
            _text.Append(value ? "true" : "false");
            _needsComma = true;
            return this;
        }

        public JsonWriter Property(string name, string value) { return Name(name).Value(value); }
        public JsonWriter Property(string name, long value) { return Name(name).Value(value); }
        public JsonWriter Property(string name, bool value) { return Name(name).Value(value); }

        public JsonWriter Property(string name, IEnumerable<string> values)
        {
            Name(name).BeginArray();
            foreach (string value in values) { Value(value); }
            return EndArray();
        }

        private void Separate()
        {
            if (_needsComma) { _text.Append(','); }
            _needsComma = false;
        }

        private static string Quote(string value)
        {
            StringBuilder builder = new StringBuilder(value.Length + 2);
            builder.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < 0x20) { builder.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture)); }
                        else { builder.Append(c); }
                        break;
                }
            }
            builder.Append('"');
            return builder.ToString();
        }

        public override string ToString() { return _text.ToString(); }
    }
}
