using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>عقدة JSON مقروءة. شجرة صغيرة تكفي لعقد بروتوكول W4، بلا تبعية.</summary>
    internal sealed class JsonValue
    {
        internal const string KindObject = "OBJECT";
        internal const string KindArray = "ARRAY";
        internal const string KindString = "STRING";
        internal const string KindNumber = "NUMBER";
        internal const string KindBoolean = "BOOLEAN";
        internal const string KindNull = "NULL";

        public string Kind = KindNull;
        public Dictionary<string, JsonValue> Members = new Dictionary<string, JsonValue>(StringComparer.Ordinal);
        public List<JsonValue> Items = new List<JsonValue>();
        public string Text = "";
        public double Number;
        public bool Boolean;

        public bool IsObject { get { return Kind == KindObject; } }
        public bool IsArray { get { return Kind == KindArray; } }
        public bool IsString { get { return Kind == KindString; } }
        public bool IsNumber { get { return Kind == KindNumber; } }
        public bool IsBoolean { get { return Kind == KindBoolean; } }

        /// <summary>عضو باسمه، أو null إن غاب. الغياب يُميَّز عن القيمة الفارغة.</summary>
        public JsonValue Member(string name)
        {
            JsonValue found;
            if (Kind == KindObject && Members.TryGetValue(name, out found)) { return found; }
            return null;
        }

        /// <summary>نص العضو إن كان نصًّا، وإلا فارغ. لا يُخترع نوع لم يرد.</summary>
        public string MemberText(string name)
        {
            JsonValue found = Member(name);
            if (found != null && found.IsString) { return found.Text; }
            return "";
        }
    }

    /// <summary>
    /// قارئ JSON صارم.
    ///
    /// العيب الذي يغلقه: كان قبول البروتوكول يُقاس ببحث نصّي عن "status":. بحثٌ
    /// كهذا يقبل النص داخل رسالة خطأ، ويقبل مخرجًا نصفه مقطوع، ولا يميّز حقلًا
    /// في الجذر عن حقل مدفون. الحكم الأمني لا يُبنى على تطابق سلسلة: يُبنى على
    /// وثيقة تُحلَّل كاملة، أو تُرفض بسبب مسمّى.
    /// </summary>
    internal static class JsonReader
    {
        /// <summary>يحلّل الوثيقة كاملة. يعيد null مع سبب عند أي خلل.</summary>
        public static JsonValue Parse(string text, out string error)
        {
            error = "";
            if (text == null) { error = "the document is null"; return null; }
            int index = 0;
            try
            {
                JsonValue value = ParseValue(text, ref index);
                SkipWhitespace(text, ref index);
                if (index != text.Length)
                {
                    error = "trailing content after the JSON document at offset "
                        + index.ToString(CultureInfo.InvariantCulture);
                    return null;
                }
                return value;
            }
            catch (FormatException failure)
            {
                error = failure.Message;
                return null;
            }
        }

        private static JsonValue ParseValue(string text, ref int index)
        {
            SkipWhitespace(text, ref index);
            if (index >= text.Length) { throw new FormatException("unexpected end of document"); }
            char current = text[index];
            if (current == '{') { return ParseObject(text, ref index); }
            if (current == '[') { return ParseArray(text, ref index); }
            if (current == '"')
            {
                JsonValue value = new JsonValue();
                value.Kind = JsonValue.KindString;
                value.Text = ParseString(text, ref index);
                return value;
            }
            if (Match(text, ref index, "true")) { return Boolean(true); }
            if (Match(text, ref index, "false")) { return Boolean(false); }
            if (Match(text, ref index, "null"))
            {
                JsonValue value = new JsonValue();
                value.Kind = JsonValue.KindNull;
                return value;
            }
            return ParseNumber(text, ref index);
        }

        private static JsonValue Boolean(bool state)
        {
            JsonValue value = new JsonValue();
            value.Kind = JsonValue.KindBoolean;
            value.Boolean = state;
            return value;
        }

        private static JsonValue ParseObject(string text, ref int index)
        {
            JsonValue value = new JsonValue();
            value.Kind = JsonValue.KindObject;
            index++;
            SkipWhitespace(text, ref index);
            if (index < text.Length && text[index] == '}') { index++; return value; }
            while (true)
            {
                SkipWhitespace(text, ref index);
                if (index >= text.Length || text[index] != '"')
                {
                    throw new FormatException("a member name must be a string at offset "
                        + index.ToString(CultureInfo.InvariantCulture));
                }
                string name = ParseString(text, ref index);
                SkipWhitespace(text, ref index);
                if (index >= text.Length || text[index] != ':')
                {
                    throw new FormatException("a member name must be followed by ':' at offset "
                        + index.ToString(CultureInfo.InvariantCulture));
                }
                index++;
                value.Members[name] = ParseValue(text, ref index);
                SkipWhitespace(text, ref index);
                if (index < text.Length && text[index] == ',') { index++; continue; }
                if (index < text.Length && text[index] == '}') { index++; return value; }
                throw new FormatException("an object member must be followed by ',' or '}' at offset "
                    + index.ToString(CultureInfo.InvariantCulture));
            }
        }

        private static JsonValue ParseArray(string text, ref int index)
        {
            JsonValue value = new JsonValue();
            value.Kind = JsonValue.KindArray;
            index++;
            SkipWhitespace(text, ref index);
            if (index < text.Length && text[index] == ']') { index++; return value; }
            while (true)
            {
                value.Items.Add(ParseValue(text, ref index));
                SkipWhitespace(text, ref index);
                if (index < text.Length && text[index] == ',') { index++; continue; }
                if (index < text.Length && text[index] == ']') { index++; return value; }
                throw new FormatException("an array element must be followed by ',' or ']' at offset "
                    + index.ToString(CultureInfo.InvariantCulture));
            }
        }

        private static string ParseString(string text, ref int index)
        {
            StringBuilder builder = new StringBuilder();
            index++;
            while (true)
            {
                if (index >= text.Length) { throw new FormatException("unterminated string"); }
                char current = text[index];
                if (current == '"') { index++; return builder.ToString(); }
                if (current == '\\')
                {
                    index++;
                    if (index >= text.Length) { throw new FormatException("unterminated escape"); }
                    char escape = text[index];
                    if (escape == '"') { builder.Append('"'); }
                    else if (escape == '\\') { builder.Append('\\'); }
                    else if (escape == '/') { builder.Append('/'); }
                    else if (escape == 'b') { builder.Append('\b'); }
                    else if (escape == 'f') { builder.Append('\f'); }
                    else if (escape == 'n') { builder.Append('\n'); }
                    else if (escape == 'r') { builder.Append('\r'); }
                    else if (escape == 't') { builder.Append('\t'); }
                    else if (escape == 'u')
                    {
                        if (index + 4 >= text.Length) { throw new FormatException("truncated \\u escape"); }
                        string digits = text.Substring(index + 1, 4);
                        int code;
                        if (!int.TryParse(digits, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code))
                        {
                            throw new FormatException("invalid \\u escape");
                        }
                        builder.Append((char) code);
                        index += 4;
                    }
                    else { throw new FormatException("invalid escape character"); }
                    index++;
                    continue;
                }
                if (current < 0x20) { throw new FormatException("a control character must be escaped in a string"); }
                builder.Append(current);
                index++;
            }
        }

        private static JsonValue ParseNumber(string text, ref int index)
        {
            int start = index;
            if (index < text.Length && (text[index] == '-' || text[index] == '+')) { index++; }
            while (index < text.Length)
            {
                char current = text[index];
                bool numeric = (current >= '0' && current <= '9')
                    || current == '.' || current == 'e' || current == 'E'
                    || current == '-' || current == '+';
                if (!numeric) { break; }
                index++;
            }
            if (index == start) { throw new FormatException("a value was expected"); }
            string literal = text.Substring(start, index - start);
            double parsed;
            if (!double.TryParse(literal, NumberStyles.Float, CultureInfo.InvariantCulture, out parsed))
            {
                throw new FormatException("invalid number literal " + literal);
            }
            JsonValue value = new JsonValue();
            value.Kind = JsonValue.KindNumber;
            value.Number = parsed;
            value.Text = literal;
            return value;
        }

        private static bool Match(string text, ref int index, string literal)
        {
            if (index + literal.Length > text.Length) { return false; }
            if (string.CompareOrdinal(text, index, literal, 0, literal.Length) != 0) { return false; }
            index += literal.Length;
            return true;
        }

        private static void SkipWhitespace(string text, ref int index)
        {
            while (index < text.Length)
            {
                char current = text[index];
                if (current == ' ' || current == '\t' || current == '\r' || current == '\n') { index++; continue; }
                break;
            }
        }
    }
}
