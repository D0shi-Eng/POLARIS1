namespace Polaris.ConfinementSpike.Launcher
{
    // سجل نتيجة نهائي واحد كما سيظهر في الأدلة والتقرير
    public sealed class TestRecord
    {
        public string Variant;
        public string TestId;
        public string Category;
        public string Attempt;
        public string Expected;
        public string Actual;
        public string EnforcementLayer;
        public string OsErrorName;
        public int OsErrorCode;
        public string Result;
        public bool Passed;
        public string EvidencePath;
        public string Notes;
    }

    public static class ResultValue
    {
        public const string Pass = "PASS";
        public const string Fail = "FAIL";
        public const string Documented = "DOCUMENTED";
        public const string Control = "CONTROL";
        public const string Inconclusive = "INCONCLUSIVE";
        public const string NotTested = "NOT_TESTED";
        public const string RequiresAdmin = "REQUIRES_ADMIN";
        public const string Blocked = "BLOCKED";
    }

    public static class TestCategory
    {
        public static string FromId(string testId)
        {
            if (string.IsNullOrEmpty(testId)) { return "unknown"; }
            switch (testId[0])
            {
                case 'F': return "filesystem";
                case 'P': return "process";
                case 'N': return "network";
                case 'X': return "escape";
                case 'V': return "validation";
                default: return "unknown";
            }
        }
    }
}
