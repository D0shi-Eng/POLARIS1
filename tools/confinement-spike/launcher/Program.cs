using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;

namespace Polaris.ConfinementSpike.Launcher
{
    // نقطة الدخول. الترتيب: بيئة، ثم fixture، ثم أهداف مساعدة، ثم الأنماط، ثم الأدلة
    internal static class Program
    {
        private static int Main(string[] args)
        {
            try
            {
                LauncherOptions options = LauncherOptions.Parse(args);
                SpikePaths paths = new SpikePaths(options.GetString("root", ResolveDefaultRoot()));

                Console.WriteLine("POLARIS W1 confinement spike");
                Console.WriteLine("project root : " + paths.ProjectRoot);
                Console.WriteLine("child binary : " + paths.ChildExecutable);

                if (!File.Exists(paths.ChildExecutable))
                {
                    Console.Error.WriteLine("BLOCKED: adversarial child binary not found. Run build.ps1 first.");
                    return 2;
                }

                Directory.CreateDirectory(paths.EvidenceRoot);

                string environmentJson = EnvironmentReport.Capture();
                File.WriteAllText(paths.EnvironmentJson, environmentJson, new UTF8Encoding(false));
                Console.WriteLine("elevated     : " + EnvironmentReport.IsElevated());

                // علامة بيئة تُستخدم لاختبار وراثة متغيرات البيئة داخل الحصر
                Environment.SetEnvironmentVariable("POLARIS_W1_ENV_CANARY", "8c41d0f2-env-inherited");

                FixtureManager fixture = new FixtureManager(paths.FixtureRoot);
                fixture.Prepare();

                ProcessPolicy processPolicy = new ProcessPolicy();
                ConfinementTestRunner runner = new ConfinementTestRunner(paths, processPolicy);
                for (int i = 0; i < fixture.Log.Count; i++) { runner.Log.Add(fixture.Log[i]); }

                using (SentinelHost sentinel = new SentinelHost())
                using (LoopbackListener loopback = new LoopbackListener())
                {
                    sentinel.Start(paths.ChildExecutable, 600000);
                    loopback.Start();
                    runner.Log.Add("SENTINEL pid=" + sentinel.ProcessId);
                    runner.Log.Add("LOOPBACK listener port=" + loopback.Port);
                    Console.WriteLine("sentinel pid : " + sentinel.ProcessId);
                    Console.WriteLine("loopback port: " + loopback.Port);

                    List<VariantDefinition> variants = VariantCatalog.All(EnvironmentReport.IsElevated());
                    runner.RunAll(variants, sentinel.ProcessId, loopback.Port);

                    AddFixtureIntegrityRecord(runner, fixture);
                    fixture.Cleanup();
                    for (int i = 0; i < fixture.Log.Count; i++)
                    {
                        if (!runner.Log.Contains(fixture.Log[i])) { runner.Log.Add(fixture.Log[i]); }
                    }

                    runner.Collector.WriteJson(paths.ResultsJson);
                    ResultsMarkdownWriter.Write(paths.ResultsMarkdown, runner.Collector.Records,
                        variants, environmentJson, runner.Log);
                }

                PrintSummary(runner.Collector.Records);
                Console.WriteLine("evidence     : " + paths.ResultsJson);
                Console.WriteLine("results doc  : " + paths.ResultsMarkdown);
                return 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("BLOCKED: unhandled launcher failure " + ex.GetType().Name + ": " + ex.Message);
                Console.Error.WriteLine(ex.StackTrace);
                return 3;
            }
        }

        private static void AddFixtureIntegrityRecord(ConfinementTestRunner runner, FixtureManager fixture)
        {
            bool untouched = fixture.OutsideFileUntouched();
            bool escapeWrite = fixture.EscapeWriteFileExists();

            TestRecord record = new TestRecord();
            record.Variant = "RUN_LEVEL";
            record.TestId = "F04B";
            record.Category = "filesystem";
            record.Attempt = "verify fixture/outside/untouched.txt is byte identical after the whole run";
            record.Expected = "allow";
            record.Actual = untouched ? "allow" : "deny";
            record.EnforcementLayer = "fixture-integrity";
            record.OsErrorName = untouched ? "UNCHANGED" : "CHANGED";
            record.Result = untouched ? ResultValue.Pass : ResultValue.Fail;
            record.Passed = untouched;
            record.EvidencePath = fixture.Root;
            record.Notes = "escape_write.txt present after run = " + (escapeWrite ? "YES (a write outside the granted root succeeded in at least one variant)" : "no");
            runner.Collector.AddDerived(record);
        }

        private static void PrintSummary(IList<TestRecord> records)
        {
            Dictionary<string, int> counts = new Dictionary<string, int>(StringComparer.Ordinal);
            for (int i = 0; i < records.Count; i++)
            {
                string key = records[i].Result;
                if (!counts.ContainsKey(key)) { counts[key] = 0; }
                counts[key] = counts[key] + 1;
            }
            Console.WriteLine("--- summary ---");
            foreach (KeyValuePair<string, int> pair in counts)
            {
                Console.WriteLine(pair.Key + " = " + pair.Value.ToString(CultureInfo.InvariantCulture));
            }
        }

        // الثنائيات تقع في tools\confinement-spike\build\bin، أي أربعة مستويات تحت جذر المشروع
        private static string ResolveDefaultRoot()
        {
            string binDirectory = Path.GetDirectoryName(
                System.Reflection.Assembly.GetExecutingAssembly().Location);
            DirectoryInfo current = new DirectoryInfo(binDirectory);
            for (int i = 0; i < 4 && current.Parent != null; i++)
            {
                current = current.Parent;
            }
            return current.FullName;
        }
    }
}
