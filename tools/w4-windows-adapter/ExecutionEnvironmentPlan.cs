using System;
using System.Collections.Generic;
using System.IO;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>متغيّر بيئة واحد، مصنَّفًا بنطاقه ومصدر قيمته وسبب وجوده.</summary>
    internal sealed class EnvironmentVariablePlan
    {
        public string Name = "";
        public string Value = "";
        /// <summary>صنف النطاق: بنية تحتية للتشغيل، أو عقد تنفيذ، أو قيمة نظام للمحمّل.</summary>
        public string Classification = "";
        /// <summary>من أين جاءت القيمة: مبنية بالكامل، أم مُعاد توجيهها، أم قيمة نظام حقيقية.</summary>
        public string ValueSource = "";
        /// <summary>حالة الإثبات بعد المعايرة. لا يدخل الإنتاج ما لم يُثبت أنه مطلوب.</summary>
        public string Requirement = ExecutionEnvironmentPlan.RequirementNotProven;
        public string Justification = "";
    }

    /// <summary>
    /// خطة بيئة التنفيذ المحصور.
    ///
    /// قاعدتان لا تُكسران:
    ///   1) لا وراثة محيطة. البيئة تُبنى اسمًا اسمًا، ولا تُدمج مع بيئة الأب.
    ///   2) لا يدخل اسمٌ قائمةَ الإنتاج إلا بإثبات تجريبي أنه مطلوب — والقائمة
    ///      أدناه فضاء بحث، لا قائمة سماح. الشائع ليس مبرّرًا.
    ///
    /// وتفصل الخطة بنية التشغيل التحتية عن موارد المهمة:
    ///   RUNTIME_TEMP_SCOPE     مجلد مؤقت للعملية المحصورة، داخل مساحة العمل.
    ///   RUNTIME_PROFILE_SCOPE  مجلد ملف تعريف مصطنع، داخل مساحة العمل.
    /// كلاهما ليس موردًا للمهمة، ولا يُخلط بـMISSION_WORK_SCOPE، ولا يشير إلى
    /// ملف تعريف المستخدم الحقيقي.
    /// </summary>
    internal sealed class ExecutionEnvironmentPlan
    {
        internal const string ScopeRuntimeTemp = "RUNTIME_TEMP_SCOPE";
        internal const string ScopeRuntimeProfile = "RUNTIME_PROFILE_SCOPE";
        internal const string ScopeExecutionContract = "EXECUTION_CONTRACT";
        internal const string ScopeExecutionIdentity = "EXECUTION_IDENTITY";
        internal const string ScopeSystemLoader = "SYSTEM_LOADER";

        internal const string SourceConstructed = "POLARIS_CONSTRUCTED";
        internal const string SourceRedirected = "POLARIS_REDIRECTED_SYSTEM_PATH";
        internal const string SourceSystemValue = "SYSTEM_VALUE_COPIED";

        internal const string RequirementNotProven = "CANDIDATE_NOT_PROVEN";
        internal const string RequirementProven = "PROVEN_REQUIRED";
        internal const string RequirementNotRequired = "PROVEN_NOT_REQUIRED";

        public string RuntimeTempDirectory = "";
        public string RuntimeProfileDirectory = "";
        public string LocalAppDataDirectory = "";
        public string RoamingAppDataDirectory = "";
        public string SystemRoot = "";
        public string SystemDrive = "";

        private readonly List<EnvironmentVariablePlan> _baseVariables = new List<EnvironmentVariablePlan>();
        private readonly List<EnvironmentVariablePlan> _candidates = new List<EnvironmentVariablePlan>();

        public IEnumerable<EnvironmentVariablePlan> BaseVariables { get { return _baseVariables; } }
        public IEnumerable<EnvironmentVariablePlan> Candidates { get { return _candidates; } }

        public static ExecutionEnvironmentPlan Create(string workspace)
        {
            ExecutionEnvironmentPlan plan = new ExecutionEnvironmentPlan();

            plan.RuntimeTempDirectory = Path.Combine(workspace, "runtime-temp");
            plan.RuntimeProfileDirectory = Path.Combine(workspace, "runtime-profile");
            plan.LocalAppDataDirectory = Path.Combine(plan.RuntimeProfileDirectory, "Local");
            plan.RoamingAppDataDirectory = Path.Combine(plan.RuntimeProfileDirectory, "Roaming");

            string systemRoot = Environment.GetEnvironmentVariable("SystemRoot");
            if (string.IsNullOrEmpty(systemRoot)) { systemRoot = "C:\\Windows"; }
            plan.SystemRoot = systemRoot;
            string systemDrive = Environment.GetEnvironmentVariable("SystemDrive");
            if (string.IsNullOrEmpty(systemDrive)) { systemDrive = "C:"; }
            plan.SystemDrive = systemDrive;

            // ── العقد: أسماء يبنيها POLARIS بنفسه ولا يقرأها من الأب ────────────
            plan.AddBase("POLARIS_EXECUTION_HOST", "1", ScopeExecutionContract, SourceConstructed,
                "the executor identifies its own launch contract by this name");
            plan.AddBase("USERNAME", "polaris-execution-host", ScopeExecutionIdentity, SourceConstructed,
                "a constructed identity; the real account name is never handed to a confined process");
            plan.AddBase("USERDOMAIN", "POLARIS", ScopeExecutionIdentity, SourceConstructed,
                "a constructed identity domain");
            plan.AddBase("LOGONSERVER", "POLARIS_UNSET", ScopeExecutionIdentity, SourceConstructed,
                "explicitly present and explicitly meaningless, so no name is left to be filled by inheritance");

            // ── بنية التشغيل التحتية: داخل مساحة العمل وحدها ────────────────────
            plan.AddBase("USERPROFILE", plan.RuntimeProfileDirectory, ScopeRuntimeProfile, SourceConstructed,
                "a synthetic profile root inside the temporary workspace, never the real user profile");
            plan.AddBase("HOMEDRIVE", Drive(plan.RuntimeProfileDirectory), ScopeRuntimeProfile, SourceConstructed,
                "derived from the synthetic profile root");
            plan.AddBase("HOMEPATH", PathPart(plan.RuntimeProfileDirectory), ScopeRuntimeProfile, SourceConstructed,
                "derived from the synthetic profile root");
            plan.AddBase("TEMP", plan.RuntimeTempDirectory, ScopeRuntimeTemp, SourceConstructed,
                "a dedicated temporary directory inside the workspace; runtime infrastructure, not a mission resource");
            plan.AddBase("TMP", plan.RuntimeTempDirectory, ScopeRuntimeTemp, SourceConstructed,
                "the same dedicated temporary directory; both spellings are set so neither falls back");

            // ── قيم النظام التي يحتاجها المحمّل، منقولة صراحةً لا موروثة ────────
            plan.AddBase("SystemRoot", systemRoot, ScopeSystemLoader, SourceSystemValue,
                "ntdll and the loader resolve system modules through it");
            plan.AddBase("windir", systemRoot, ScopeSystemLoader, SourceSystemValue,
                "the legacy spelling of the same system path");
            plan.AddBase("SystemDrive", systemDrive, ScopeSystemLoader, SourceSystemValue,
                "the system volume the loader paths are anchored on");
            plan.AddBase("PATH", systemRoot + "\\System32;" + systemRoot, ScopeSystemLoader, SourceRedirected,
                "a two-entry system search path; the user's PATH is never carried into the container");

            // ── فضاء البحث: أسماء لا تدخل الإنتاج قبل إثباتها تجريبيًا ──────────
            // الترتيب مقصود: القيمة المبنيّة تحت سيطرة POLARIS تُجرَّب أولًا. ولا
            // تُجرَّب قيمة النظام الحقيقية إلا بعد أن تفشل المبنيّة فعلًا — وهذا
            // معنى «حيثما أمكن»: تفضيل مُثبَت بالتجربة، لا شعار.
            plan.AddCandidate("LOCALAPPDATA", plan.LocalAppDataDirectory, ScopeRuntimeProfile, SourceConstructed);
            plan.AddCandidate("APPDATA", plan.RoamingAppDataDirectory, ScopeRuntimeProfile, SourceConstructed);
            plan.AddCandidate("ComSpec", systemRoot + "\\System32\\cmd.exe", ScopeSystemLoader, SourceRedirected);
            plan.AddCandidate("PATHEXT", ".COM;.EXE;.BAT;.CMD", ScopeSystemLoader, SourceConstructed);
            // ملاذ أخير، ولا يُستعمل إلا إن أثبتت التجربة أن المبنيّ لا يكفي:
            // مسارات ملف تعريف ويندوز الحقيقية. هي مسارات معروفة لا أسرار، ولا
            // تمنح بذاتها وصولًا: حدود AppContainer تبقى هي ACL وحدها.
            plan.AddCandidate("LOCALAPPDATA", SystemValue("LOCALAPPDATA"), ScopeRuntimeProfile, SourceSystemValue);
            plan.AddCandidate("APPDATA", SystemValue("APPDATA"), ScopeRuntimeProfile, SourceSystemValue);
            plan.AddCandidate("USERPROFILE", SystemValue("USERPROFILE"), ScopeRuntimeProfile, SourceSystemValue);

            return plan;
        }

        /// <summary>ينشئ مجلدات البنية التحتية. تُمنح لاحقًا بأقل حق يكفي.</summary>
        public void CreateDirectories()
        {
            Directory.CreateDirectory(RuntimeTempDirectory);
            Directory.CreateDirectory(RuntimeProfileDirectory);
            Directory.CreateDirectory(LocalAppDataDirectory);
            Directory.CreateDirectory(RoamingAppDataDirectory);
        }

        public bool RemoveDirectories()
        {
            bool clean = true;
            clean = RemoveTree(RuntimeTempDirectory) && clean;
            clean = RemoveTree(RuntimeProfileDirectory) && clean;
            return clean;
        }

        private static bool RemoveTree(string path)
        {
            try
            {
                if (path.Length > 0 && Directory.Exists(path)) { Directory.Delete(path, true); }
                return path.Length == 0 || !Directory.Exists(path);
            }
            catch (Exception)
            {
                return false;
            }
        }

        /// <summary>الخريطة الأساسية وحدها: بلا أي مرشّح، وهي نقطة انطلاق المعايرة.</summary>
        public Dictionary<string, string> BaseEnvironment()
        {
            Dictionary<string, string> environment =
                new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < _baseVariables.Count; i++)
            {
                environment[_baseVariables[i].Name] = _baseVariables[i].Value;
            }
            return environment;
        }

        public EnvironmentVariablePlan CandidateAt(int index) { return _candidates[index]; }

        public int CandidateCount { get { return _candidates.Count; } }

        public void Emit(JsonWriter json, string name, IEnumerable<EnvironmentVariablePlan> variables)
        {
            json.Name(name).BeginArray();
            foreach (EnvironmentVariablePlan variable in variables)
            {
                json.BeginObject();
                json.Property("name", variable.Name);
                json.Property("classification", variable.Classification);
                json.Property("value_source", variable.ValueSource);
                json.Property("requirement", variable.Requirement);
                json.Property("justification", variable.Justification);
                json.Property("value_sha256_prefix", EnvironmentBlock.HashValue(variable.Value));
                json.EndObject();
            }
            json.EndArray();
        }

        public void EmitScopes(JsonWriter json)
        {
            json.Name("runtime_infrastructure_scopes").BeginArray();
            EmitScope(json, ScopeRuntimeTemp, RuntimeTempDirectory,
                "TEMP and TMP for the confined process; runtime infrastructure, never a mission resource");
            EmitScope(json, ScopeRuntimeProfile, RuntimeProfileDirectory,
                "a synthetic profile root for the confined process; never the real user profile");
            json.EndArray();
        }

        private static void EmitScope(JsonWriter json, string scopeClass, string path, string note)
        {
            json.BeginObject();
            json.Property("scope_class", scopeClass);
            json.Property("path", path);
            json.Property("note", note);
            json.EndObject();
        }

        private void AddBase(string name, string value, string classification, string source, string justification)
        {
            EnvironmentVariablePlan variable = new EnvironmentVariablePlan();
            variable.Name = name;
            variable.Value = value;
            variable.Classification = classification;
            variable.ValueSource = source;
            variable.Requirement = "EXECUTION_CONTRACT_BASELINE";
            variable.Justification = justification;
            _baseVariables.Add(variable);
        }

        private void AddCandidate(string name, string value, string classification, string source)
        {
            EnvironmentVariablePlan variable = new EnvironmentVariablePlan();
            variable.Name = name;
            variable.Value = value;
            variable.Classification = classification;
            variable.ValueSource = source;
            variable.Requirement = RequirementNotProven;
            variable.Justification = "search-space candidate; enters the production environment only if calibration proves CreateProcessW needs it";
            _candidates.Add(variable);
        }

        /// <summary>قيمة نظام حقيقية، أو نص صريح يقول إنها غائبة. لا فراغ صامت.</summary>
        private static string SystemValue(string name)
        {
            string value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrEmpty(value) ? "POLARIS_UNSET" : value;
        }

        private static string Drive(string path)
        {
            return path.Length > 2 ? path.Substring(0, 2) : "POLARIS_UNSET";
        }

        private static string PathPart(string path)
        {
            return path.Length > 2 ? path.Substring(2) : path;
        }
    }
}
