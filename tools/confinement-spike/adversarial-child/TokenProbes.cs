using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Polaris.ConfinementSpike.Child.Native;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // محاولات التحقق من أن آلية الحصر مطبقة فعلًا على هذه العملية.
    // هذه ليست اختبارات هروب بل شروط صحة لبقية الاختبارات
    internal static class TokenProbes
    {
        public static void Run(ProbeContext context, OutcomeRecorder recorder)
        {
            recorder.Add(Identity());
            recorder.Add(AppContainerState());
            recorder.Add(JobMembership());
        }

        private static ProbeOutcome Identity()
        {
            try
            {
                WindowsIdentity identity = WindowsIdentity.GetCurrent();
                return new ProbeOutcome("V01", "WindowsIdentity.GetCurrent", OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                    "user=" + identity.Name + " sid=" + identity.User.Value);
            }
            catch (Exception ex)
            {
                return new ProbeOutcome("V01", "WindowsIdentity.GetCurrent", OutcomeKind.Error, 0, "MANAGED_EXCEPTION",
                    ex.GetType().Name);
            }
        }

        private static ProbeOutcome AppContainerState()
        {
            IntPtr token = IntPtr.Zero;
            IntPtr buffer = IntPtr.Zero;
            try
            {
                if (!TokenNativeMethods.OpenProcessToken(ChildNativeMethods.GetCurrentProcess(),
                        TokenNativeMethods.TOKEN_QUERY, out token))
                {
                    int error = Marshal.GetLastWin32Error();
                    return new ProbeOutcome("V02", "OpenProcessToken TOKEN_QUERY", OutcomeKind.Error, error,
                        Win32ErrorNames.Resolve(error), "cannot inspect own token");
                }

                buffer = Marshal.AllocHGlobal(sizeof(int));
                int returned;
                if (!TokenNativeMethods.GetTokenInformation(token, TokenNativeMethods.TokenIsAppContainer,
                        buffer, sizeof(int), out returned))
                {
                    int error = Marshal.GetLastWin32Error();
                    return new ProbeOutcome("V02", "GetTokenInformation TokenIsAppContainer", OutcomeKind.Error, error,
                        Win32ErrorNames.Resolve(error), "query failed");
                }

                int isAppContainer = Marshal.ReadInt32(buffer);
                return new ProbeOutcome("V02", "GetTokenInformation TokenIsAppContainer", OutcomeKind.Allow, 0,
                    "ERROR_SUCCESS", "is_app_container=" + isAppContainer);
            }
            finally
            {
                if (buffer != IntPtr.Zero) { Marshal.FreeHGlobal(buffer); }
                if (token != IntPtr.Zero) { ChildNativeMethods.CloseHandle(token); }
            }
        }

        private static ProbeOutcome JobMembership()
        {
            bool inJob;
            if (!ChildNativeMethods.IsProcessInJob(ChildNativeMethods.GetCurrentProcess(), IntPtr.Zero, out inJob))
            {
                int error = Marshal.GetLastWin32Error();
                return new ProbeOutcome("V03", "IsProcessInJob(self, NULL)", OutcomeKind.Error, error,
                    Win32ErrorNames.Resolve(error), "query failed");
            }
            return new ProbeOutcome("V03", "IsProcessInJob(self, NULL)", OutcomeKind.Allow, 0, "ERROR_SUCCESS",
                "in_job=" + (inJob ? "1" : "0"));
        }
    }
}
