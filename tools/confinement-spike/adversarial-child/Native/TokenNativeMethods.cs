using System;
using System.Runtime.InteropServices;

namespace Polaris.ConfinementSpike.Child.Native
{
    // فحص التوكن للتأكد أن العملية فعلًا داخل AppContainer.
    // بدون هذا الفحص قد ننسب المنع إلى آلية حصر لم تُطبَّق أصلًا
    internal static class TokenNativeMethods
    {
        internal const uint TOKEN_QUERY = 0x0008;
        internal const int TokenIsAppContainer = 29;
        internal const int TokenAppContainerSid = 31;

        [StructLayout(LayoutKind.Sequential)]
        internal struct TOKEN_APPCONTAINER_INFORMATION
        {
            public IntPtr TokenAppContainer;
        }

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

        [DllImport("advapi32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool GetTokenInformation(
            IntPtr tokenHandle,
            int tokenInformationClass,
            IntPtr tokenInformation,
            int tokenInformationLength,
            out int returnLength);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr stringSid);

        [DllImport("kernel32.dll")]
        internal static extern IntPtr LocalFree(IntPtr hMem);
    }
}
