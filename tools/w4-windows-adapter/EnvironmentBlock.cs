using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>نتيجة بناء كتلة البيئة، ومعها اختبار ذاتي على الذاكرة نفسها.</summary>
    internal sealed class EnvironmentBlockResult
    {
        public bool Valid;
        public string ReasonCode = "";
        public string Detail = "";
        public IntPtr Block = IntPtr.Zero;
        public int ByteCount;
        public int EntryCount;
        public List<string> Names = new List<string>();
        public List<string> ValueHashes = new List<string>();
        /// <summary>الكتلة المحجوزة فُكّت قراءتها فعادت إلى نفس الخريطة المقصودة.</summary>
        public bool RoundTripVerified;
        public bool SortedCaseInsensitive;
        public bool DoubleNulTerminated;
        public bool UnicodeBlock = true;
    }

    /// <summary>
    /// بناء كتلة بيئة UTF-16 لـCreateProcessW، مع فحص شكلها قبل الاستدعاء.
    ///
    /// لماذا الفحص هنا وليس بعد الفشل: كتلة بيئة مشوّهة تُرجع أخطاء Win32 لا
    /// تصف سببها — ERROR_ENVVAR_NOT_FOUND من بينها — فيُشخَّص العَرَض بدل العلة.
    /// الشكل يُثبَت أولًا، فإن لم يثبت فالنتيجة BLOCKED باسمها الصريح
    /// ENVIRONMENT_BLOCK_INVALID، ولا يُستدعى CreateProcessW أصلًا.
    ///
    /// ما يُثبَت:
    ///   - كتلة UTF-16 (CREATE_UNICODE_ENVIRONMENT).
    ///   - الترتيب أبجدي غير حسّاس لحالة الأحرف.
    ///   - كل مدخلة تنتهي بـNUL، والكتلة كلها تنتهي بـNUL إضافي.
    ///   - لا NUL داخل اسم أو قيمة.
    ///   - لا اسم مكرر بغضّ النظر عن الحالة.
    ///   - لا اسم فارغ، ولا اسم يحوي '=' — ومنه مدخلات "=X:" لمجلد القرص الحالي،
    ///     وهي غير مدعومة هنا عمدًا لا سهوًا.
    ///   - فكّ قراءة الذاكرة المحجوزة يعيد الخريطة المقصودة نفسها.
    /// </summary>
    internal static class EnvironmentBlock
    {
        internal const string ReasonInvalid = "ENVIRONMENT_BLOCK_INVALID";

        internal static EnvironmentBlockResult Build(Dictionary<string, string> environment)
        {
            EnvironmentBlockResult result = new EnvironmentBlockResult();

            List<string> names = new List<string>(environment.Keys);
            names.Sort(StringComparer.OrdinalIgnoreCase);

            Dictionary<string, string> intended = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < names.Count; i++)
            {
                string name = names[i];
                string value = environment[name];
                if (value == null) { value = ""; }

                if (name.Length == 0)
                {
                    return Invalid(result, "an environment entry has an empty variable name");
                }
                if (name.IndexOf('=') >= 0)
                {
                    return Invalid(result,
                        "the variable name contains '=' - drive-current-directory entries of the form \"=X:\" are not supported by this launcher");
                }
                if (name.IndexOf('\0') >= 0 || value.IndexOf('\0') >= 0)
                {
                    return Invalid(result, "an embedded NUL was found inside a variable name or value");
                }
                if (HasControlCharacter(name))
                {
                    return Invalid(result, "the variable name contains a control character");
                }
                if (intended.ContainsKey(name))
                {
                    return Invalid(result, "a case-insensitive duplicate variable name was found");
                }
                intended.Add(name, value);
            }

            StringBuilder text = new StringBuilder();
            for (int i = 0; i < names.Count; i++)
            {
                text.Append(names[i]).Append('=').Append(intended[names[i]]).Append('\0');
            }
            // الإنهاء المزدوج: مدخلة فارغة تُنهي الكتلة. وحين تكون الخريطة فارغة
            // فالكتلة NUL واحد فقط، وهو شكل صحيح لكتلة بلا متغيرات.
            text.Append('\0');

            string blockText = text.ToString();
            int charCount = blockText.Length;
            int byteCount = charCount * 2;

            IntPtr block = Marshal.AllocHGlobal(byteCount);
            for (int i = 0; i < charCount; i++)
            {
                Marshal.WriteInt16(block, i * 2, (short) blockText[i]);
            }

            result.Block = block;
            result.ByteCount = byteCount;
            result.EntryCount = names.Count;
            result.Names = names;
            result.ValueHashes = new List<string>();
            for (int i = 0; i < names.Count; i++)
            {
                result.ValueHashes.Add(HashValue(intended[names[i]]));
            }

            // ── الاختبار الذاتي على الذاكرة نفسها، لا على النية ──────────────────
            List<string> parsedNames = new List<string>();
            Dictionary<string, string> parsed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            string parseFailure = Parse(block, charCount, parsedNames, parsed);
            if (parseFailure.Length > 0)
            {
                Marshal.FreeHGlobal(block);
                result.Block = IntPtr.Zero;
                return Invalid(result, parseFailure);
            }

            bool sorted = true;
            for (int i = 1; i < parsedNames.Count; i++)
            {
                if (StringComparer.OrdinalIgnoreCase.Compare(parsedNames[i - 1], parsedNames[i]) > 0) { sorted = false; }
            }
            result.SortedCaseInsensitive = sorted;
            result.DoubleNulTerminated =
                charCount >= 1 && blockText[charCount - 1] == '\0'
                && (charCount == 1 || blockText[charCount - 2] == '\0');

            bool roundTrip = parsed.Count == intended.Count && parsedNames.Count == names.Count;
            if (roundTrip)
            {
                for (int i = 0; i < names.Count; i++)
                {
                    string readBack;
                    if (!parsed.TryGetValue(names[i], out readBack)) { roundTrip = false; break; }
                    if (!string.Equals(readBack, intended[names[i]], StringComparison.Ordinal)) { roundTrip = false; break; }
                }
            }
            result.RoundTripVerified = roundTrip;

            if (!roundTrip || !sorted || !result.DoubleNulTerminated)
            {
                Marshal.FreeHGlobal(block);
                result.Block = IntPtr.Zero;
                return Invalid(result,
                    "the constructed block did not round-trip to the intended environment (round_trip="
                    + roundTrip.ToString() + ", sorted=" + sorted.ToString()
                    + ", double_nul=" + result.DoubleNulTerminated.ToString() + ")");
            }

            result.Valid = true;
            result.ReasonCode = "";
            return result;
        }

        /// <summary>فكّ قراءة الكتلة من الذاكرة المحجوزة. يعيد سبب الفشل أو نصًا فارغًا.</summary>
        private static string Parse(
            IntPtr block, int charCount, List<string> orderedNames, Dictionary<string, string> map)
        {
            int index = 0;
            StringBuilder entry = new StringBuilder();
            bool terminated = false;
            while (index < charCount)
            {
                char current = (char) (ushort) Marshal.ReadInt16(block, index * 2);
                index++;
                if (current != '\0') { entry.Append(current); continue; }

                if (entry.Length == 0)
                {
                    // مدخلة فارغة: هذه نهاية الكتلة، ويجب ألا يتبعها شيء.
                    terminated = true;
                    if (index != charCount) { return "the block continues after its terminating empty entry"; }
                    break;
                }

                string pair = entry.ToString();
                entry.Length = 0;
                int separator = pair.IndexOf('=');
                if (separator <= 0) { return "an entry in the constructed block has no name before '='"; }
                string name = pair.Substring(0, separator);
                string value = pair.Substring(separator + 1);
                if (map.ContainsKey(name)) { return "the constructed block contains a duplicate name"; }
                map.Add(name, value);
                orderedNames.Add(name);
            }
            if (!terminated) { return "the constructed block is not terminated by an empty entry"; }
            return "";
        }

        private static bool HasControlCharacter(string text)
        {
            for (int i = 0; i < text.Length; i++)
            {
                if (text[i] < 0x20 || text[i] == 0x7F) { return true; }
            }
            return false;
        }

        /// <summary>بصمة القيمة لا القيمة. الدليل يثبت الهوية بلا تسريب محتوى.</summary>
        internal static string HashValue(string value)
        {
            byte[] bytes = Encoding.Unicode.GetBytes(value == null ? "" : value);
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] digest = algorithm.ComputeHash(bytes);
                StringBuilder hex = new StringBuilder();
                for (int i = 0; i < 8 && i < digest.Length; i++)
                {
                    hex.Append(digest[i].ToString("x2", CultureInfo.InvariantCulture));
                }
                return hex.ToString();
            }
        }

        private static EnvironmentBlockResult Invalid(EnvironmentBlockResult result, string detail)
        {
            result.Valid = false;
            result.ReasonCode = ReasonInvalid;
            result.Detail = detail;
            return result;
        }
    }
}
