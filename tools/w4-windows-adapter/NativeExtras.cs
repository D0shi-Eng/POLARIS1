using System;
using System.Runtime.InteropServices;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    // واجهات Win32 التي يحتاجها محوّل W4 ولا توجد في طبقة W1.
    // الفحص كله بواجهات موثّقة: لا استدعاء لـ ntdll ولا بنى غير معلنة.
    internal static class NativeExtras
    {
        internal const uint DUPLICATE_SAME_ACCESS = 0x00000002;
        internal const uint FILE_TYPE_UNKNOWN = 0x0000;
        internal const uint FILE_TYPE_DISK = 0x0001;
        internal const uint FILE_TYPE_CHAR = 0x0002;
        internal const uint FILE_TYPE_PIPE = 0x0003;
        internal const uint HANDLE_FLAG_INHERIT = 0x00000001;
        internal const uint VOLUME_NAME_DOS = 0x0;
        internal const uint STILL_ACTIVE = 259;

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool DuplicateHandle(
            IntPtr hSourceProcessHandle, IntPtr hSourceHandle, IntPtr hTargetProcessHandle,
            out IntPtr lpTargetHandle, uint dwDesiredAccess,
            [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwOptions);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr GetCurrentProcess();

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint GetCurrentProcessId();

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern uint GetFileType(IntPtr hFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        internal static extern uint GetFinalPathNameByHandleW(
            IntPtr hFile, StringBuilder lpszFilePath, uint cchFilePath, uint dwFlags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetHandleInformation(IntPtr hObject, uint dwMask, uint dwFlags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetHandleInformation(IntPtr hObject, out uint lpdwFlags);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool CreatePipe(
            out IntPtr hReadPipe, out IntPtr hWritePipe, IntPtr lpPipeAttributes, uint nSize);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ReadFile(
            IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToRead,
            out uint lpNumberOfBytesRead, IntPtr lpOverlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool WriteFile(
            IntPtr hFile, byte[] lpBuffer, uint nNumberOfBytesToWrite,
            out uint lpNumberOfBytesWritten, IntPtr lpOverlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool SetFilePointerEx(
            IntPtr hFile, long liDistanceToMove, IntPtr lpNewFilePointer, uint dwMoveMethod);

        [DllImport("kernel32.dll", SetLastError = true)]
        internal static extern IntPtr OpenProcess(uint dwDesiredAccess, [MarshalAs(UnmanagedType.Bool)] bool bInheritHandle, uint dwProcessId);

        [StructLayout(LayoutKind.Sequential)]
        internal struct JOBOBJECT_BASIC_PROCESS_ID_LIST
        {
            internal uint NumberOfAssignedProcesses;
            internal uint NumberOfProcessIdsInList;
            internal IntPtr ProcessIdList;
        }

        /// <summary>
        /// هوية الكائن خلف مقبضين. واجهة موثّقة (kernelbase، ويندوز 10 1607+)،
        /// وتُستعمل لتمييز ما أنشأه المسبار نفسه عمّا وُرث فعلًا. غيابها لا يوقف
        /// الفحص: يُسجَّل أن التمييز غير متاح، ولا يُدَّعى تصنيف لم يُقَس.
        /// </summary>
        [DllImport("kernelbase.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CompareObjectHandles(IntPtr first, IntPtr second);

        private static bool _objectIdentityChecked;
        private static bool _objectIdentityAvailable;

        internal static bool ObjectIdentityAvailable { get { return _objectIdentityChecked && _objectIdentityAvailable; } }

        internal static bool SameObject(IntPtr first, IntPtr second)
        {
            if (first == IntPtr.Zero || second == IntPtr.Zero) { return false; }
            try
            {
                bool same = CompareObjectHandles(first, second);
                _objectIdentityChecked = true;
                _objectIdentityAvailable = true;
                return same;
            }
            catch (Exception)
            {
                _objectIdentityChecked = true;
                _objectIdentityAvailable = false;
                return false;
            }
        }

        internal const uint PROCESS_DUP_HANDLE = 0x0040;
        internal const uint PROCESS_QUERY_INFORMATION = 0x0400;
        internal const uint PROCESS_TERMINATE = 0x0001;
    }
}
