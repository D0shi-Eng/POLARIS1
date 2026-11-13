using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// اختبار ذاتي لبناء كتلة البيئة ولاقتباس سطر الأوامر.
    ///
    /// لماذا هو وضع في المحوّل لا سكربت جانبي: الذي يبني الكتلة على ويندوز هو هذا
    /// الثنائي بعينه، مُصرَّفًا بـcsc.exe. اختباره في مكان آخر يثبت شيئًا عن مكان
    /// آخر. يقرأ الذاكرة التي حجزها البناء نفسه، ولا يستدعي واجهة Win32 واحدة.
    ///
    /// هذا ليس قياس حصر، ولا يُقرأ نتيجةً لـW-12. هو بوابة شكل تسبق القياس.
    /// </summary>
    internal static class EnvironmentBlockSelfTestMode
    {
        private static int _failures;
        private static List<string> _cases = new List<string>();

        internal static int Run(Options options, JsonWriter json)
        {
            _failures = 0;
            _cases = new List<string>();
            ValidBlockRoundTrips();
            EmptyMapIsASingleNul();
            EmptyNameIsRejected();
            NameWithEqualsIsRejected();
            DriveCurrentDirectoryEntryIsRejected();
            EmbeddedNulIsRejected();
            CaseInsensitiveDuplicateIsRejected();
            ControlCharacterInNameIsRejected();
            SortingIsCaseInsensitive();
            CommandLineQuotesPathsWithSpaces();
            CommandLineEscapesBackslashesBeforeQuote();

            json.Property("cases", _cases);
            json.Property("case_count", _cases.Count);
            json.Property("failures", _failures);
            json.Property("verdict", _failures == 0 ? "PASS" : "FAIL");
            json.Property("reason_code", _failures == 0 ? "ENVIRONMENT_BLOCK_FORMAT_PROVEN" : "ENVIRONMENT_BLOCK_FORMAT_DEFECT");
            json.Property("measurement_started", true);
            json.Property("measurement_completed", true);
            json.Property("evidence_complete", true);
            json.Property(
                "interpretation",
                "the environment block this binary builds was parsed back out of its own allocated memory and matched the intended map. This is a format gate, not a confinement measurement.");
            return _failures == 0 ? 0 : 1;
        }

        private static void Check(bool condition, string what)
        {
            _cases.Add((condition ? "PASS " : "FAIL ") + what);
            if (!condition) { _failures++; }
        }

        private static Dictionary<string, string> Map()
        {
            return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        }

        private static void ValidBlockRoundTrips()
        {
            Dictionary<string, string> environment = Map();
            environment["PATH"] = "C:\\Windows\\System32;C:\\Windows";
            environment["SystemRoot"] = "C:\\Windows";
            environment["POLARIS_EXECUTION_HOST"] = "1";
            environment["TEMP"] = "C:\\ws\\runtime-temp";

            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(result.Valid, "a well-formed map builds");
            Check(result.RoundTripVerified, "the allocated block round-trips to the intended map");
            Check(result.SortedCaseInsensitive, "entries are sorted case-insensitively");
            Check(result.DoubleNulTerminated, "the block carries its terminating empty entry");
            Check(result.EntryCount == 4, "the entry count is the map count");
            Check(result.Names.Count == 4 && result.ValueHashes.Count == 4, "names and value hashes pair up");

            // البايتات نفسها: آخر حرفين NUL، ولا قيمة خام في السجل.
            int chars = result.ByteCount / 2;
            char last = (char) (ushort) Marshal.ReadInt16(result.Block, (chars - 1) * 2);
            char beforeLast = (char) (ushort) Marshal.ReadInt16(result.Block, (chars - 2) * 2);
            Check(last == '\0' && beforeLast == '\0', "the raw memory ends with two NUL characters");
            bool leaked = false;
            for (int i = 0; i < result.ValueHashes.Count; i++)
            {
                if (result.ValueHashes[i].IndexOf("C:\\", StringComparison.OrdinalIgnoreCase) >= 0) { leaked = true; }
            }
            Check(!leaked, "recorded value hashes carry no raw value");
            Marshal.FreeHGlobal(result.Block);
        }

        private static void EmptyMapIsASingleNul()
        {
            EnvironmentBlockResult result = EnvironmentBlock.Build(Map());
            Check(result.Valid, "an empty map is a valid block");
            Check(result.ByteCount == 2, "an empty block is exactly one NUL character");
            Marshal.FreeHGlobal(result.Block);
        }

        private static void EmptyNameIsRejected()
        {
            Dictionary<string, string> environment = Map();
            environment[""] = "value";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(!result.Valid && result.ReasonCode == EnvironmentBlock.ReasonInvalid,
                "an empty variable name is ENVIRONMENT_BLOCK_INVALID");
            Check(result.Block == IntPtr.Zero, "a rejected block allocates nothing");
        }

        private static void NameWithEqualsIsRejected()
        {
            Dictionary<string, string> environment = Map();
            environment["BAD=NAME"] = "value";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(!result.Valid, "a name containing '=' is rejected");
        }

        private static void DriveCurrentDirectoryEntryIsRejected()
        {
            Dictionary<string, string> environment = Map();
            environment["=C:"] = "C:\\somewhere";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(!result.Valid, "a drive-current-directory entry \"=X:\" is rejected, not silently emitted");
        }

        private static void EmbeddedNulIsRejected()
        {
            Dictionary<string, string> environment = Map();
            environment["NAME"] = "a\0b";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(!result.Valid, "an embedded NUL inside a value is rejected");
        }

        private static void CaseInsensitiveDuplicateIsRejected()
        {
            Dictionary<string, string> environment = new Dictionary<string, string>(StringComparer.Ordinal);
            environment["Path"] = "one";
            environment["PATH"] = "two";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(!result.Valid, "two names differing only by case are rejected");
        }

        private static void ControlCharacterInNameIsRejected()
        {
            Dictionary<string, string> environment = Map();
            environment["NA\tME"] = "value";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(!result.Valid, "a control character in a name is rejected");
        }

        private static void SortingIsCaseInsensitive()
        {
            Dictionary<string, string> environment = Map();
            environment["zulu"] = "1";
            environment["Alpha"] = "2";
            environment["mike"] = "3";
            EnvironmentBlockResult result = EnvironmentBlock.Build(environment);
            Check(result.Valid && result.Names[0] == "Alpha" && result.Names[1] == "mike" && result.Names[2] == "zulu",
                "names sort case-insensitively regardless of insertion order");
            Marshal.FreeHGlobal(result.Block);
        }

        private static void CommandLineQuotesPathsWithSpaces()
        {
            string line = ConfinedLauncher.BuildCommandLine(
                "C:\\Program Files\\nodejs\\node.exe", new string[] { "C:\\ws\\host main.js" });
            Check(line == "\"C:\\Program Files\\nodejs\\node.exe\" \"C:\\ws\\host main.js\"",
                "both argv entries are quoted");
        }

        private static void CommandLineEscapesBackslashesBeforeQuote()
        {
            string line = ConfinedLauncher.BuildCommandLine("a", new string[] { "x\\", "y\"z" });
            Check(line == "\"a\" \"x\\\\\" \"y\\\"z\"",
                "trailing backslashes and embedded quotes follow CommandLineToArgvW rules");
        }
    }
}
