using System;
using System.Collections.Generic;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// يبني منحة تنفيذ حقيقية بنفس شكل ما تُصدره نقطة الفرض في وقت التشغيل.
    /// المحوّل لا يخترع بروتوكولًا: هو يتكلم البروتوكول نفسه الذي يفهمه المنفّذ.
    /// </summary>
    internal static class GrantBuilder
    {
        internal static Dictionary<string, string> ExecutionEnvironment(string temporaryDirectory)
        {
            // نفس عقد البيئة الذي يبنيه مُطلِق العقدة: قائمة سماح صريحة تغطي كل
            // اسم قد يُنسخ من الأب، فلا يبقى اسم غائب يُملأ بالوراثة.
            Dictionary<string, string> environment = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            environment["POLARIS_EXECUTION_HOST"] = "1";
            environment["USERNAME"] = "polaris-execution-host";
            environment["USERDOMAIN"] = "POLARIS";
            environment["LOGONSERVER"] = "POLARIS_UNSET";
            environment["USERPROFILE"] = temporaryDirectory;
            environment["TEMP"] = temporaryDirectory;
            environment["TMP"] = temporaryDirectory;
            environment["HOMEDRIVE"] = temporaryDirectory.Length > 2 ? temporaryDirectory.Substring(0, 2) : "POLARIS_UNSET";
            environment["HOMEPATH"] = temporaryDirectory.Length > 2 ? temporaryDirectory.Substring(2) : temporaryDirectory;

            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
            if (string.IsNullOrEmpty(systemRoot)) { systemRoot = @"C:\Windows"; }
            // مطلوبة للمحمّل و ntdll. نقل صريح لقيمة نظام، لا وراثة ضمنية.
            environment["SystemRoot"] = systemRoot;
            environment["windir"] = systemRoot;
            string systemDrive = Environment.GetEnvironmentVariable("SystemDrive");
            environment["SystemDrive"] = string.IsNullOrEmpty(systemDrive) ? "C:" : systemDrive;
            environment["PATH"] = systemRoot + @"\System32;" + systemRoot;
            return environment;
        }

        /// <summary>
        /// منحة قراءة. تحمل هوية كائن الهدف كما رصدها المُطلِق على مقبض فتحه هو،
        /// لأن المنفّذ لا يعيد حلّ اسم المسار: يفتح مرة واحدة ويطابق الهوية على
        /// مقبضه (SAME_OBJECT_VERIFY_AND_USE). هوية غير متاحة تُحذف من الحمولة
        /// عمدًا: المنفّذ يفشل حينها مغلقًا برمز صريح بدل أن يقرأ على الثقة.
        /// </summary>
        internal static string ReadGrant(string hostPath, string logicalPath, string[] allowedRoots, Dictionary<string, string> environment, TargetObjectIdentity identity)
        {
            JsonWriter json = new JsonWriter();
            json.BeginObject();
            json.Property("grant_id", Guid.NewGuid().ToString());
            json.Property("correlation_id", Guid.NewGuid().ToString());
            json.Property("invocation_id", Guid.NewGuid().ToString());
            json.Property("decision_id", Guid.NewGuid().ToString());
            json.Property("operation", "READ_FILE");
            json.Name("target").BeginObject();
            json.Property("logical", logicalPath);
            json.Property("host", hostPath);
            json.Property("mode", "READ");
            if (identity != null && identity.Available)
            {
                json.Name("identity").BeginObject();
                json.Property("volume", identity.Volume);
                json.Property("file", identity.FileId);
                json.EndObject();
            }
            json.EndObject();
            json.Property("allowed_host_roots", allowedRoots);
            json.Property("max_bytes", 262144);
            json.Property("deadline_ms", 15000);
            json.Property("encoding", "utf-8");
            json.Property("allow_overwrite", false);
            json.Name("environment_contract").BeginObject();
            List<string> names = new List<string>(environment.Keys);
            names.Sort(StringComparer.OrdinalIgnoreCase);
            foreach (string name in names) { json.Property(name, environment[name]); }
            json.EndObject();
            json.EndObject();
            return json.ToString();
        }
    }
}
