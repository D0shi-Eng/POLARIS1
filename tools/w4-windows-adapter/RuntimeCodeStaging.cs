using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// تدريج «نطاق كود التشغيل» داخل مساحة العمل المؤقتة وحدها.
    ///
    /// لماذا هذا موجود أصلًا:
    /// عملية داخل AppContainer لا تقرأ إلا ما مُنح لمعرّف أمانها. منفّذ W4 هو
    /// node.exe، وهو يقيم عادةً تحت "C:\Program Files\nodejs" — ومنح ACL هناك
    /// يحتاج صلاحيات مدير، وهو ما لا يجوز أن تتطلبه بوابة مطابقة. ومنح ACL على
    /// شجرة المستودع نفسها يترك أثرًا قابلًا للبقاء إن انهار التشغيل.
    ///
    /// لذلك يُنسخ كود التشغيل — بايتًا ببايت — إلى مجلد داخل مساحة العمل المؤقتة،
    /// ويُمنح المعرّف قراءةً وتنفيذًا هناك فقط. لا يُعدَّل ACL واحد خارج مساحة
    /// العمل، ولا يُطلب تصعيد صلاحيات، والهدم كامل بحكم زوال المجلد.
    ///
    /// وهذا يفرض التمييز الذي تشترطه W4:
    ///   RUNTIME_CODE_SCOPE      كود قابل للقراءة والتنفيذ، ليس موردًا للمهمة.
    ///   MISSION_RESOURCE_SCOPE  ما يجوز للأداة أن تعامله موردًا.
    /// المجلدان منفصلان فيزيائيًا، فلا يمكن لأداة مهمة أن تنزلق إلى كود التشغيل.
    ///
    /// ما يُدرَّج هو إغلاق رسم الاستيراد وحده — لا شجرة البناء كاملة. نسخُ ما لا
    /// يحمّله المنفّذ يوسّع النطاق المحصور بلا سبب، ونسخُ نقطة الدخول وحدها يترك
    /// وحدةً ناقصة تظهر عند الإقلاع لا قبله. فالقاعدة: كل ملف يصله المنفّذ، ولا
    /// ملف سواه.
    ///
    /// الهوية تُثبَت لا تُدَّعى: يُسجَّل SHA-256 للمصدر وللنسخة لكل ملف مُدرَّج،
    /// ويُتحقَّق أن الشجرة المُدرَّجة لا تحوي ملفًا واحدًا غير متوقَّع.
    /// </summary>
    internal sealed class RuntimeCodeStaging
    {
        internal const string ReasonNotStaged = "RUNTIME_CODE_NOT_STAGED";
        internal const string ReasonUnexpectedFile = "RUNTIME_CODE_STAGING_UNEXPECTED_FILE";
        internal const string ReasonNotIdentical = "RUNTIME_CODE_STAGING_NOT_BYTE_IDENTICAL";

        internal sealed class FileIdentity
        {
            public string Role = "";
            public string Source = "";
            public string Staged = "";
            public string SourceSha256 = "";
            public string StagedSha256 = "";
            public bool Identical;
        }

        internal sealed class GeneratedArtifact
        {
            public string Role = "";
            public string Staged = "";
            public string Sha256 = "";
            public string Justification = "";
        }

        private readonly List<FileIdentity> _identities = new List<FileIdentity>();
        private readonly List<GeneratedArtifact> _generated = new List<GeneratedArtifact>();
        private readonly RuntimeModuleGraph _graph = new RuntimeModuleGraph();

        public string Root = "";
        public string NodePath = "";
        public string HostScriptPath = "";
        public string ApplicationRoot = "";
        public string PackageManifestPath = "";
        public string FailureStage = "";
        public string FailureReasonCode = "";
        public string FailureDetail = "";
        public int FileCount;

        public IEnumerable<FileIdentity> Identities { get { return _identities; } }
        public RuntimeModuleGraph Graph { get { return _graph; } }

        /// <summary>
        /// ينسخ node.exe وإغلاق رسم استيراد المنفّذ إلى مساحة العمل. يعيد false مع
        /// مرحلة وسبب مصنَّفين عند أي إخفاق — ولا يمضي بنسخة ناقصة ولا زائدة.
        /// </summary>
        public bool Stage(string workspace, string sourceNode, string sourceHostScript, string sourceDistRoot)
        {
            try
            {
                if (!File.Exists(sourceNode))
                {
                    return Fail(RuntimeModuleGraph.ReasonIncomplete,
                        "the Node executable was not found at " + sourceNode);
                }
                if (!File.Exists(sourceHostScript))
                {
                    return Fail(RuntimeModuleGraph.ReasonIncomplete,
                        "the W4 execution host script was not found at " + sourceHostScript);
                }
                if (string.IsNullOrEmpty(sourceDistRoot) || !Directory.Exists(sourceDistRoot))
                {
                    return Fail(RuntimeModuleGraph.ReasonIncomplete,
                        "the runtime dist tree was not found at " + (sourceDistRoot == null ? "" : sourceDistRoot));
                }

                // 1) إغلاق الرسم قبل نسخ حرف واحد: ما لا يُثبت وجوده لا يُدرَّج.
                if (!_graph.Resolve(sourceDistRoot, sourceHostScript))
                {
                    return Fail(_graph.FailureReasonCode, _graph.FailureDetail);
                }

                Root = Path.Combine(workspace, "runtime-code");
                ApplicationRoot = Path.Combine(Root, "app");
                Directory.CreateDirectory(ApplicationRoot);

                // 2) المنفّذ نفسه: ملف واحد مكتفٍ بذاته على ويندوز.
                NodePath = Path.Combine(Root, Path.GetFileName(sourceNode));
                File.Copy(sourceNode, NodePath, true);
                Record("NODE_RUNTIME", sourceNode, NodePath);

                // 3) وحدات الرسم، كلٌّ في موضعه النسبي نفسه داخل شجرة البناء.
                string distRoot = Path.GetFullPath(sourceDistRoot).TrimEnd('\\');
                List<string> expected = new List<string>();
                expected.Add(Canonical(NodePath));
                for (int i = 0; i < _graph.Modules.Count; i++)
                {
                    string module = _graph.Modules[i];
                    string relative = MakeRelative(distRoot, module);
                    string staged = Path.Combine(ApplicationRoot, relative);
                    string directory = Path.GetDirectoryName(staged);
                    if (!string.IsNullOrEmpty(directory)) { Directory.CreateDirectory(directory); }
                    File.Copy(module, staged, true);
                    FileCount++;
                    expected.Add(Canonical(staged));
                    if (i == 0)
                    {
                        HostScriptPath = staged;
                        Record("EXECUTION_HOST", module, staged);
                    }
                    else
                    {
                        Record("RUNTIME_MODULE", module, staged);
                    }
                }

                if (HostScriptPath.Length == 0 || !File.Exists(HostScriptPath))
                {
                    return Fail(RuntimeModuleGraph.ReasonIncomplete,
                        "the staged host script is missing at " + HostScriptPath);
                }

                // 4) نوع الوحدات يُثبَّت هنا حتى يتوقف بحث Node عن package.json
                //    داخل النطاق الممنوح، ولا يحتاج قراءة أي شيء فوقه.
                PackageManifestPath = Path.Combine(ApplicationRoot, "package.json");
                File.WriteAllText(PackageManifestPath, "{\"type\":\"module\"}\n", new UTF8Encoding(false));
                expected.Add(Canonical(PackageManifestPath));
                GeneratedArtifact manifest = new GeneratedArtifact();
                manifest.Role = "STAGED_PACKAGE_MANIFEST";
                manifest.Staged = PackageManifestPath;
                manifest.Sha256 = Sha256(PackageManifestPath);
                manifest.Justification =
                    "generated, not copied: it fixes the module type at the root of the granted scope so Node's"
                    + " package-scope search terminates inside runtime-code and never reads a directory above it";
                _generated.Add(manifest);

                // 5) الهوية مُثبَتة لكل ملف مُدرَّج، لا لملفين مختارين.
                for (int i = 0; i < _identities.Count; i++)
                {
                    if (!_identities[i].Identical)
                    {
                        return Fail(ReasonNotIdentical,
                            "the staged copy of " + _identities[i].Source + " is not byte-identical to its source");
                    }
                }

                // 6) والنطاق ليس أوسع من الرسم: أي ملف مُدرَّج غير متوقَّع عيب تدريج.
                List<string> unexpected = Unexpected(Root, expected);
                if (unexpected.Count > 0)
                {
                    return Fail(ReasonUnexpectedFile,
                        "the staged runtime-code scope contains "
                        + unexpected.Count.ToString(CultureInfo.InvariantCulture)
                        + " file(s) that are not part of the executor's import graph, starting with "
                        + unexpected[0]);
                }
                return true;
            }
            catch (Exception error)
            {
                return Fail(RuntimeModuleGraph.ReasonIncomplete,
                    error.GetType().Name + ": " + error.Message);
            }
        }

        /// <summary>
        /// هدم نطاق كود التشغيل. النتيجة تُعاد ولا تُبتلع: بقاء نسخة من المنفّذ
        /// ومن وحداته في مساحة عمل مؤقتة أثرٌ يجب أن يظهر في الحكم لا أن يُهمل.
        /// </summary>
        public bool Remove()
        {
            try
            {
                if (Root.Length > 0 && Directory.Exists(Root)) { Directory.Delete(Root, true); }
                return Root.Length == 0 || !Directory.Exists(Root);
            }
            catch (Exception)
            {
                return false;
            }
        }

        private bool Fail(string reasonCode, string detail)
        {
            FailureStage = "RUNTIME_CODE_STAGING";
            FailureReasonCode = reasonCode.Length > 0 ? reasonCode : RuntimeModuleGraph.ReasonIncomplete;
            FailureDetail = detail;
            return false;
        }

        private static List<string> Unexpected(string root, List<string> expected)
        {
            List<string> found = new List<string>();
            Dictionary<string, bool> allowed = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < expected.Count; i++) { allowed[expected[i]] = true; }
            Walk(root, found, allowed);
            return found;
        }

        private static void Walk(string directory, List<string> found, Dictionary<string, bool> allowed)
        {
            foreach (string file in Directory.GetFiles(directory))
            {
                if (!allowed.ContainsKey(Canonical(file))) { found.Add(file); }
            }
            foreach (string child in Directory.GetDirectories(directory))
            {
                Walk(child, found, allowed);
            }
        }

        private static string Canonical(string path)
        {
            try { return Path.GetFullPath(path); }
            catch (Exception) { return path; }
        }

        private void Record(string role, string source, string staged)
        {
            FileIdentity identity = new FileIdentity();
            identity.Role = role;
            identity.Source = source;
            identity.Staged = staged;
            identity.SourceSha256 = Sha256(source);
            identity.StagedSha256 = Sha256(staged);
            identity.Identical = identity.SourceSha256.Length > 0
                && string.Equals(identity.SourceSha256, identity.StagedSha256, StringComparison.Ordinal);
            _identities.Add(identity);
        }

        private static string Sha256(string path)
        {
            try
            {
                using (SHA256 algorithm = SHA256.Create())
                using (FileStream stream = File.OpenRead(path))
                {
                    return BitConverter.ToString(algorithm.ComputeHash(stream)).Replace("-", "");
                }
            }
            catch (Exception) { return ""; }
        }

        private static string MakeRelative(string root, string path)
        {
            string baseRoot = Path.GetFullPath(root).TrimEnd('\\');
            string full = Path.GetFullPath(path);
            if (full.StartsWith(baseRoot + "\\", StringComparison.OrdinalIgnoreCase))
            {
                return full.Substring(baseRoot.Length + 1);
            }
            return Path.GetFileName(path);
        }

        internal void Emit(JsonWriter json)
        {
            json.Property("runtime_code_scope", Root);
            json.Property("runtime_code_files_copied", FileCount);
            json.Property("runtime_code_staging_reason_code", FailureReasonCode);
            json.Name("runtime_code_identity").BeginArray();
            for (int i = 0; i < _identities.Count; i++)
            {
                FileIdentity identity = _identities[i];
                json.BeginObject();
                json.Property("role", identity.Role);
                json.Property("source", identity.Source);
                json.Property("staged", identity.Staged);
                json.Property("source_sha256", identity.SourceSha256);
                json.Property("staged_sha256", identity.StagedSha256);
                json.Property("byte_identical", identity.Identical);
                json.EndObject();
            }
            json.EndArray();
            json.Name("runtime_code_generated").BeginArray();
            for (int i = 0; i < _generated.Count; i++)
            {
                GeneratedArtifact artifact = _generated[i];
                json.BeginObject();
                json.Property("role", artifact.Role);
                json.Property("staged", artifact.Staged);
                json.Property("sha256", artifact.Sha256);
                json.Property("justification", artifact.Justification);
                json.EndObject();
            }
            json.EndArray();
            _graph.Emit(json);
        }
    }
}
