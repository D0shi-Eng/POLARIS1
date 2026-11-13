using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>منحة واحدة: مسارها، صنف نطاقها، حقوقها، ووراثتها.</summary>
    internal sealed class GrantRecord
    {
        public string Path = "";
        public string ScopeClass = "";
        public string Rights = "";
        public string Inheritance = "";
        public bool Applied;
        public string Error = "";
    }

    /// <summary>نتيجة تنظيف الحاوية، مهيكلة. لا يُبتلع إخفاق بلا دليل.</summary>
    internal sealed class ContainerCleanupResult
    {
        public bool AclRestoreAttempted;
        public bool AclRestoreSuccess = true;
        public List<string> AclRestoreFailures = new List<string>();
        public List<string> ResidualContainerAces = new List<string>();
        public bool ProfileDeleteAttempted;
        public bool ProfileDeleteSuccess;
        public int ProfileDeleteHResult;
        public string ProfileDeleteSkippedReason = "";
    }

    /// <summary>
    /// ملف تعريف AppContainer بصفر قدرات، مع منح ACL صريح لما تحتاجه العملية فعلًا.
    ///
    /// المنح صريح ومحدود ومُصنَّف ومُستعاد: عملية داخل AppContainer لا ترى شيئًا
    /// إلا ما مُنح لمعرّف الأمان الخاص بها. هذا هو الفرق بين "حصر" و"حظ".
    ///
    /// الوراثة ليست تفصيلًا: منحٌ موروث على مجلد أب يصل إلى كل ما تحته، ومنه
    /// المورد الذي يُفترض أنه ممنوع. لذلك لكل مسار هنا شكل وراثة معلن ومقصود.
    ///
    /// دورة حياة الملف التعريفي تُتعقَّب بذاتها: "اشتُقّ معرّفه" لا يعني "أنشأناه"،
    /// ولا يجوز حذف ما لا نملك دلالات دورة حياته.
    ///
    /// إنشاء الملف التعريفي لا يتطلب صلاحيات مدير، وهي نقطة تبنٍّ مهمة أثبتها W1.
    /// </summary>
    internal sealed class AppContainerScope : IDisposable
    {
        internal const string LifecycleNotCreated = "PROFILE_NOT_CREATED";
        internal const string LifecycleCreatedThisRun = "PROFILE_CREATED_THIS_RUN";
        internal const string LifecycleStaleDeleted = "PROFILE_STALE_DELETED";
        internal const string LifecycleReusedOrDerived = "PROFILE_REUSED_OR_DERIVED";

        private readonly string _name;
        private readonly List<GrantRecord> _grants = new List<GrantRecord>();
        private IntPtr _sid = IntPtr.Zero;
        private ContainerCleanupResult _cleanup;

        public string SidString = "";
        public int LastError;
        public string FailureStage = "";

        /// <summary>دورة حياة الملف التعريفي في هذا التشغيل.</summary>
        public string Lifecycle = LifecycleNotCreated;
        /// <summary>هل يملك هذا التشغيل دلالات دورة حياة الملف التعريفي؟ الحذف مشروط بها.</summary>
        public bool OwnsProfile;
        public bool StaleProfileDetected;
        public bool StaleDeleteAttempted;
        public int StaleDeleteHResult;
        public bool StaleReclaimed;
        /// <summary>وُجد ملف تعريف باقٍ ولم يُمكن استرداده. بيئة قياس غير نظيفة.</summary>
        public bool StaleReclaimFailed;

        public AppContainerScope(string name) { _name = name; }

        public IntPtr Sid { get { return _sid; } }
        public IEnumerable<GrantRecord> Grants { get { return _grants; } }

        public bool Create()
        {
            int hr = AppContainerNativeMethods.CreateAppContainerProfile(
                _name, _name, "POLARIS W4 confined execution host", IntPtr.Zero, 0, out _sid);

            if (hr == AppContainerNativeMethods.HRESULT_ALREADY_EXISTS)
            {
                // ملف تعريف باقٍ من تشغيل سابق. استرداده عملية صريحة ذات نتيجة
                // مسجّلة، لا أثر جانبي لاشتقاق معرّف.
                StaleProfileDetected = true;
                StaleDeleteAttempted = true;
                StaleDeleteHResult = ReclaimStaleProfile();

                if (StaleDeleteHResult >= 0)
                {
                    hr = AppContainerNativeMethods.CreateAppContainerProfile(
                        _name, _name, "POLARIS W4 confined execution host", IntPtr.Zero, 0, out _sid);
                    if (hr >= 0)
                    {
                        StaleReclaimed = true;
                        Lifecycle = LifecycleStaleDeleted;
                        OwnsProfile = true;
                    }
                    else
                    {
                        LastError = hr;
                        FailureStage = "PROFILE_RECLAIM";
                        return false;
                    }
                }
                else
                {
                    // لا نملك دورة حياته. يُشتق المعرّف للتشخيص وحده، ولا يُحذف
                    // أبدًا عند الهدم — ولا يُقاس شيء في بيئة غير نظيفة.
                    StaleReclaimFailed = true;
                    Lifecycle = LifecycleReusedOrDerived;
                    OwnsProfile = false;
                    int derived = AppContainerNativeMethods.DeriveAppContainerSidFromAppContainerName(_name, out _sid);
                    if (derived >= 0 && _sid != IntPtr.Zero) { ReadSidString(); }
                    LastError = StaleDeleteHResult;
                    FailureStage = "PROFILE_RECLAIM";
                    return false;
                }
            }
            else if (hr >= 0)
            {
                Lifecycle = LifecycleCreatedThisRun;
                OwnsProfile = true;
            }

            if (hr < 0 || _sid == IntPtr.Zero)
            {
                LastError = hr;
                FailureStage = "CreateAppContainerProfile";
                return false;
            }

            ReadSidString();
            return true;
        }

        private int ReclaimStaleProfile()
        {
            try { return AppContainerNativeMethods.DeleteAppContainerProfile(_name); }
            catch (Exception) { return unchecked((int) 0x80004005); }
        }

        private void ReadSidString()
        {
            IntPtr sidText;
            if (AppContainerNativeMethods.ConvertSidToStringSidW(_sid, out sidText))
            {
                SidString = Marshal.PtrToStringUni(sidText);
                AppContainerNativeMethods.LocalFree(sidText);
            }
        }

        /// <summary>قراءة وتنفيذ على شجرة كاملة. لكود التشغيل المُدرَّج وحده.</summary>
        public bool GrantReadExecuteTree(string path, string scopeClass)
        {
            return Grant(path, scopeClass, FileSystemRights.ReadAndExecute | FileSystemRights.Synchronize,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, "ReadAndExecute", "TREE");
        }

        /// <summary>تعديل على شجرة كاملة. لنطاق موارد المهمة المسموح وحده.</summary>
        public bool GrantModifyTree(string path, string scopeClass)
        {
            return Grant(path, scopeClass, FileSystemRights.Modify | FileSystemRights.Synchronize,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, "Modify", "TREE");
        }

        /// <summary>
        /// اجتياز المجلد نفسه فقط، بلا وراثة إلى محتواه.
        ///
        /// هذا هو تصحيح العيب: منح المجلد الأب بوراثة كان يمنح كل ما تحته — ومنه
        /// المورد الممنوع. الاجتياز يفتح الطريق ولا يفتح الأبواب.
        /// </summary>
        public bool GrantTraverseOnly(string path, string scopeClass)
        {
            return Grant(path, scopeClass, FileSystemRights.Traverse | FileSystemRights.ReadAttributes,
                InheritanceFlags.None, "Traverse+ReadAttributes", "THIS_FOLDER_ONLY");
        }

        private bool Grant(string path, string scopeClass, FileSystemRights rights,
            InheritanceFlags inheritance, string rightsLabel, string inheritanceLabel)
        {
            GrantRecord record = new GrantRecord();
            record.Path = path;
            record.ScopeClass = scopeClass;
            record.Rights = rightsLabel;
            record.Inheritance = inheritanceLabel;

            try
            {
                SecurityIdentifier identity = new SecurityIdentifier(SidString);
                if (Directory.Exists(path))
                {
                    DirectorySecurity security = Directory.GetAccessControl(path);
                    security.AddAccessRule(new FileSystemAccessRule(
                        identity, rights, inheritance, PropagationFlags.None, AccessControlType.Allow));
                    Directory.SetAccessControl(path, security);
                }
                else if (File.Exists(path))
                {
                    FileSecurity security = File.GetAccessControl(path);
                    security.AddAccessRule(new FileSystemAccessRule(identity, rights, AccessControlType.Allow));
                    File.SetAccessControl(path, security);
                }
                else
                {
                    record.Error = "the path does not exist";
                    _grants.Add(record);
                    return false;
                }
                record.Applied = true;
                _grants.Add(record);
                return true;
            }
            catch (Exception error)
            {
                record.Error = error.GetType().Name + ": " + error.Message;
                FailureStage = "Grant(" + path + "): " + record.Error;
                _grants.Add(record);
                return false;
            }
        }

        /// <summary>
        /// استعادة كل منح، والتحقق من الاستعادة، ثم حذف الملف التعريفي إن كنا نملكه.
        /// النتيجة مهيكلة: كل إخفاق يُسجَّل، ولا يُبتلع.
        /// </summary>
        public ContainerCleanupResult Cleanup()
        {
            if (_cleanup != null) { return _cleanup; }
            ContainerCleanupResult result = new ContainerCleanupResult();
            result.AclRestoreAttempted = _grants.Count > 0;

            foreach (GrantRecord grant in _grants)
            {
                if (!grant.Applied) { continue; }
                try
                {
                    SecurityIdentifier identity = new SecurityIdentifier(SidString);
                    if (Directory.Exists(grant.Path))
                    {
                        DirectorySecurity security = Directory.GetAccessControl(grant.Path);
                        security.PurgeAccessRules(identity);
                        Directory.SetAccessControl(grant.Path, security);
                    }
                    else if (File.Exists(grant.Path))
                    {
                        FileSecurity security = File.GetAccessControl(grant.Path);
                        security.PurgeAccessRules(identity);
                        File.SetAccessControl(grant.Path, security);
                    }
                    else
                    {
                        // المسار زال: لم يبقَ منح عليه. ليس إخفاقًا.
                        continue;
                    }

                    // الاستعادة تُتحقَّق لا تُفترض.
                    AclInspector.AclDescription after =
                        AclInspector.Describe(grant.Path, grant.ScopeClass, SidString);
                    if (after.ContainerAcePresent)
                    {
                        result.ResidualContainerAces.Add(grant.ScopeClass + ":" + grant.Path);
                        result.AclRestoreSuccess = false;
                    }
                }
                catch (Exception error)
                {
                    result.AclRestoreFailures.Add(
                        grant.ScopeClass + ":" + grant.Path + " => " + error.GetType().Name + ": " + error.Message);
                    result.AclRestoreSuccess = false;
                }
            }

            if (OwnsProfile)
            {
                result.ProfileDeleteAttempted = true;
                try
                {
                    result.ProfileDeleteHResult = AppContainerNativeMethods.DeleteAppContainerProfile(_name);
                }
                catch (Exception)
                {
                    result.ProfileDeleteHResult = unchecked((int) 0x80004005);
                }
                result.ProfileDeleteSuccess = result.ProfileDeleteHResult >= 0;
            }
            else
            {
                result.ProfileDeleteAttempted = false;
                result.ProfileDeleteSuccess = true;
                result.ProfileDeleteSkippedReason =
                    "NOT_OWNED_BY_THIS_RUN: the profile was derived, not created here; deleting it would remove state this run does not own";
            }

            _cleanup = result;
            return result;
        }

        public void Dispose()
        {
            Cleanup();
            if (_sid != IntPtr.Zero)
            {
                AppContainerNativeMethods.FreeSid(_sid);
                _sid = IntPtr.Zero;
            }
        }

        internal void EmitProfile(JsonWriter json)
        {
            json.Name("app_container_profile").BeginObject();
            json.Property("name", _name);
            json.Property("sid", SidString);
            json.Property("lifecycle", Lifecycle);
            json.Property("owned_by_this_run", OwnsProfile);
            json.Property("stale_profile_detected", StaleProfileDetected);
            json.Property("stale_delete_attempted", StaleDeleteAttempted);
            json.Property("stale_delete_hresult", "0x" + StaleDeleteHResult.ToString("x8"));
            json.Property("stale_reclaimed", StaleReclaimed);
            json.Property("stale_reclaim_failed", StaleReclaimFailed);
            json.EndObject();
        }

        internal void EmitGrants(JsonWriter json)
        {
            json.Name("acl_grants").BeginArray();
            foreach (GrantRecord grant in _grants)
            {
                json.BeginObject();
                json.Property("path", grant.Path);
                json.Property("scope_class", grant.ScopeClass);
                json.Property("rights", grant.Rights);
                json.Property("inheritance", grant.Inheritance);
                json.Property("applied", grant.Applied);
                json.Property("error", grant.Error);
                json.EndObject();
            }
            json.EndArray();
        }

        internal static void EmitCleanup(JsonWriter json, ContainerCleanupResult result)
        {
            json.Property("acl_restore_attempted", result != null && result.AclRestoreAttempted);
            json.Property("acl_restore_success", result != null && result.AclRestoreSuccess);
            json.Property("acl_restore_failures", result == null ? new List<string>() : result.AclRestoreFailures);
            json.Property("acl_residual_container_aces", result == null ? new List<string>() : result.ResidualContainerAces);
            json.Property("profile_delete_attempted", result != null && result.ProfileDeleteAttempted);
            json.Property("profile_delete_success", result != null && result.ProfileDeleteSuccess);
            json.Property("profile_delete_hresult", result == null ? "" : "0x" + result.ProfileDeleteHResult.ToString("x8"));
            json.Property("profile_delete_skipped_reason", result == null ? "" : result.ProfileDeleteSkippedReason);
        }
    }
}
