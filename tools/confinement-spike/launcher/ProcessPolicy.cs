namespace Polaris.ConfinementSpike.Launcher
{
    // سياسة حدود العمليات والموارد. قيم متحفظة عمدًا حتى لا يتأثر جهاز المستخدم
    public sealed class ProcessPolicy
    {
        public uint ActiveProcessLimit = 8;
        public int JobMemoryLimitMegabytes = 384;
        public uint CpuRatePercent = 20;

        // منع الانفصال عن الـ job، ومنع بقاء أي عملية بعد إغلاق مقبض الـ job
        public bool KillOnJobClose = true;
        public bool AllowBreakaway = false;
    }
}
