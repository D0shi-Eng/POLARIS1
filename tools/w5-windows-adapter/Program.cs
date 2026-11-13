using System;
using System.Globalization;
using System.IO;
using System.Text;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>
    /// محوّل ويندوز لـW5. ثنائي منفصل عن محوّل W4 عمدًا.
    ///
    /// السبب معماري لا تنظيمي: W4 مغلق وأخضر، وفشل تصريف في شيفرة W5 يجب ألا
    /// يُسقط ثنائي W4 معه. المصادر مشتركة (تُصرَّف مصادر محوّل W4 داخل هذا
    /// الثنائي عدا نقطة دخوله)، والمخرجان منفصلان.
    ///
    /// الأوضاع:
    ///   panic-stop   إيقاف طوارئ على ابن محصور حيّ: إثبات حياته، ثم إغلاق
    ///                الـJob، ثم إثبات موته وعدم وجود ناجين.
    /// </summary>
    internal static class Program
    {
        internal static int Main(string[] args)
        {
            Options options = Options.Parse(args);
            string mode = options.Get("mode", "");

            JsonWriter json = new JsonWriter();
            json.BeginObject();
            json.Property("adapter", "polaris.w5.windows-adapter");
            json.Property("adapter_version", "1.0.0");
            json.Property("mode", mode);
            json.Property("ran_at", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ", CultureInfo.InvariantCulture));
            json.Property("os", Environment.OSVersion.VersionString);
            json.Property("is_64_bit_process", Environment.Is64BitProcess);

            int exitCode = 0;
            try
            {
                if (mode == "panic-stop")
                {
                    exitCode = PanicStopMode.Run(options, json);
                }
                else
                {
                    json.Property("verdict", "INCONCLUSIVE");
                    json.Property("reason_code", "UNKNOWN_MODE");
                    json.Property("interpretation", "unknown --mode; expected panic-stop");
                    exitCode = 2;
                }
            }
            catch (Exception error)
            {
                json.Property("verdict", "INCONCLUSIVE");
                json.Property("reason_code", "ADAPTER_THREW");
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
