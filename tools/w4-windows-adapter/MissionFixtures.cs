using System;
using System.IO;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// شجرة عيّنات المهمة، مبنية بحيث يكون كل صنف نطاق مجلدًا منفصلًا.
    ///
    /// العيب الذي تغلقه هذه البنية: كانت الشجرة تُمنح من جذرها بوراثة، فيرث
    /// «المورد الممنوع» نفس المنح. عندئذ يصير رفض القراءة رفضًا من نقطة الفرض
    /// وحدها، بينما حدّ ويندوز الأمني كان قد منح الوصول فعلًا. ذلك لا يثبت حصر
    /// نظام الملفات، بل يثبت أن الـPEP يعمل — وهما ادّعاءان مختلفان.
    ///
    /// لذلك:
    ///   mission\            جذر تحكّم: اجتياز فقط، بلا وراثة.
    ///   mission\scope\      المورد المسموح: يُمنح.
    ///   mission\outside\    المورد الممنوع: لا يُمنح، ولا يرث شيئًا.
    ///   mission\control\    ضابط موجب: نفس شكل الممنوع تمامًا، لكنه يُمنح صراحةً.
    ///   mission\work\       مساحة عمل العملية (مجلد العمل وTEMP): تُمنح.
    ///
    /// وجود mission\control هو ما يمنع «رُفض لأن العيّنة مكسورة» من أن يُحسب نجاحًا:
    /// ملفان متطابقان في الشكل والعمق والمحتوى، والفارق الوحيد بينهما هو المنح.
    /// </summary>
    internal sealed class MissionFixtures
    {
        internal const string ScopeControlRoot = "MISSION_CONTROL_ROOT";
        internal const string ScopeAllowedResource = "MISSION_ALLOWED_RESOURCE_SCOPE";
        internal const string ScopeDeniedControlResource = "MISSION_DENIED_CONTROL_RESOURCE";
        internal const string ScopePositiveControlResource = "MISSION_CONTROL_POSITIVE_FIXTURE";
        internal const string ScopeWork = "MISSION_WORK_SCOPE";
        internal const string ScopeRuntimeCode = "RUNTIME_CODE_SCOPE";
        internal const string ScopeControlCode = "CONTROL_CODE_SCOPE";

        private const string FixtureBody = "POLARIS W4 confinement fixture body, identical across scope classes";

        public string Root = "";
        public string AllowedDirectory = "";
        public string DeniedDirectory = "";
        public string PositiveControlDirectory = "";
        public string WorkDirectory = "";
        public string AllowedFile = "";
        public string DeniedFile = "";
        public string PositiveControlFile = "";

        public void Create(string workspace)
        {
            Root = Path.Combine(workspace, "mission");
            AllowedDirectory = Path.Combine(Root, "scope");
            DeniedDirectory = Path.Combine(Root, "outside");
            PositiveControlDirectory = Path.Combine(Root, "control");
            WorkDirectory = Path.Combine(Root, "work");

            Directory.CreateDirectory(AllowedDirectory);
            Directory.CreateDirectory(DeniedDirectory);
            Directory.CreateDirectory(PositiveControlDirectory);
            Directory.CreateDirectory(WorkDirectory);

            AllowedFile = Path.Combine(AllowedDirectory, "in-scope.txt");
            DeniedFile = Path.Combine(DeniedDirectory, "denied.txt");
            PositiveControlFile = Path.Combine(PositiveControlDirectory, "granted.txt");

            File.WriteAllText(AllowedFile, FixtureBody + " [allowed]");
            // العيّنتان أدناه متطابقتان في كل شيء إلا المنح. أي فارق آخر بينهما
            // يجعل مقارنة النتيجتين بلا معنى.
            File.WriteAllText(DeniedFile, FixtureBody + " [control]");
            File.WriteAllText(PositiveControlFile, FixtureBody + " [control]");
        }

        public void Emit(JsonWriter json)
        {
            json.Name("mission_scopes").BeginArray();
            EmitScope(json, ScopeControlRoot, Root, "traversal only; never a mission resource and never inherited into its children");
            EmitScope(json, ScopeAllowedResource, AllowedDirectory, "the only tree a mission tool may treat as a target");
            EmitScope(json, ScopeDeniedControlResource, DeniedDirectory, "must carry no AppContainer grant, explicit or inherited");
            EmitScope(json, ScopePositiveControlResource, PositiveControlDirectory, "identical in shape to the denied fixture, granted on purpose, to prove denial is denial");
            EmitScope(json, ScopeWork, WorkDirectory, "working directory and TEMP for the confined process");
            json.EndArray();
            json.Property("mission_resource_scope", AllowedDirectory);
            json.Property("out_of_scope_fixture", DeniedFile);
            json.Property("positive_control_fixture", PositiveControlFile);
        }

        private static void EmitScope(JsonWriter json, string scopeClass, string path, string note)
        {
            json.BeginObject();
            json.Property("scope_class", scopeClass);
            json.Property("path", path);
            json.Property("note", note);
            json.EndObject();
        }

        /// <summary>هدم شجرة العيّنات. النتيجة تُعاد ولا تُبتلع.</summary>
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
    }
}
