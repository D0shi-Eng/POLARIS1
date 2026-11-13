using System;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// هوية كائن الهدف كما يرصدها المُطلِق على المسار المحلول، قبل الإطلاق.
    ///
    /// لماذا توجد أصلًا (ADR-010 / SAME_OBJECT_VERIFY_AND_USE): المنفّذ داخل
    /// الحاوية لا يعيد حلّ اسم المسار — أثبت تشغيل 2026-09-04 18:24Z أن حلّ الاسم
    /// يفشل EPERM بينما الفتح للقراءة ينجح على الكائن نفسه. فبدل أن يعيد المنفّذ
    /// الحلّ، يحمل معه هويةَ الكائن الذي أُقرّ، ويطابقها على مقبضه هو بعد فتح واحد.
    ///
    /// المصدر واجهة موثّقة واحدة: GetFileInformationByHandle على مقبض مفتوح.
    /// الرقم المستعمل هو رقم الكائن (file index) ومعه الرقم التسلسلي لوحدة التخزين.
    /// لا يُدّعى تطابق ترميز هذا الرقم مع ما تبلّغه بيئة تشغيل أخرى إلا بقياس؛
    /// ولذلك يُقارَن في الدليل بما يبلّغه ضابط ACL من داخل الحاوية نفسها.
    /// </summary>
    internal sealed class TargetObjectIdentity
    {
        public bool Available;
        public string Volume = "0";
        public string FileId = "0";
        public string FailureDetail = "";

        [StructLayout(LayoutKind.Sequential)]
        private struct BY_HANDLE_FILE_INFORMATION
        {
            public uint dwFileAttributes;
            public uint ftCreationTimeLow;
            public uint ftCreationTimeHigh;
            public uint ftLastAccessTimeLow;
            public uint ftLastAccessTimeHigh;
            public uint ftLastWriteTimeLow;
            public uint ftLastWriteTimeHigh;
            public uint dwVolumeSerialNumber;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint nNumberOfLinks;
            public uint nFileIndexHigh;
            public uint nFileIndexLow;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetFileInformationByHandle(IntPtr hFile, out BY_HANDLE_FILE_INFORMATION lpFileInformation);

        /// <summary>
        /// يفتح المسار مرة واحدة ويأخذ الهوية من ذلك المقبض. الفشل يُسجَّل بسببه
        /// ولا يُطوى في قيمة صفرية صامتة.
        /// </summary>
        public static TargetObjectIdentity Of(string path)
        {
            TargetObjectIdentity identity = new TargetObjectIdentity();
            try
            {
                FileShare share = FileShare.ReadWrite | FileShare.Delete;
                using (FileStream stream = new FileStream(path, FileMode.Open, FileAccess.Read, share))
                {
                    BY_HANDLE_FILE_INFORMATION information;
                    IntPtr handle = stream.SafeFileHandle.DangerousGetHandle();
                    if (!GetFileInformationByHandle(handle, out information))
                    {
                        int error = Marshal.GetLastWin32Error();
                        identity.FailureDetail = "GetFileInformationByHandle failed with Win32 error "
                            + error.ToString(CultureInfo.InvariantCulture);
                        return identity;
                    }
                    ulong index = ((ulong)information.nFileIndexHigh << 32) | (ulong)information.nFileIndexLow;
                    identity.Volume = information.dwVolumeSerialNumber.ToString(CultureInfo.InvariantCulture);
                    identity.FileId = index.ToString(CultureInfo.InvariantCulture);
                    identity.Available = index != 0;
                    if (!identity.Available)
                    {
                        identity.FailureDetail = "the volume reported object index 0, which is not an identity";
                    }
                }
            }
            catch (Exception error)
            {
                identity.FailureDetail = error.GetType().Name + ": " + error.Message;
            }
            return identity;
        }

        /// <summary>هل تطابق هذه الهوية ما بلّغته بيئة تشغيل أخرى عن الكائن نفسه.</summary>
        public bool Matches(string otherVolume, string otherFileId)
        {
            if (!Available) { return false; }
            if (!string.Equals(FileId, otherFileId, StringComparison.Ordinal)) { return false; }
            bool volumeComparable = Volume != "0" && otherVolume != null && otherVolume.Length > 0 && otherVolume != "0";
            if (!volumeComparable) { return true; }
            return string.Equals(Volume, otherVolume, StringComparison.Ordinal);
        }

        internal void Emit(JsonWriter json, string name)
        {
            json.Name(name).BeginObject();
            json.Property("available", Available);
            json.Property("volume", Volume);
            json.Property("file", FileId);
            json.Property("source", "GetFileInformationByHandle on a handle the launcher opened once");
            json.Property("failure_detail", FailureDetail);
            json.EndObject();
        }
    }
}
