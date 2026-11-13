using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>نقطة إعادة تحليل وُجدت داخل نطاق كود التشغيل: أين، وبأي سمات، وبأي وسم.</summary>
    internal sealed class ReparseFinding
    {
        public string RelativePath = "";
        public string FileAttributes = "";
        public string ReparseTag = "";
        public string Classification = "";
    }

    /// <summary>
    /// فحص نطاق كود التشغيل بحثًا عن أي رابط رمزي أو junction أو نقطة تركيب أو
    /// أي نقطة إعادة تحليل أخرى، قبل منح أي ACL وقبل إطلاق أي عملية.
    ///
    /// لماذا: تدريجُ البايتات وإثبات بصماتها لا يقول شيئًا عن شكل الشجرة. مدخلٌ
    /// واحد من نوع reparse داخل RUNTIME_CODE_SCOPE يعني أن ما يُحمَّل قد يأتي من
    /// خارج النطاق الممنوح، فتصير «شجرة نظيفة البايتات» ادّعاءً لا برهانًا.
    /// المجموعة المسموحة في W4 صفر: أي نقطة إعادة تحليل — معروفة أو لا — تُوقف.
    ///
    /// ولا تُتبَع نقطة إعادة تحليل لفحصها: الاستعلام بواجهة السرد وحدها
    /// (FindFirstFileW)، وهي تعطي سمات المدخل ووسمه بلا فتح الهدف خلفه؛ والنزول
    /// لا يقع إلا في مجلد ثبت أنه ليس نقطة إعادة تحليل.
    /// </summary>
    internal sealed class ReparseScan
    {
        internal const string ReasonPresent = "RUNTIME_CODE_REPARSE_POINT_PRESENT";
        internal const string ReasonIncomplete = "RUNTIME_CODE_REPARSE_SCAN_INCOMPLETE";

        private const uint FileAttributeReparsePoint = 0x00000400;
        private const uint FileAttributeDirectory = 0x00000010;
        private const uint TagMountPoint = 0xA0000003;
        private const uint TagSymlink = 0xA000000C;
        private const uint TagAppExecLink = 0x8000001B;
        private const uint TagCloudFilesPlaceholder = 0x9000001A;
        private const int MaxEntries = 20000;

        public bool Scanned;
        public bool Clean;
        public bool Incomplete;
        public int EntryCount;
        public int ReparseCount;
        public string Root = "";
        public string IncompleteReason = "";
        public List<ReparseFinding> Findings = new List<ReparseFinding>();

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct FIND_DATA
        {
            public uint dwFileAttributes;
            public uint ftCreationTimeLow;
            public uint ftCreationTimeHigh;
            public uint ftLastAccessTimeLow;
            public uint ftLastAccessTimeHigh;
            public uint ftLastWriteTimeLow;
            public uint ftLastWriteTimeHigh;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint dwReserved0;
            public uint dwReserved1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string cFileName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
            public string cAlternateFileName;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr FindFirstFileW(string lpFileName, out FIND_DATA lpFindFileData);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindClose(IntPtr hFindFile);

        /// <summary>
        /// يفحص الجذر وكل ما تحته. يعيد true فقط إن اكتمل الفحص ولم يُعثر على شيء.
        /// النظافة لا تُفترض عند تعذّر الفحص: تُصنَّف Incomplete ولا تمرّ.
        /// </summary>
        public bool Scan(string root)
        {
            Root = root;
            Scanned = true;
            try
            {
                if (!Directory.Exists(root))
                {
                    Incomplete = true;
                    IncompleteReason = "the runtime-code scope does not exist at " + root;
                    return false;
                }
                Inspect(root, "");
                Walk(root, "");
            }
            catch (Exception error)
            {
                Incomplete = true;
                IncompleteReason = error.GetType().Name + ": " + error.Message;
                return false;
            }
            if (Incomplete) { return false; }
            Clean = ReparseCount == 0;
            return Clean;
        }

        private void Walk(string directory, string relative)
        {
            string[] entries;
            try
            {
                entries = Directory.GetFileSystemEntries(directory);
            }
            catch (Exception error)
            {
                Incomplete = true;
                IncompleteReason = "the scope could not be enumerated at " + relative + ": "
                    + error.GetType().Name + ": " + error.Message;
                return;
            }

            for (int i = 0; i < entries.Length; i++)
            {
                if (EntryCount >= MaxEntries)
                {
                    Incomplete = true;
                    IncompleteReason = "the scope holds more entries than the scan ceiling of "
                        + MaxEntries.ToString(CultureInfo.InvariantCulture);
                    return;
                }
                string entry = entries[i];
                string name = Path.GetFileName(entry);
                string childRelative = relative.Length == 0 ? name : relative + "\\" + name;
                uint attributes = Inspect(entry, childRelative);
                if (Incomplete) { return; }
                bool isDirectory = (attributes & FileAttributeDirectory) != 0;
                bool isReparse = (attributes & FileAttributeReparsePoint) != 0;
                // لا نزول خلف نقطة إعادة تحليل: تُسجَّل ولا تُتبَع.
                if (isDirectory && !isReparse) { Walk(entry, childRelative); }
            }
        }

        /// <summary>يستعلم عن مدخل واحد بلا فتح هدفه، ويسجّله. يعيد سماته.</summary>
        private uint Inspect(string path, string relative)
        {
            FIND_DATA data;
            IntPtr handle = FindFirstFileW(path, out data);
            if (handle == new IntPtr(-1))
            {
                int error = Marshal.GetLastWin32Error();
                Incomplete = true;
                IncompleteReason = "FindFirstFileW failed on " + relative + " with Win32 error "
                    + error.ToString(CultureInfo.InvariantCulture);
                return 0;
            }
            FindClose(handle);

            EntryCount++;
            uint attributes = data.dwFileAttributes;
            if ((attributes & FileAttributeReparsePoint) != 0)
            {
                ReparseCount++;
                ReparseFinding finding = new ReparseFinding();
                finding.RelativePath = relative.Length == 0 ? "." : relative;
                finding.FileAttributes = "0x" + attributes.ToString("x8", CultureInfo.InvariantCulture);
                finding.ReparseTag = "0x" + data.dwReserved0.ToString("x8", CultureInfo.InvariantCulture);
                finding.Classification = Classify(data.dwReserved0);
                Findings.Add(finding);
            }
            return attributes;
        }

        private static string Classify(uint tag)
        {
            if (tag == TagMountPoint) { return "JUNCTION_OR_MOUNT_POINT"; }
            if (tag == TagSymlink) { return "SYMBOLIC_LINK"; }
            if (tag == TagAppExecLink) { return "APP_EXECUTION_ALIAS"; }
            if (tag == TagCloudFilesPlaceholder) { return "CLOUD_FILES_PLACEHOLDER"; }
            return "UNKNOWN_REPARSE_TAG";
        }

        internal void Emit(JsonWriter json)
        {
            json.Name("runtime_code_reparse_scan").BeginObject();
            json.Property("scanned", Scanned);
            json.Property("root", Root);
            json.Property("entry_count", EntryCount);
            json.Property("reparse_count", ReparseCount);
            json.Property("allowed_reparse_tags", new string[0]);
            json.Property("follows_reparse_points", false);
            json.Property("method", "FindFirstFileW attributes and reparse tag, no target open");
            json.Name("findings").BeginArray();
            for (int i = 0; i < Findings.Count; i++)
            {
                ReparseFinding finding = Findings[i];
                json.BeginObject();
                json.Property("relative_path", finding.RelativePath);
                json.Property("file_attributes", finding.FileAttributes);
                json.Property("reparse_tag", finding.ReparseTag);
                json.Property("classification", finding.Classification);
                json.EndObject();
            }
            json.EndArray();
            json.Property("incomplete", Incomplete);
            json.Property("incomplete_reason", IncompleteReason);
            json.Property("clean", Clean);
            json.EndObject();
        }
    }
}
