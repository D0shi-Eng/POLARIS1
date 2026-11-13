using System;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.ConfinementSpike.Launcher
{
    // مسؤولية واحدة: إنشاء ملفات تعريف AppContainer وحذفها.
    // لا يتخذ أي قرار سياسة، ولا يشغّل عمليات
    public sealed class AppContainerProfileManager
    {
        public AppContainerProfile CreateOrOpen(string name, string displayName, string description)
        {
            AppContainerProfile profile = new AppContainerProfile();
            profile.Name = name;

            IntPtr sid;
            int hresult = AppContainerNativeMethods.CreateAppContainerProfile(
                name, displayName, description, IntPtr.Zero, 0, out sid);

            if (hresult == AppContainerNativeMethods.HRESULT_ALREADY_EXISTS)
            {
                // ملف تعريف متبقٍ من تشغيل سابق. نشتق المعرف بدل الفشل
                hresult = AppContainerNativeMethods.DeriveAppContainerSidFromAppContainerName(name, out sid);
                profile.CreatedByThisRun = false;
            }
            else
            {
                profile.CreatedByThisRun = true;
            }

            if (hresult < 0)
            {
                throw new InvalidOperationException(
                    "CreateAppContainerProfile failed for '" + name + "' with HRESULT 0x" + hresult.ToString("x8"));
            }

            profile.Sid = sid;
            profile.SidString = SidToString(sid);
            return profile;
        }

        public int Delete(string name)
        {
            return AppContainerNativeMethods.DeleteAppContainerProfile(name);
        }

        public static string SidToString(IntPtr sid)
        {
            IntPtr text;
            if (!AppContainerNativeMethods.ConvertSidToStringSidW(sid, out text))
            {
                return "SID_CONVERSION_FAILED";
            }
            try
            {
                return Marshal.PtrToStringUni(text);
            }
            finally
            {
                AppContainerNativeMethods.LocalFree(text);
            }
        }
    }
}
