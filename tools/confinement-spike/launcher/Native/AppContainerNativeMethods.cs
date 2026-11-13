using System;
using System.Runtime.InteropServices;

namespace Polaris.ConfinementSpike.Launcher.Native
{
    // واجهات إنشاء ملفات تعريف AppContainer واشتقاق معرفات الأمان.
    // إنشاء الملف التعريفي لا يتطلب صلاحيات مدير، وهذه نقطة مهمة في تقييم قابلية التبني
    internal static class AppContainerNativeMethods
    {
        internal const int HRESULT_ALREADY_EXISTS = unchecked((int)0x800700B7);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = false)]
        internal static extern int CreateAppContainerProfile(
            string pszAppContainerName,
            string pszDisplayName,
            string pszDescription,
            IntPtr pCapabilities,
            int dwCapabilityCount,
            out IntPtr ppSidAppContainerSid);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = false)]
        internal static extern int DeleteAppContainerProfile(string pszAppContainerName);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = false)]
        internal static extern int DeriveAppContainerSidFromAppContainerName(
            string pszAppContainerName, out IntPtr ppsidAppContainerSid);

        [DllImport("userenv.dll", CharSet = CharSet.Unicode, SetLastError = false)]
        internal static extern int GetAppContainerFolderPath(string pszAppContainerSid, out IntPtr ppszPath);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ConvertStringSidToSidW(string stringSid, out IntPtr sid);

        [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        internal static extern bool ConvertSidToStringSidW(IntPtr sid, out IntPtr stringSid);

        [DllImport("advapi32.dll")]
        internal static extern IntPtr FreeSid(IntPtr pSid);

        [DllImport("kernel32.dll")]
        internal static extern IntPtr LocalFree(IntPtr hMem);

        [DllImport("ole32.dll")]
        internal static extern void CoTaskMemFree(IntPtr ptr);
    }
}
