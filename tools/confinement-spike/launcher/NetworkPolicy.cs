namespace Polaris.ConfinementSpike.Launcher
{
    // سياسة الشبكة على مستوى AppContainer.
    // ملاحظة جوهرية: قدرات AppContainer تعبّر عن فئة الشبكة لا عن الوجهة،
    // فلا يمكن التعبير عن قائمة سماح بعناوين محددة من هنا
    public static class NetworkPolicy
    {
        // القدرة internetClient تسمح بالخروج إلى الشبكات غير المحلية
        public const string InternetClientCapabilitySid = "S-1-15-3-1";

        // القدرة privateNetworkClientServer تسمح بالشبكة المحلية. غير مستخدمة هنا عمدًا
        public const string PrivateNetworkCapabilitySid = "S-1-15-3-3";

        public static readonly string[] NoCapabilities = new string[0];

        public static readonly string[] InternetClientOnly = new string[] { InternetClientCapabilitySid };

        // إعفاء loopback يتطلب CheckNetIsolation وصلاحيات مدير، ولا يُطبَّق تلقائيًا هنا
        public const string LoopbackExemptionNote =
            "loopback exemption requires CheckNetIsolation.exe LoopbackExempt and Administrator; not applied by this spike";
    }
}
