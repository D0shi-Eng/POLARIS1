namespace Polaris.ConfinementSpike.Child
{
    // أهداف شبكية ثابتة ومعروفة، مختارة لأنها عامة وغير حساسة.
    // نستخدم عناوين IP مباشرة حيثما أمكن حتى لا نخلط فشل DNS بفشل سياسة الخروج
    internal static class NetworkTargets
    {
        // نقطة يريد Polaris لاحقًا السماح بها
        public const string AllowedCandidateHost = "example.com";
        public const int HttpsPort = 443;

        // نقطة يريد Polaris لاحقًا منعها. الاختبار يثبت هل يمكن التمييز بينهما أصلًا
        public const string DisallowedCandidateIp = "8.8.8.8";

        // عنوان محايد لاختبار المنع الافتراضي دون الاعتماد على DNS
        public const string NeutralIp = "1.1.1.1";
        public const int DnsPort = 53;

        public const int ConnectTimeoutMilliseconds = 3000;
    }
}
