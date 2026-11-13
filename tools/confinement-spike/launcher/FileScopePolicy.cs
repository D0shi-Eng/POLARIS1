using System;
using System.Collections.Generic;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Polaris.ConfinementSpike.Launcher
{
    // منح صلاحيات الملفات لمعرف AppContainer وإرجاعها بالكامل بعد الانتهاء.
    // هذا هو محرك الحصر الحقيقي: AppContainer لا يملك أي صلاحية افتراضيًا،
    // فما لا نمنحه صراحة يبقى ممنوعًا
    public sealed class FileScopePolicy
    {
        private sealed class GrantRecord
        {
            public string Path;
            public bool IsDirectory;
            public FileSystemAccessRule Rule;
        }

        private readonly List<GrantRecord> _grants = new List<GrantRecord>();
        private readonly List<string> _log = new List<string>();

        public IList<string> Log { get { return _log; } }

        public void GrantDirectory(string sid, string path, FileSystemRights rights, bool inherit)
        {
            DirectoryInfo info = new DirectoryInfo(path);
            DirectorySecurity security = info.GetAccessControl();
            InheritanceFlags inheritance = inherit
                ? (InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit)
                : InheritanceFlags.None;

            FileSystemAccessRule rule = new FileSystemAccessRule(
                new SecurityIdentifier(sid), rights, inheritance, PropagationFlags.None, AccessControlType.Allow);

            security.AddAccessRule(rule);
            info.SetAccessControl(security);

            GrantRecord record = new GrantRecord();
            record.Path = path;
            record.IsDirectory = true;
            record.Rule = rule;
            _grants.Add(record);
            _log.Add("GRANT dir " + path + " rights=" + rights + " inherit=" + inherit + " sid=" + sid);
        }

        public void GrantFile(string sid, string path, FileSystemRights rights)
        {
            FileInfo info = new FileInfo(path);
            FileSecurity security = info.GetAccessControl();
            FileSystemAccessRule rule = new FileSystemAccessRule(
                new SecurityIdentifier(sid), rights, AccessControlType.Allow);
            security.AddAccessRule(rule);
            info.SetAccessControl(security);

            GrantRecord record = new GrantRecord();
            record.Path = path;
            record.IsDirectory = false;
            record.Rule = rule;
            _grants.Add(record);
            _log.Add("GRANT file " + path + " rights=" + rights + " sid=" + sid);
        }

        // منح حق العبور فقط على المجلدات الأعلى، دون حق السرد أو القراءة.
        // ضروري لأن الوصول إلى مجلد عميق يمر عبر سلسلة مجلدات لا نريد كشف محتواها
        public void GrantTraverseChain(string sid, string deepestPath, string stopAtPath)
        {
            string current = Path.GetDirectoryName(Path.GetFullPath(deepestPath));
            string stop = Path.GetFullPath(stopAtPath).TrimEnd('\\');

            while (!string.IsNullOrEmpty(current))
            {
                string normalized = current.TrimEnd('\\');
                GrantDirectory(sid, normalized, FileSystemRights.Traverse | FileSystemRights.ReadAttributes, false);
                if (string.Equals(normalized, stop, StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }
                string parent = Path.GetDirectoryName(normalized);
                if (string.Equals(parent, current, StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }
                current = parent;
            }
        }

        // إرجاع كل ما مُنح. الفشل الجزئي يُسجَّل ولا يُخفى
        public void RevertAll()
        {
            for (int i = _grants.Count - 1; i >= 0; i--)
            {
                GrantRecord record = _grants[i];
                try
                {
                    if (record.IsDirectory)
                    {
                        DirectoryInfo info = new DirectoryInfo(record.Path);
                        DirectorySecurity security = info.GetAccessControl();
                        security.RemoveAccessRuleSpecific(record.Rule);
                        info.SetAccessControl(security);
                    }
                    else
                    {
                        FileInfo info = new FileInfo(record.Path);
                        FileSecurity security = info.GetAccessControl();
                        security.RemoveAccessRuleSpecific(record.Rule);
                        info.SetAccessControl(security);
                    }
                    _log.Add("REVERT " + record.Path);
                }
                catch (Exception ex)
                {
                    _log.Add("REVERT_FAILED " + record.Path + " " + ex.GetType().Name + " " + ex.Message);
                }
            }
            _grants.Clear();
        }
    }
}
