using System;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.ConfinementSpike.Launcher
{
    // يمثل ملف تعريف AppContainer قائمًا مع معرف الأمان الخاص به
    public sealed class AppContainerProfile : IDisposable
    {
        public string Name;
        public string SidString;
        public IntPtr Sid;
        public bool CreatedByThisRun;

        public void Dispose()
        {
            if (Sid != IntPtr.Zero)
            {
                AppContainerNativeMethods.FreeSid(Sid);
                Sid = IntPtr.Zero;
            }
        }
    }
}
