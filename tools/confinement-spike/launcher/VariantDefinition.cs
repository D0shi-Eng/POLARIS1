namespace Polaris.ConfinementSpike.Launcher
{
    // تعريف نمط تشغيل واحد. الفصل بين الأنماط ضروري لنسب كل نتيجة إلى آليتها
    public sealed class VariantDefinition
    {
        public string Id;
        public string Description;
        public bool UseAppContainer;
        public string[] Capabilities;
        public bool LessPrivilegedAppContainer;
        public bool UseJobObject;
        public bool LeakDeniedFileHandle;
        public string EnforcementLayer;
        public bool IsBaseline;

        // إعفاء loopback يتطلب صلاحيات مدير، لذا لا يُدرج هذا النمط إلا عند التشغيل المرفوع
        public bool LoopbackExempt;
        public bool RequiresElevation;
    }
}
