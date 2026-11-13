using System;
using System.Collections.Generic;
using System.Globalization;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>محاولة إطلاق واحدة في المعايرة: ماذا تغيّر، وماذا أعادت النواة.</summary>
    internal sealed class EnvironmentAttempt
    {
        public string Name = "";
        public string Purpose = "";
        public string IsolatedVariable = "";
        public bool Created;
        public int Win32Error;
        public string Stage = "";
        public int EntryCount;
        public List<string> Names = new List<string>();

        public void Emit(JsonWriter json)
        {
            json.BeginObject();
            json.Property("name", Name);
            json.Property("purpose", Purpose);
            json.Property("isolated_variable", IsolatedVariable);
            json.Property("created", Created);
            json.Property("get_last_error", Win32Error);
            json.Property("stage", Stage);
            json.Property("environment_entry_count", EntryCount);
            json.Property("environment_names", Names);
            json.Property("acceptable_as_production_posture", false);
            json.EndObject();
        }
    }

    /// <summary>ضابط سببي لاسم واحد: نزعه يعيد الفشل، وإعادته تعيد النجاح.</summary>
    internal sealed class EnvironmentCausalityControl
    {
        public string Variable = "";
        public string Classification = "";
        public string ValueSource = "";
        public bool RemovalReproducedFailure;
        public int RemovalWin32Error;
        public bool RemovalErrorMatchesBaseline;
        public bool RestorationSucceeded;
        public bool Causal;

        public void Emit(JsonWriter json)
        {
            json.BeginObject();
            json.Property("variable", Variable);
            json.Property("classification", Classification);
            json.Property("value_source", ValueSource);
            json.Property("removal_reproduced_failure", RemovalReproducedFailure);
            json.Property("removal_win32_error", RemovalWin32Error);
            json.Property("removal_error_matches_baseline", RemovalErrorMatchesBaseline);
            json.Property("restoration_succeeded", RestorationSucceeded);
            json.Property("causal", Causal);
            json.EndObject();
        }
    }

    /// <summary>نتيجة معايرة بيئة الإطلاق لـW5-P01.</summary>
    internal sealed class PanicStopEnvironmentResult
    {
        public bool Success;
        public string ReasonCode = "";
        public string Detail = "";
        public string CausalFactor = "";
        public bool BaselineCreated;
        public int BaselineWin32Error;
        public Dictionary<string, string> Environment =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public List<EnvironmentVariablePlan> Additions = new List<EnvironmentVariablePlan>();
        public List<EnvironmentAttempt> Attempts = new List<EnvironmentAttempt>();
        public List<EnvironmentCausalityControl> Controls = new List<EnvironmentCausalityControl>();

        public List<string> ProductionNames()
        {
            List<string> names = new List<string>(Environment.Keys);
            names.Sort(StringComparer.OrdinalIgnoreCase);
            return names;
        }

        public void Emit(JsonWriter json, string property)
        {
            json.Name(property).BeginObject();
            json.Property("success", Success);
            json.Property("reason_code", ReasonCode);
            json.Property("detail", Detail);
            json.Property("causal_factor", CausalFactor);
            json.Property("base_only_created", BaselineCreated);
            json.Property("base_only_win32_error", BaselineWin32Error);
            json.Property("production_environment_names", ProductionNames());
            json.Property("production_environment_inherits_parent", false);
            json.Name("production_additions").BeginArray();
            for (int i = 0; i < Additions.Count; i++)
            {
                EnvironmentVariablePlan addition = Additions[i];
                json.BeginObject();
                json.Property("name", addition.Name);
                json.Property("classification", addition.Classification);
                json.Property("value_source", addition.ValueSource);
                json.Property("requirement", addition.Requirement);
                json.Property("justification", addition.Justification);
                json.Property("value_sha256_prefix", EnvironmentBlock.HashValue(addition.Value));
                json.EndObject();
            }
            json.EndArray();
            json.Name("attempts").BeginArray();
            for (int i = 0; i < Attempts.Count; i++) { Attempts[i].Emit(json); }
            json.EndArray();
            json.Name("causality_controls").BeginArray();
            for (int i = 0; i < Controls.Count; i++) { Controls[i].Emit(json); }
            json.EndArray();
            bool proven = Controls.Count == 0 ? BaselineCreated : true;
            for (int i = 0; i < Controls.Count; i++)
            {
                if (!Controls[i].Causal) { proven = false; }
            }
            json.Property("causality_proven", proven);
            json.EndObject();
        }
    }

    /// <summary>
    /// معايرة بيئة إطلاق W5-P01 تجريبيًا، على شكل الإطلاق الإنتاجي نفسه.
    ///
    /// ── العيب الذي أغلقته هذه الوحدة ─────────────────────────────────────────
    /// كان W5-P01 يمرّر الخريطة الأساسية وحدها إلى CreateProcessW. وW4 كان قد
    /// قاس — على المضيف نفسه وفي التشغيل نفسه — أن الخريطة الأساسية وحدها لا
    /// تُنشئ العملية، وأن الفشل هو Win32 203، وأن نزع اسم واحد بعينه يعيد إنتاج
    /// الفشل نفسه وإعادته تعيد النجاح. أي أن مسار إنتاج W5 كان هو ضابط W4
    /// السالب المُثبَت. النتيجة كانت CreateProcessW فاشلة، وابنًا لم يوجد قط،
    /// وحُكمًا يقول «لم يُلاحَظ حيًّا» — وهو عَرَضٌ ثلاث مراحل بعد العلّة.
    ///
    /// ── لماذا تُعاد المعايرة هنا ولا تُنسخ نتيجة W4 ──────────────────────────
    /// قائمة أسماء منسوخة من دليل قديم ادّعاءٌ لا قياس: تصير كاذبة بتغيّر مضيف
    /// أو إصدار مفسّر. وهذه المعايرة تُثبت الحاجة على هذا الجهاز في هذا التشغيل،
    /// بضابطين لكل اسم، وتكتب الإثبات في الدليل الخام.
    ///
    /// ── حدودها ───────────────────────────────────────────────────────────────
    /// كل محاولاتها إنشاء معلّق يليه إنهاء فوري: لا استئناف، ولا مخرجات، ولا
    /// فحص مقابض، ولا ادّعاء أمني. وتجري في Job منفصل عن Job القياس، فلا يدخل
    /// جدولَ القياس معرّفٌ ليس ابنَه.
    /// </summary>
    internal static class PanicStopEnvironmentCalibration
    {
        internal const string ReasonNoAddition = "NO_ADDITION_REQUIRED";
        internal const string ReasonMinimalAddition = "MINIMAL_ADDITION_PROVEN";
        internal const string ReasonExhausted = "ENVIRONMENT_CALIBRATION_EXHAUSTED";
        internal const string CausalMissingVariable = "MISSING_REQUIRED_ENVIRONMENT_VARIABLE";
        internal const string CausalNotEnvironment = "NOT_ENVIRONMENT_CONTENT";

        public static PanicStopEnvironmentResult Calibrate(
            ConfinedLauncher launcher,
            PanicStopLaunchTemplate template,
            ExecutionEnvironmentPlan plan,
            IntPtr calibrationJob)
        {
            PanicStopEnvironmentResult result = new PanicStopEnvironmentResult();
            Dictionary<string, string> working = plan.BaseEnvironment();

            EnvironmentAttempt baseline = Attempt(launcher, template, calibrationJob,
                "CALIBRATION_BASE_ONLY", "the constructed base contract with no candidate added", "", working);
            result.Attempts.Add(baseline);
            result.BaselineCreated = baseline.Created;
            result.BaselineWin32Error = baseline.Win32Error;

            if (baseline.Created)
            {
                result.Success = true;
                result.Environment = working;
                result.CausalFactor = CausalNotEnvironment;
                result.ReasonCode = ReasonNoAddition;
                result.Detail = "the base contract creates the confined child on its own on this host";
                return result;
            }

            List<EnvironmentVariablePlan> added = new List<EnvironmentVariablePlan>();
            bool created = false;
            for (int i = 0; i < plan.CandidateCount && !created; i++)
            {
                EnvironmentVariablePlan candidate = plan.CandidateAt(i);
                working[candidate.Name] = candidate.Value;
                added.Add(candidate);
                EnvironmentAttempt attempt = Attempt(launcher, template, calibrationJob,
                    "CALIBRATION_PLUS_" + candidate.Name,
                    "the base contract plus every candidate up to and including this one",
                    candidate.Name, working);
                result.Attempts.Add(attempt);
                created = attempt.Created;
            }

            if (!created)
            {
                result.Success = false;
                result.Environment = working;
                result.CausalFactor = CausalNotEnvironment;
                result.ReasonCode = ReasonExhausted;
                result.Detail =
                    "the declared candidate space did not make CreateProcessW succeed; the launch failure is not"
                    + " explained by a missing declared environment name, and no ambient value is copied to hide it";
                return result;
            }

            // التقليص على الأسماء لا على المحاولات: اسم يظهر مرتين بقيمتين لا
            // يُنزع مرتين ولا يُسجَّل مرتين.
            List<EnvironmentVariablePlan> distinct = Deduplicate(added);
            List<EnvironmentVariablePlan> proven = new List<EnvironmentVariablePlan>();
            for (int i = 0; i < distinct.Count; i++)
            {
                EnvironmentVariablePlan candidate = distinct[i];
                Dictionary<string, string> trial =
                    new Dictionary<string, string>(working, StringComparer.OrdinalIgnoreCase);
                trial.Remove(candidate.Name);
                EnvironmentAttempt attempt = Attempt(launcher, template, calibrationJob,
                    "CALIBRATION_MINIMISE_WITHOUT_" + candidate.Name,
                    "the calibrated environment with this single name removed",
                    candidate.Name, trial);
                result.Attempts.Add(attempt);
                if (attempt.Created)
                {
                    candidate.Requirement = ExecutionEnvironmentPlan.RequirementNotRequired;
                    candidate.Justification =
                        "removal left CreateProcessW succeeding, so it is not required and stays out of production";
                    working = trial;
                }
                else
                {
                    candidate.Requirement = ExecutionEnvironmentPlan.RequirementProven;
                    candidate.Justification =
                        "removing this single name reproduced the CreateProcessW failure with Win32 "
                        + attempt.Win32Error.ToString(CultureInfo.InvariantCulture)
                        + ", so it is required by this launch path";
                    proven.Add(candidate);

                    EnvironmentCausalityControl control = new EnvironmentCausalityControl();
                    control.Variable = candidate.Name;
                    control.Classification = candidate.Classification;
                    control.ValueSource = candidate.ValueSource;
                    control.RemovalReproducedFailure = true;
                    control.RemovalWin32Error = attempt.Win32Error;
                    control.RemovalErrorMatchesBaseline = attempt.Win32Error == result.BaselineWin32Error;

                    EnvironmentAttempt restored = Attempt(launcher, template, calibrationJob,
                        "CALIBRATION_RESTORE_" + candidate.Name,
                        "the same environment with this single name put back",
                        candidate.Name, working);
                    result.Attempts.Add(restored);
                    control.RestorationSucceeded = restored.Created;
                    control.Causal = control.RemovalReproducedFailure && control.RestorationSucceeded;
                    result.Controls.Add(control);
                }
            }

            result.Success = true;
            result.Environment = working;
            result.Additions = proven;
            result.CausalFactor = CausalMissingVariable;
            result.ReasonCode = ReasonMinimalAddition;
            result.Detail =
                "the production environment is the base contract plus the smallest set of names whose removal"
                + " reproduces the launch failure and whose restoration removes it";
            return result;
        }

        private static List<EnvironmentVariablePlan> Deduplicate(List<EnvironmentVariablePlan> variables)
        {
            List<EnvironmentVariablePlan> distinct = new List<EnvironmentVariablePlan>();
            for (int i = variables.Count - 1; i >= 0; i--)
            {
                bool seen = false;
                for (int j = 0; j < distinct.Count; j++)
                {
                    if (string.Equals(distinct[j].Name, variables[i].Name, StringComparison.OrdinalIgnoreCase))
                    {
                        seen = true;
                    }
                }
                if (!seen) { distinct.Add(variables[i]); }
            }
            return distinct;
        }

        private static EnvironmentAttempt Attempt(
            ConfinedLauncher launcher,
            PanicStopLaunchTemplate template,
            IntPtr calibrationJob,
            string name,
            string purpose,
            string isolated,
            Dictionary<string, string> environment)
        {
            LaunchSpec spec = template.Build(
                new Dictionary<string, string>(environment, StringComparer.OrdinalIgnoreCase),
                calibrationJob, true, null, 5000);
            LaunchOutcome outcome = launcher.Launch(spec);

            EnvironmentAttempt attempt = new EnvironmentAttempt();
            attempt.Name = name;
            attempt.Purpose = purpose;
            attempt.IsolatedVariable = isolated;
            attempt.Created = outcome.Created;
            attempt.Win32Error = outcome.Win32Error;
            attempt.Stage = outcome.FailureStage;
            if (outcome.Inputs != null)
            {
                attempt.EntryCount = outcome.Inputs.EnvironmentEntryCount;
                attempt.Names = new List<string>(outcome.Inputs.EnvironmentNames);
            }
            return attempt;
        }
    }
}
