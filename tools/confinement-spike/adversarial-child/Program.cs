using System;
using System.IO;

namespace Polaris.ConfinementSpike.Child
{
    // نقطة الدخول للبرنامج العدائي.
    // البرنامج لا يعرف ما هو متوقع منه، بل يحاول ويسجل فقط.
    // هذا الفصل مقصود حتى لا يتحول الاختبار إلى تأكيد ذاتي
    internal static class Program
    {
        private static int Main(string[] args)
        {
            CommandLineOptions options = CommandLineOptions.Parse(args);
            string role = options.GetString("role", "probe");

            switch (role)
            {
                case "grandchild":
                    return RoleHandlers.RunGrandchild(options);
                case "sleeper":
                    return RoleHandlers.RunSleeper(options);
                case "sentinel":
                    return RoleHandlers.RunSentinel(options);
                default:
                    return RunProbeSuite(options);
            }
        }

        private static int RunProbeSuite(CommandLineOptions options)
        {
            ProbeContext context = new ProbeContext();
            context.FixtureRoot = options.GetString("fixture", ".");
            context.EvidenceDirectory = options.GetString("evidence", ".");
            context.ReportPath = options.GetString("report", Path.Combine(context.EvidenceDirectory, "child-report.tsv"));
            context.SelfExecutablePath = options.GetString("self", System.Reflection.Assembly.GetExecutingAssembly().Location);
            context.SentinelProcessId = options.GetInt32("sentinel-pid", 0);
            context.LeakedFileHandle = options.GetHandle("leaked-handle");
            context.LoopbackPort = options.GetInt32("loopback-port", 0);
            context.Variant = options.GetString("variant", "unknown");
            context.MaxSpawnAttempts = options.GetInt32("max-spawn", 12);

            OutcomeRecorder recorder = new OutcomeRecorder();

            // ترتيب مقصود: نتحقق أولًا أن آلية الحصر مطبقة، ثم نجرب الهروب
            TokenProbes.Run(context, recorder);
            FileProbes.Run(context, recorder);
            EnvironmentProbes.Run(context, recorder);
            NetworkProbes.Run(context, recorder);
            ProcessProbes.Run(context, recorder);

            bool written = recorder.TryWriteReport(context.ReportPath, context.Variant);
            Console.Out.WriteLine("REPORT_WRITTEN\t" + (written ? "1" : "0") + "\t" + context.ReportPath);
            Console.Out.Flush();
            return 0;
        }
    }
}
