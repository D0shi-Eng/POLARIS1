namespace Polaris.ConfinementSpike.Shared
{
    // القيم المسموح بها لحقل Outcome، مركزية حتى لا تتفرق النصوص في الكود
    public static class OutcomeKind
    {
        public const string Allow = "allow";
        public const string Deny = "deny";
        public const string Error = "error";
        public const string Skipped = "skipped";
    }
}
