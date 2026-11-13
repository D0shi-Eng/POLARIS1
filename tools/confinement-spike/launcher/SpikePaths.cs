using System.IO;

namespace Polaris.ConfinementSpike.Launcher
{
    // كل المسارات مشتقة من جذر المشروع. لا يُكتب أي شيء خارج هذا الجذر
    public sealed class SpikePaths
    {
        public string ProjectRoot;

        public SpikePaths(string projectRoot)
        {
            ProjectRoot = Path.GetFullPath(projectRoot).TrimEnd('\\');
        }

        public string FixtureRoot { get { return Path.Combine(ProjectRoot, @"tests\confinement\fixture"); } }
        public string BinDirectory { get { return Path.Combine(ProjectRoot, @"tools\confinement-spike\build\bin"); } }
        public string EvidenceRoot { get { return Path.Combine(ProjectRoot, "evidence"); } }
        public string ChildExecutable { get { return Path.Combine(BinDirectory, "polaris-adversarial-child.exe"); } }
        public string ResultsJson { get { return Path.Combine(EvidenceRoot, "w1-results.json"); } }
        public string EnvironmentJson { get { return Path.Combine(EvidenceRoot, "environment.json"); } }
        public string ResultsMarkdown { get { return Path.Combine(ProjectRoot, @"docs\phases\PHASE-00\W1-RESULTS.md"); } }
    }
}
