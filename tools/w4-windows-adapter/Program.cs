using System;
using System.Globalization;
using System.IO;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// محوّل ويندوز لـW4. يعمل على ويندوز فقط، ولا يدّعي شيئًا في غيره.
    ///
    /// الأوضاع:
    ///   handle-x03        W-11: انحدار وراثة المقابض، بضابط موجب.
    ///   confined-exec     W-12: تكامل AppContainer + Job مع منفّذ W4 الحقيقي.
    ///   env-block-selftest بوابة شكل: كتلة البيئة تُبنى وتُقرأ من ذاكرتها نفسها.
    ///   handle-child      ابن داخلي يفحص جدول مقابضه. لا يُستدعى يدويًا.
    /// </summary>
    internal static class Program
    {
        internal static int Main(string[] args)
        {
            Options options = Options.Parse(args);
            string mode = options.Get("mode", "");

            if (mode == "handle-child") { return HandleChildMode.Run(options); }

            JsonWriter json = new JsonWriter();
            json.BeginObject();
            json.Property("adapter", "polaris.w4.windows-adapter");
            json.Property("adapter_version", "1.0.0");
            json.Property("mode", mode);
            json.Property("ran_at", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture));
            json.Property("os", Environment.OSVersion.VersionString);
            json.Property("is_64_bit_process", Environment.Is64BitProcess);

            int exitCode = 0;
            try
            {
                if (mode == "handle-x03") { HandleX03Mode.Run(options, json); }
                else if (mode == "confined-exec") { ConfinedExecMode.Run(options, json); }
                else if (mode == "env-block-selftest") { exitCode = EnvironmentBlockSelfTestMode.Run(options, json); }
                else
                {
                    json.Property("verdict", "INCONCLUSIVE");
                    json.Property("interpretation", "unknown --mode; expected handle-x03, confined-exec, env-block-selftest or handle-child");
                    exitCode = 2;
                }
            }
            catch (Exception error)
            {
                json.Property("verdict", "INCONCLUSIVE");
                json.Property("exception", error.GetType().Name + ": " + error.Message);
                json.Property("interpretation", "The adapter threw before reaching a verdict. No security claim follows.");
                exitCode = 3;
            }

            json.EndObject();
            string report = options.Get("report", "");
            if (report.Length > 0)
            {
                try
                {
                    string directory = Path.GetDirectoryName(report);
                    if (!string.IsNullOrEmpty(directory)) { Directory.CreateDirectory(directory); }
                    // عقد بايتات الدليل: سطر جديد ختامي واحد، وUTF-8 بلا BOM.
                    // الافتراضي في File.WriteAllText يكتب بلا BOM أصلًا، وكان
                    // ينقصه السطر الختامي وحده — وهو ما وضع هذه الملفات خارج
                    // بوابة W5 (W6-DISCOVERIES D-01). المخرج القياسي لا يتغيّر.
                    File.WriteAllText(report, json.ToString() + "\n", new UTF8Encoding(false));
                }
                catch (Exception)
                {
                    // كتابة الملف مجهود أفضل. المخرج القياسي يبقى المصدر.
                }
            }
            Console.Out.Write(json.ToString());
            Console.Out.Flush();
            return exitCode;
        }
    }
}
