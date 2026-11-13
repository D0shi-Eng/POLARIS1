using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// قراءة الـDACL الفعلي لمسار وتصنيفه بالنسبة لمعرّف الحاوية.
    ///
    /// لماذا هذا موجود: المنح المطلوب شيء، والمنح الفعلي شيء آخر. منحٌ على مجلد
    /// أب بوراثة يصل إلى كل ما تحته، فيصير "المورد الممنوع" ممنوحًا فعليًا بينما
    /// يظن التقرير أنه ليس كذلك. الدليل يجب أن يُظهر الـACL الفعلي لكل صنف نطاق،
    /// لا نيّة المنح.
    ///
    /// وتُفحص أيضًا المنح الواسعة التي تصل إلى حاويات التطبيقات: W1 أثبت أن عملية
    /// داخل AppContainer تقرأ عبر مجموعات حزم التطبيقات، فوجود واحدة منها على
    /// المورد الممنوع يعني أن الحدّ الأمني لا يمنعه أصلًا.
    /// </summary>
    internal static class AclInspector
    {
        // تُستعمل معرّفات الأمان نصًّا لا أسماء عرض: الأسماء تختلف باللغة، والمعرّف ثابت.
        internal const string SidAllApplicationPackages = "S-1-15-2-1";
        internal const string SidAllRestrictedApplicationPackages = "S-1-15-2-2";
        internal const string SidEveryone = "S-1-1-0";
        internal const string SidBuiltinUsers = "S-1-5-32-545";

        internal sealed class AclDescription
        {
            public string Path = "";
            public string ScopeClass = "";
            public bool Exists;
            public bool ContainerAcePresent;
            public bool ContainerAceInherited;
            public string ContainerRights = "";
            public string ContainerInheritanceFlags = "";
            public bool BroadApplicationPackageAcePresent;
            public bool EveryoneAcePresent;
            public bool BuiltinUsersAcePresent;
            public string Error = "";
            public List<string> Rules = new List<string>();
        }

        internal static AclDescription Describe(string path, string scopeClass, string containerSid)
        {
            AclDescription description = new AclDescription();
            description.Path = path;
            description.ScopeClass = scopeClass;

            try
            {
                AuthorizationRuleCollection rules;
                if (Directory.Exists(path))
                {
                    description.Exists = true;
                    rules = Directory.GetAccessControl(path).GetAccessRules(true, true, typeof(SecurityIdentifier));
                }
                else if (File.Exists(path))
                {
                    description.Exists = true;
                    rules = File.GetAccessControl(path).GetAccessRules(true, true, typeof(SecurityIdentifier));
                }
                else
                {
                    description.Error = "the path does not exist";
                    return description;
                }

                foreach (AuthorizationRule rule in rules)
                {
                    FileSystemAccessRule access = rule as FileSystemAccessRule;
                    if (access == null) { continue; }
                    string identity = access.IdentityReference.Value;

                    description.Rules.Add(
                        identity + "|" + access.AccessControlType.ToString()
                        + "|" + access.FileSystemRights.ToString()
                        + "|inherited=" + access.IsInherited.ToString()
                        + "|inheritance=" + access.InheritanceFlags.ToString()
                        + "|propagation=" + access.PropagationFlags.ToString());

                    if (access.AccessControlType != AccessControlType.Allow) { continue; }

                    if (!string.IsNullOrEmpty(containerSid)
                        && string.Equals(identity, containerSid, StringComparison.OrdinalIgnoreCase))
                    {
                        description.ContainerAcePresent = true;
                        if (access.IsInherited) { description.ContainerAceInherited = true; }
                        description.ContainerRights = Append(description.ContainerRights, access.FileSystemRights.ToString());
                        description.ContainerInheritanceFlags =
                            Append(description.ContainerInheritanceFlags, access.InheritanceFlags.ToString());
                    }
                    if (string.Equals(identity, SidAllApplicationPackages, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(identity, SidAllRestrictedApplicationPackages, StringComparison.OrdinalIgnoreCase))
                    {
                        description.BroadApplicationPackageAcePresent = true;
                    }
                    if (string.Equals(identity, SidEveryone, StringComparison.OrdinalIgnoreCase))
                    {
                        description.EveryoneAcePresent = true;
                    }
                    if (string.Equals(identity, SidBuiltinUsers, StringComparison.OrdinalIgnoreCase))
                    {
                        description.BuiltinUsersAcePresent = true;
                    }
                }
            }
            catch (Exception error)
            {
                description.Error = error.GetType().Name + ": " + error.Message;
            }
            return description;
        }

        /// <summary>هل يصل معرّف الحاوية إلى هذا المسار بأي طريق — صريحًا أو موروثًا أو عبر مجموعة حزم؟</summary>
        internal static bool ContainerCanReach(AclDescription description)
        {
            return description.ContainerAcePresent
                || description.BroadApplicationPackageAcePresent;
        }

        private static string Append(string current, string value)
        {
            if (current.Length == 0) { return value; }
            return current + " + " + value;
        }

        internal static void Emit(JsonWriter json, string name, List<AclDescription> descriptions)
        {
            json.Name(name).BeginArray();
            foreach (AclDescription description in descriptions)
            {
                json.BeginObject();
                json.Property("path", description.Path);
                json.Property("scope_class", description.ScopeClass);
                json.Property("exists", description.Exists);
                json.Property("container_ace_present", description.ContainerAcePresent);
                json.Property("container_ace_inherited", description.ContainerAceInherited);
                json.Property("container_rights", description.ContainerRights);
                json.Property("container_inheritance_flags", description.ContainerInheritanceFlags);
                json.Property("broad_application_package_ace_present", description.BroadApplicationPackageAcePresent);
                json.Property("everyone_ace_present", description.EveryoneAcePresent);
                json.Property("builtin_users_ace_present", description.BuiltinUsersAcePresent);
                json.Property("container_can_reach", ContainerCanReach(description));
                json.Property("error", description.Error);
                json.Property("rules", description.Rules);
                json.EndObject();
            }
            json.EndArray();
        }
    }
}
