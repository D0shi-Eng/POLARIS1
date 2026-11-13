using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using Polaris.ConfinementSpike.Child.Native;

namespace Polaris.ConfinementSpike.Child
{
    // الأدوار الثانوية للبرنامج العدائي. كل دور صغير ومحدد
    internal static class RoleHandlers
    {
        // دور الحفيد: يثبت وجوده ثم يولّد جيلًا ثالثًا ويسجل حالته
        public static int RunGrandchild(CommandLineOptions options)
        {
            string markerPath = options.GetString("marker", null);
            string selfPath = options.GetString("self", null);

            bool selfInJob = false;
            ChildNativeMethods.IsProcessInJob(ChildNativeMethods.GetCurrentProcess(), IntPtr.Zero, out selfInJob);

            StringBuilder marker = new StringBuilder();
            marker.Append("grandchild_pid=")
                  .Append(System.Diagnostics.Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture))
                  .Append(" grandchild_in_job=").Append(selfInJob ? "1" : "0");

            if (!string.IsNullOrEmpty(selfPath))
            {
                SpawnResult result = ProcessSpawner.Spawn(selfPath, ProcessSpawner.SleeperArguments(3000), 0);
                if (result.Created)
                {
                    marker.Append(" great_grandchild_pid=")
                          .Append(result.ProcessId.ToString(CultureInfo.InvariantCulture))
                          .Append(" great_grandchild_in_job=").Append(result.ChildInJob ? "1" : "0");
                }
                else
                {
                    marker.Append(" great_grandchild_pid=0 great_grandchild_error=")
                          .Append(result.ErrorCode.ToString(CultureInfo.InvariantCulture));
                }
            }

            string line = marker.ToString();
            Console.Out.WriteLine("GRANDCHILD\t" + line);

            if (!string.IsNullOrEmpty(markerPath))
            {
                try
                {
                    File.WriteAllText(markerPath, line, new UTF8Encoding(false));
                }
                catch (Exception ex)
                {
                    Console.Out.WriteLine("GRANDCHILD_MARKER_FAILED\t" + ex.GetType().Name);
                }
            }
            return 0;
        }

        // دور النائم: عملية طويلة العمر تُستخدم لاختبار البقاء بعد إنهاء الحصر
        public static int RunSleeper(CommandLineOptions options)
        {
            int milliseconds = options.GetInt32("sleep", 5000);
            Thread.Sleep(milliseconds);
            return 0;
        }

        // دور الحارس: عملية بريئة يشغّلها الـ launcher خارج الحصر لاختبار التأثير الخارجي
        public static int RunSentinel(CommandLineOptions options)
        {
            int milliseconds = options.GetInt32("sleep", 60000);
            Console.Out.WriteLine("SENTINEL_READY\t" +
                System.Diagnostics.Process.GetCurrentProcess().Id.ToString(CultureInfo.InvariantCulture));
            Console.Out.Flush();
            Thread.Sleep(milliseconds);
            return 0;
        }
    }
}
