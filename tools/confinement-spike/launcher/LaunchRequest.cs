using System;

namespace Polaris.ConfinementSpike.Launcher
{
    // وصف تشغيل واحد. لا يحتوي أي منطق، بيانات فقط
    public sealed class LaunchRequest
    {
        public string ExecutablePath;
        public string Arguments;
        public string WorkingDirectory;

        // فارغ يعني تشغيل بلا AppContainer، وهو نمط خط الأساس
        public AppContainerProfile Profile;
        public CapabilitySet Capabilities;

        // الانسحاب من ALL APPLICATION PACKAGES، أي AppContainer أقل امتيازًا
        public bool LessPrivilegedAppContainer;

        public IntPtr StandardOutputHandle = IntPtr.Zero;
        public IntPtr StandardErrorHandle = IntPtr.Zero;

        // مقبض يُورَّث عمدًا لاختبار تسرب المقابض
        public IntPtr LeakedHandle = IntPtr.Zero;

        public IntPtr JobHandle = IntPtr.Zero;
        public int TimeoutMilliseconds = 120000;
    }

    // نتيجة تشغيل واحد مع مرحلة الفشل إن وُجد، حتى لا نخلط فشل الإطلاق بفشل الحصر
    public sealed class LaunchResult
    {
        public bool Created;
        public int ErrorCode;
        public string FailureStage;
        public uint ProcessId;
        public uint ExitCode;
        public bool TimedOut;
        public bool AssignedToJob;
        public int JobAssignError;
    }
}
