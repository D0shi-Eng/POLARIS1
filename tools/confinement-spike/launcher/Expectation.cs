namespace Polaris.ConfinementSpike.Launcher
{
    // التوقع المسبق لنتيجة محاولة واحدة ضمن نمط تشغيل محدد
    public sealed class Expectation
    {
        public string Expected;                 // allow أو deny أو documented أو control
        public string EnforcementLayer;
        public string RequiredDetailSubstring;  // يُفحص فقط عندما تكون النتيجة allow
        public string Note;

        public Expectation(string expected, string enforcementLayer, string requiredDetail, string note)
        {
            Expected = expected;
            EnforcementLayer = enforcementLayer;
            RequiredDetailSubstring = requiredDetail;
            Note = note;
        }
    }

    public static class ExpectedValue
    {
        public const string Allow = "allow";
        public const string Deny = "deny";
        public const string Documented = "documented";
        public const string Control = "control";
    }
}
