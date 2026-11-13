using System;
using System.Collections;
using System.Collections.Generic;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>ما يلزم لإطلاق العملية نفسها في كل متغيّر تشخيصي.</summary>
    internal sealed class LaunchContext
    {
        public string Executable = "";
        public string HostScript = "";
        public string WorkingDirectory = "";
        public IntPtr AppContainerSid = IntPtr.Zero;
        public IntPtr JobHandle = IntPtr.Zero;
        public string[] ScopeRoots = new string[0];
    }

    /// <summary>سجل محاولة إطلاق واحدة: ماذا تغيّر، وماذا حدث.</summary>
    internal sealed class LaunchAttemptRecord
    {
        public string Name = "";
        public string Purpose = "";
        public string IsolatedVariable = "";
        public bool Created;
        public int Win32Error;
        public string Stage = "";
        public bool AssignedToJob;
        public bool ProductionPosture;
        public LaunchInputs Inputs;

        internal static void Emit(JsonWriter json, LaunchAttemptRecord record)
        {
            json.BeginObject();
            json.Property("name", record.Name);
            json.Property("purpose", record.Purpose);
            json.Property("isolated_variable", record.IsolatedVariable);
            json.Property("created", record.Created);
            json.Property("get_last_error", record.Win32Error);
            json.Property("stage", record.Stage);
            json.Property("assigned_to_job", record.AssignedToJob);
            json.Property("acceptable_as_production_posture", record.ProductionPosture);
            LaunchInputs.Emit(json, "inputs", record.Inputs);
            json.EndObject();
        }
    }

    /// <summary>نتيجة معايرة البيئة: الخريطة المُثبتة، وما أُضيف، ولماذا.</summary>
    internal sealed class EnvironmentCalibration
    {
        public bool Success;
        public string ReasonCode = "";
        public string Detail = "";
        public string CausalFactor = "";
        public int BaselineWin32Error;
        public bool BaselineCreated;
        public Dictionary<string, string> Environment =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public List<EnvironmentVariablePlan> Additions = new List<EnvironmentVariablePlan>();
        public List<LaunchAttemptRecord> Attempts = new List<LaunchAttemptRecord>();
        public List<string> AmbientOnlyNames = new List<string>();
        public List<string> DiagnosticRequiredNames = new List<string>();
    }

    /// <summary>
    /// مصفوفة تشخيص CreateProcessW ومعايرة البيئة.
    ///
    /// لماذا داخل المحوّل: رقم Win32 وحده لا يُشخِّص، وتشغيل ويندوز أصلي مكلف.
    /// المصفوفة تعزل متغيّرًا واحدًا في كل محاولة، فيخرج التشغيل الواحد بسبب
    /// مُثبَت بدل فرضية. كل محاولاتها إنشاء معلّق يليه إنهاء فوري: لا استئناف،
    /// ولا مخرجات، ولا ادّعاء أمني.
    ///
    /// حدّ لا يُتجاوز: أي متغيّر يُزيل قيدًا أمنيًا تشخيصيٌّ فقط، ولا يصلح دليلًا
    /// على نجاح W-12، ولا يصير مسار الإنتاج. المُطلِق نفسه يفرض ذلك: البيئة
    /// المحيطة مرفوضة ما لم يكن الإطلاق قياس إطلاق فقط.
    /// </summary>
    internal static class LaunchDiagnostics
    {
        internal const string VariantControlBaseline = "A_CONTROL_BASELINE";
        internal const string VariantAppContainerSameEnvironment = "B_APPCONTAINER_SAME_ENV";
        internal const string VariantAppContainerMinimalEnvironment = "C_APPCONTAINER_MINIMAL_KNOWN_WINDOWS_ENV";
        internal const string VariantAppContainerWithoutJob = "D_APPCONTAINER_WITHOUT_JOB";
        internal const string VariantAppContainerAmbientEnvironment = "E_APPCONTAINER_WITHOUT_CUSTOM_ENVIRONMENT";

        internal const string ReasonNotIsolated = "ENVIRONMENT_REQUIREMENT_NOT_ISOLATED";
        internal const string ReasonRequiresDeclaredValue = "ENVIRONMENT_REQUIRES_DECLARED_VALUE";
        internal const string ReasonNotEnvironment = "CREATE_PROCESS_FAILURE_NOT_ENVIRONMENT_CONTENT";
        internal const string CausalNotEnvironmentContent = "NOT_ENVIRONMENT_CONTENT";
        internal const string CausalMissingRequiredVariable = "MISSING_REQUIRED_ENVIRONMENT_VARIABLE";

        /// <summary>
        /// المصفوفة A..E. تُشغَّل دائمًا فيبقى في الدليل خط أساس للمقارنة، سواء
        /// نجح الإطلاق الإنتاجي أم لا.
        /// </summary>
        internal static List<LaunchAttemptRecord> RunMatrix(
            ConfinedLauncher launcher, LaunchContext context, ExecutionEnvironmentPlan plan)
        {
            List<LaunchAttemptRecord> records = new List<LaunchAttemptRecord>();
            Dictionary<string, string> baseEnvironment = plan.BaseEnvironment();

            records.Add(Attempt(launcher, context, VariantControlBaseline,
                "the staged node executable outside the AppContainer with the same constructed environment",
                "APPCONTAINER", baseEnvironment, false, false, false));

            records.Add(Attempt(launcher, context, VariantAppContainerSameEnvironment,
                "the same executable and environment inside a zero-capability AppContainer",
                "APPCONTAINER", baseEnvironment, true, true, false));

            // القيمة المفضّلة لكل اسم هي أول ظهور له: المبنيّة تحت سيطرة POLARIS.
            // هذا المتغيّر يمثّل الوضعية المقصودة، لا آخر ملاذ.
            Dictionary<string, string> minimal = plan.BaseEnvironment();
            List<string> seen = new List<string>();
            for (int i = 0; i < plan.CandidateCount; i++)
            {
                EnvironmentVariablePlan candidate = plan.CandidateAt(i);
                if (seen.Contains(candidate.Name.ToUpperInvariant())) { continue; }
                seen.Add(candidate.Name.ToUpperInvariant());
                minimal[candidate.Name] = candidate.Value;
            }
            records.Add(Attempt(launcher, context, VariantAppContainerMinimalEnvironment,
                "the same AppContainer with an explicit, documented Windows loader and runtime environment",
                "ENVIRONMENT_CONTENT", minimal, true, true, false));

            records.Add(Attempt(launcher, context, VariantAppContainerWithoutJob,
                "diagnostic only: the same AppContainer and explicit handle list without assigning the Job",
                "JOB", baseEnvironment, true, false, false));

            records.Add(Attempt(launcher, context, VariantAppContainerAmbientEnvironment,
                "diagnostic only and never a production posture: the same AppContainer with lpEnvironment = NULL",
                "CONSTRUCTED_ENVIRONMENT", baseEnvironment, true, true, true));

            return records;
        }

        /// <summary>
        /// معايرة البيئة الإنتاجية تجريبيًا.
        ///
        /// تبدأ من الخريطة الأساسية وحدها. إن أطلقت، فلا إضافة أصلًا. وإلا تُضاف
        /// المرشّحات المعلنة واحدًا واحدًا حتى ينجح الإنشاء، ثم تُقلَّص المجموعة:
        /// كل اسم يُنزع منفردًا، فإن بقي الإنشاء ناجحًا فالاسم غير مطلوب ويُطرح.
        /// الناتج مجموعة صغرى مُثبتة على هذا الجهاز، لا قائمة مُدّعاة.
        /// </summary>
        internal static EnvironmentCalibration Calibrate(
            ConfinedLauncher launcher, LaunchContext context, ExecutionEnvironmentPlan plan)
        {
            EnvironmentCalibration calibration = new EnvironmentCalibration();
            Dictionary<string, string> working = plan.BaseEnvironment();

            LaunchAttemptRecord baseline = Attempt(launcher, context, "CALIBRATION_BASE_ONLY",
                "the constructed base environment with no candidate added", "", working, true, true, false);
            calibration.Attempts.Add(baseline);
            calibration.BaselineCreated = baseline.Created;
            calibration.BaselineWin32Error = baseline.Win32Error;

            if (baseline.Created)
            {
                calibration.Success = true;
                calibration.Environment = working;
                calibration.CausalFactor = CausalNotEnvironmentContent;
                calibration.ReasonCode = "NO_ADDITION_REQUIRED";
                calibration.Detail =
                    "the base constructed environment creates the confined process on its own, so the earlier failure is not explained by a missing environment variable; see the launch inputs and the environment block self-test for the input that changed";
                return calibration;
            }

            List<EnvironmentVariablePlan> added = new List<EnvironmentVariablePlan>();
            bool created = false;
            for (int i = 0; i < plan.CandidateCount && !created; i++)
            {
                EnvironmentVariablePlan candidate = plan.CandidateAt(i);
                working[candidate.Name] = candidate.Value;
                added.Add(candidate);
                LaunchAttemptRecord attempt = Attempt(launcher, context,
                    "CALIBRATION_PLUS_" + candidate.Name,
                    "the base environment plus every candidate up to and including this one",
                    candidate.Name, working, true, true, false);
                calibration.Attempts.Add(attempt);
                created = attempt.Created;
            }

            if (created)
            {
                // اسم واحد قد يظهر مرتين في فضاء البحث بقيمتين: مبنيّة أولًا ثم
                // قيمة نظام. القيمة السارية هي الأخيرة، فيُقلَّص على الأسماء لا
                // على المحاولات، وإلا نُزع اسم مرتين وسُجّل مرتين.
                List<EnvironmentVariablePlan> distinct = Deduplicate(added);

                // التقليص: كل اسم يُنزع منفردًا. بقاء النجاح بعد نزعه يعني أنه لم
                // يكن مطلوبًا، فلا يدخل قائمة الإنتاج مهما بدا معقولًا.
                List<EnvironmentVariablePlan> proven = new List<EnvironmentVariablePlan>();
                for (int i = 0; i < distinct.Count; i++)
                {
                    EnvironmentVariablePlan candidate = distinct[i];
                    Dictionary<string, string> trial =
                        new Dictionary<string, string>(working, StringComparer.OrdinalIgnoreCase);
                    trial.Remove(candidate.Name);
                    LaunchAttemptRecord attempt = Attempt(launcher, context,
                        "CALIBRATION_MINIMISE_WITHOUT_" + candidate.Name,
                        "the calibrated environment with this single name removed",
                        candidate.Name, trial, true, true, false);
                    calibration.Attempts.Add(attempt);
                    if (attempt.Created)
                    {
                        candidate.Requirement = ExecutionEnvironmentPlan.RequirementNotRequired;
                        candidate.Justification =
                            "removal left CreateProcessW succeeding, so it is not required and is excluded from the production environment";
                        working = trial;
                    }
                    else
                    {
                        candidate.Requirement = ExecutionEnvironmentPlan.RequirementProven;
                        candidate.Justification =
                            "removing this single name reproduced the CreateProcessW failure with Win32 "
                            + attempt.Win32Error.ToString() + ", so it is required by the launch path";
                        proven.Add(candidate);
                    }
                }

                calibration.Success = true;
                calibration.Environment = working;
                calibration.Additions = proven;
                calibration.CausalFactor = CausalMissingRequiredVariable;
                calibration.ReasonCode = "MINIMAL_ADDITION_PROVEN";
                calibration.Detail =
                    "the production environment is the base contract plus the smallest set of names whose removal reproduces the launch failure";
                return calibration;
            }

            // لم تكفِ المرشّحات المعلنة. يُشخَّص الفارق مقابل بيئة الأب — تشخيصيًا
            // بحتًا: القيم المنسوخة لا تدخل الإنتاج، والتشغيل يُعلَن BLOCKED.
            calibration.Success = false;
            DiagnoseAgainstAmbient(launcher, context, plan, calibration);
            return calibration;
        }

        /// <summary>
        /// الضابط السببي: نزع الاسم المُثبت يعيد إنتاج الفشل نفسه، وإعادته تعيد
        /// النجاح. بلا هذا الزوج تبقى الإضافة مصادفة لا علّة.
        /// </summary>
        internal static void EmitCausality(
            JsonWriter json, ConfinedLauncher launcher, LaunchContext context, EnvironmentCalibration calibration)
        {
            json.Name("environment_causality").BeginObject();
            json.Property("baseline_win32_error", calibration.BaselineWin32Error);
            json.Property("causal_factor", calibration.CausalFactor);

            bool overall = true;
            json.Name("controls").BeginArray();
            for (int i = 0; i < calibration.Additions.Count; i++)
            {
                EnvironmentVariablePlan variable = calibration.Additions[i];

                Dictionary<string, string> without =
                    new Dictionary<string, string>(calibration.Environment, StringComparer.OrdinalIgnoreCase);
                without.Remove(variable.Name);
                LaunchAttemptRecord negative = Attempt(launcher, context,
                    "CONTROL_NEGATIVE_WITHOUT_" + variable.Name,
                    "the calibrated environment minus this name; the launch must fail again",
                    variable.Name, without, true, true, false);

                LaunchAttemptRecord positive = Attempt(launcher, context,
                    "CONTROL_POSITIVE_WITH_" + variable.Name,
                    "the calibrated environment restored; the launch must succeed",
                    variable.Name, calibration.Environment, true, true, false);

                bool reproduced = !negative.Created;
                bool sameError = reproduced && negative.Win32Error == calibration.BaselineWin32Error;
                bool restored = positive.Created;
                bool causal = reproduced && sameError && restored;
                if (!causal) { overall = false; }

                json.BeginObject();
                json.Property("variable", variable.Name);
                json.Property("classification", variable.Classification);
                json.Property("value_source", variable.ValueSource);
                json.Property("removal_reproduced_failure", reproduced);
                json.Property("removal_win32_error", negative.Win32Error);
                json.Property("removal_error_matches_original", sameError);
                json.Property("restoration_succeeded", restored);
                json.Property("causal", causal);
                json.Name("negative_control").BeginObject();
                json.Property("created", negative.Created);
                json.Property("get_last_error", negative.Win32Error);
                json.Property("stage", negative.Stage);
                json.EndObject();
                json.Name("positive_control").BeginObject();
                json.Property("created", positive.Created);
                json.Property("get_last_error", positive.Win32Error);
                json.Property("stage", positive.Stage);
                json.EndObject();
                json.EndObject();
            }
            json.EndArray();

            json.Property("controls_ran", calibration.Additions.Count);
            json.Property(
                "causality_proven", calibration.Additions.Count > 0 && overall);
            json.Property(
                "not_applicable_reason",
                calibration.Additions.Count == 0
                    ? "no environment name had to be added, so there is nothing whose removal could be shown to be causal"
                    : "");
            json.EndObject();
        }

        internal static void EmitAttempts(JsonWriter json, string name, List<LaunchAttemptRecord> records)
        {
            json.Name(name).BeginArray();
            for (int i = 0; i < records.Count; i++) { LaunchAttemptRecord.Emit(json, records[i]); }
            json.EndArray();
        }

        internal static void EmitCalibration(JsonWriter json, EnvironmentCalibration calibration)
        {
            json.Name("environment_calibration").BeginObject();
            json.Property("success", calibration.Success);
            json.Property("reason_code", calibration.ReasonCode);
            json.Property("detail", calibration.Detail);
            json.Property("causal_factor", calibration.CausalFactor);
            json.Property("base_only_created", calibration.BaselineCreated);
            json.Property("base_only_win32_error", calibration.BaselineWin32Error);
            json.Property("ambient_only_names", calibration.AmbientOnlyNames);
            json.Property("diagnostic_required_names", calibration.DiagnosticRequiredNames);
            List<string> additions = new List<string>();
            for (int i = 0; i < calibration.Additions.Count; i++) { additions.Add(calibration.Additions[i].Name); }
            json.Property("production_additions", additions);
            EmitAttempts(json, "attempts", calibration.Attempts);
            json.EndObject();
        }

        /// <summary>
        /// تشخيص الفارق مقابل بيئة الأب. تقليص ثنائي على الأسماء الغائبة وحدها،
        /// بقيمها من الأب — ولهذا هو تشخيص لا إنتاج: POLARIS لا ينسخ قيم المستخدم.
        /// </summary>
        private static void DiagnoseAgainstAmbient(
            ConfinedLauncher launcher, LaunchContext context,
            ExecutionEnvironmentPlan plan, EnvironmentCalibration calibration)
        {
            Dictionary<string, string> ambient =
                new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            IDictionary parent = Environment.GetEnvironmentVariables();
            foreach (DictionaryEntry entry in parent)
            {
                string name = entry.Key == null ? "" : entry.Key.ToString();
                string value = entry.Value == null ? "" : entry.Value.ToString();
                if (name.Length == 0 || name.IndexOf('=') >= 0) { continue; }
                ambient[name] = value;
            }

            Dictionary<string, string> baseEnvironment = plan.BaseEnvironment();
            List<string> ambientOnly = new List<string>();
            foreach (KeyValuePair<string, string> pair in ambient)
            {
                if (!baseEnvironment.ContainsKey(pair.Key)) { ambientOnly.Add(pair.Key); }
            }
            ambientOnly.Sort(StringComparer.OrdinalIgnoreCase);
            calibration.AmbientOnlyNames = ambientOnly;

            Dictionary<string, string> superset = plan.BaseEnvironment();
            for (int i = 0; i < ambientOnly.Count; i++) { superset[ambientOnly[i]] = ambient[ambientOnly[i]]; }
            LaunchAttemptRecord supersetAttempt = Attempt(launcher, context,
                "DIAGNOSTIC_BASE_PLUS_ALL_AMBIENT_NAMES",
                "diagnostic only: the base environment plus every name the parent has and the base lacks",
                "AMBIENT_DIFFERENCE", superset, true, true, false);
            calibration.Attempts.Add(supersetAttempt);

            if (!supersetAttempt.Created)
            {
                calibration.ReasonCode = ReasonNotEnvironment;
                calibration.CausalFactor = CausalNotEnvironmentContent;
                calibration.Detail =
                    "even a constructed environment carrying every name the parent has does not create the process, so the failure is not the absence of an environment variable; compare variants A, B and D in the matrix";
                return;
            }

            // تقليص ثنائي: نصف المجموعة في كل جولة، ما دام النجاح قائمًا.
            List<string> set = ambientOnly;
            while (set.Count > 1)
            {
                int half = set.Count / 2;
                List<string> first = set.GetRange(0, half);
                List<string> second = set.GetRange(half, set.Count - half);

                Dictionary<string, string> firstTrial = plan.BaseEnvironment();
                for (int i = 0; i < first.Count; i++) { firstTrial[first[i]] = ambient[first[i]]; }
                LaunchAttemptRecord firstAttempt = Attempt(launcher, context,
                    "DIAGNOSTIC_BISECT_" + set.Count.ToString() + "_FIRST_HALF",
                    "diagnostic only: binary reduction of the ambient-only names",
                    "AMBIENT_DIFFERENCE", firstTrial, true, true, false);
                calibration.Attempts.Add(firstAttempt);
                if (firstAttempt.Created) { set = first; continue; }

                Dictionary<string, string> secondTrial = plan.BaseEnvironment();
                for (int i = 0; i < second.Count; i++) { secondTrial[second[i]] = ambient[second[i]]; }
                LaunchAttemptRecord secondAttempt = Attempt(launcher, context,
                    "DIAGNOSTIC_BISECT_" + set.Count.ToString() + "_SECOND_HALF",
                    "diagnostic only: binary reduction of the ambient-only names",
                    "AMBIENT_DIFFERENCE", secondTrial, true, true, false);
                calibration.Attempts.Add(secondAttempt);
                if (secondAttempt.Created) { set = second; continue; }

                // لا نصف يكفي وحده: التفاعل بين اسمين أو أكثر. تُترك المجموعة كما هي.
                break;
            }

            calibration.DiagnosticRequiredNames = set;
            calibration.ReasonCode = ReasonRequiresDeclaredValue;
            calibration.CausalFactor = CausalMissingRequiredVariable;
            calibration.Detail =
                "the launch needs a name outside the declared candidate list. The name was isolated with a value copied from the parent, which is a diagnostic only: POLARIS does not copy user values into a confined process, so the run is BLOCKED until the name is declared with a POLARIS-controlled value";
        }

        /// <summary>آخر خطة لكل اسم، بترتيب أول ظهور. القيمة السارية هي الأخيرة.</summary>
        private static List<EnvironmentVariablePlan> Deduplicate(List<EnvironmentVariablePlan> variables)
        {
            List<string> order = new List<string>();
            Dictionary<string, EnvironmentVariablePlan> last =
                new Dictionary<string, EnvironmentVariablePlan>(StringComparer.OrdinalIgnoreCase);
            for (int i = 0; i < variables.Count; i++)
            {
                if (!last.ContainsKey(variables[i].Name)) { order.Add(variables[i].Name); }
                last[variables[i].Name] = variables[i];
            }
            List<EnvironmentVariablePlan> result = new List<EnvironmentVariablePlan>();
            for (int i = 0; i < order.Count; i++) { result.Add(last[order[i]]); }
            // المحاولة المتجاوَزة تُسمّى باسمها بدل أن تبقى «لم تُثبت»: قيمتها
            // جُرِّبت ولم تكفِ، وحلّت محلّها قيمة لاحقة.
            for (int i = 0; i < variables.Count; i++)
            {
                if (!result.Contains(variables[i]))
                {
                    variables[i].Requirement = "SUPERSEDED_BY_A_LATER_VALUE_FOR_THE_SAME_NAME";
                }
            }
            return result;
        }

        private static LaunchAttemptRecord Attempt(
            ConfinedLauncher launcher, LaunchContext context, string name, string purpose,
            string isolated, Dictionary<string, string> environment,
            bool appContainer, bool job, bool ambientEnvironment)
        {
            LaunchSpec spec = new LaunchSpec();
            spec.ExecutablePath = context.Executable;
            spec.CommandLine = ConfinedLauncher.BuildCommandLine(
                context.Executable, new string[] { context.HostScript });
            spec.WorkingDirectory = context.WorkingDirectory;
            spec.Environment = environment;
            spec.Inheritance = InheritanceMode.ExplicitHandleList;
            spec.UseExplicitApplicationName = true;
            spec.RequiredFiles = new string[] { context.Executable, context.HostScript };
            spec.AppContainerSid = appContainer ? context.AppContainerSid : IntPtr.Zero;
            spec.JobHandle = job ? context.JobHandle : IntPtr.Zero;
            spec.ScopeRoots = context.ScopeRoots;
            spec.ScanHandlesBeforeResume = false;
            spec.ScanHandlesAfterResume = false;
            spec.EnforceHandleScope = false;
            spec.CreateOnly = true;
            spec.UseAmbientEnvironment = ambientEnvironment;

            LaunchOutcome outcome = launcher.Launch(spec);

            LaunchAttemptRecord record = new LaunchAttemptRecord();
            record.Name = name;
            record.Purpose = purpose;
            record.IsolatedVariable = isolated;
            record.Created = outcome.Created;
            record.Win32Error = outcome.Win32Error;
            record.Stage = outcome.FailureStage;
            record.AssignedToJob = outcome.AssignedToJob;
            // لا متغيّر تشخيصي يصلح وضعية إنتاج، ولو أنشأ العملية.
            record.ProductionPosture = false;
            record.Inputs = outcome.Inputs;
            return record;
        }
    }
}
