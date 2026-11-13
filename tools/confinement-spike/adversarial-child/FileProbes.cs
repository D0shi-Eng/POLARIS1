using System;
using System.IO;
using Polaris.ConfinementSpike.Child.Native;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // محاولات الخروج من حصر الملفات.
    // كل محاولة تستخدم مسارًا داخل بيئة اختبار معزولة، عدا الحالات التي توثق سلوك النظام
    internal static class FileProbes
    {
        public static void Run(ProbeContext context, OutcomeRecorder recorder)
        {
            string root = context.FixtureRoot.TrimEnd('\\');
            string allowed = Path.Combine(root, "allowed");
            string denied = Path.Combine(root, "denied");
            string outside = Path.Combine(root, "outside");

            recorder.Add(FileAttempt.Read("F01", Path.Combine(allowed, "input.txt")));
            recorder.Add(FileAttempt.Write("F02", Path.Combine(allowed, "output\\result.txt"), "POLARIS_W1_WRITE_OK\n"));
            recorder.Add(FileAttempt.Read("F03", Path.Combine(denied, "secret.txt")));
            recorder.Add(FileAttempt.Write("F04", Path.Combine(outside, "escape_write.txt"), "POLARIS_W1_ESCAPE\n"));

            // تجاوز عبر مسار نسبي للأعلى انطلاقًا من المجلد المسموح
            recorder.Add(FileAttempt.Read("F05", Path.Combine(allowed, "..\\denied\\secret.txt")));

            // تجاوز عبر junction يشير إلى المجلد الممنوع
            recorder.Add(FileAttempt.Read("F06", Path.Combine(allowed, "escape_junction\\secret.txt")));

            // تجاوز عبر symlink، وقد لا يكون متاحًا بدون Developer Mode أو صلاحيات
            recorder.Add(FileAttempt.Read("F06B", Path.Combine(allowed, "escape_symlink\\secret.txt")));

            // مسار UNC عبر loopback، يوثق سلوك النظام لا أكثر
            recorder.Add(FileAttempt.Read("F07", "\\\\127.0.0.1\\C$\\Windows\\win.ini"));

            // تلاعب بحالة الأحرف
            recorder.Add(FileAttempt.Read("F08", root.ToUpperInvariant() + "\\DENIED\\SECRET.TXT"));

            // بادئة المسار الممتد التي تتخطى تطبيع Win32
            recorder.Add(FileAttempt.Read("F08B", "\\\\?\\" + Path.Combine(denied, "secret.txt")));

            // مسار الجهاز عبر مساحة أسماء NT
            recorder.Add(FileAttempt.Read("F08C", "\\\\?\\GLOBALROOT\\??\\" + Path.Combine(denied, "secret.txt")));

            // قراءة من مجلدات النظام التي تمنح ALL APPLICATION PACKAGES صلاحية قراءة افتراضية
            recorder.Add(FileAttempt.Read("F09", "C:\\Windows\\System32\\drivers\\etc\\hosts"));

            // الوصول إلى ملف تعريف المستخدم
            recorder.Add(ListEnvironmentDirectory(recorder, "F10", "USERPROFILE", ""));

            // الكتابة في المجلد المؤقت للمستخدم
            recorder.Add(WriteToTemp("F11"));

            // سرد مجلد يتعلق بالاعتمادات دون قراءة أي محتوى
            recorder.Add(ListEnvironmentDirectory(recorder, "F12", "APPDATA", "\\Microsoft\\Credentials"));

            // سرد جذر بيئة الاختبار الذي لم يُمنح أي صلاحية
            recorder.Add(FileAttempt.ListDirectory("F13", root));

            // سرد المجلد المسموح للتأكد أن المنح يعمل على مستوى السرد أيضًا
            recorder.Add(FileAttempt.ListDirectory("F14", allowed));
        }

        private static ProbeOutcome ListEnvironmentDirectory(OutcomeRecorder recorder, string id, string variable, string suffix)
        {
            string baseValue = Environment.GetEnvironmentVariable(variable);
            if (string.IsNullOrEmpty(baseValue))
            {
                return new ProbeOutcome(id, "list %" + variable + "%" + suffix, OutcomeKind.Skipped, 0,
                    "NO_ENV", "environment variable not present in child");
            }
            string target = baseValue + suffix;
            ProbeOutcome outcome = FileAttempt.ListDirectory(id, target);
            outcome.Attempt = outcome.Attempt + " (%" + variable + "%" + suffix + ")";
            return outcome;
        }

        private static ProbeOutcome WriteToTemp(string id)
        {
            string temp = Environment.GetEnvironmentVariable("TEMP");
            if (string.IsNullOrEmpty(temp))
            {
                return new ProbeOutcome(id, "write %TEMP%", OutcomeKind.Skipped, 0, "NO_ENV",
                    "TEMP not present in child environment");
            }
            ProbeOutcome outcome = FileAttempt.Write(id, temp + "\\polaris-w1-probe.txt", "POLARIS_W1_TEMP\n");
            outcome.Detail = outcome.Detail + " resolved_temp=" + temp;
            return outcome;
        }
    }
}
