using System;
using System.Collections.Generic;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>هدف واحد للضابط: مساره، صنف نطاقه، ما يُتوقع منه، وما وقع فعلًا.</summary>
    internal sealed class AclControlTarget
    {
        public string ScopeClass = "";
        public string Expected = "";
        public string Path = "";
        public bool Reported;
        public bool Opened;
        public long BytesRead;
        public string ErrorCode = "";
        /// <summary>هوية الكائن كما تبلّغها بيئة تشغيل المنفّذ نفسها من داخل الحاوية.</summary>
        public string ObservedVolume = "";
        public string ObservedFileId = "";
        /// <summary>نتيجة الاستعلام عن المدخل نفسه وعن مجلده، بلا اتباع رابط.</summary>
        public string LinkStatCode = "";
        public string ParentLinkStatCode = "";

        public AclControlTarget(string scopeClass, string expected, string path)
        {
            ScopeClass = scopeClass;
            Expected = expected;
            Path = path;
        }
    }

    /// <summary>
    /// ضابط إنفاذ الـACL على مستوى نظام التشغيل، من داخل الحاوية نفسها.
    ///
    /// المشكلة التي يحلّها: «رُفضت القراءة خارج النطاق» وحدها لا تفرّق بين ثلاثة
    /// أشياء مختلفة تمامًا:
    ///   1) نقطة الفرض في POLARIS رفضت العملية (وهذا ادّعاء عن الـPEP).
    ///   2) حدّ ويندوز الأمني منع الوصول (وهذا ادّعاء عن الحصر).
    ///   3) العيّنة مكسورة أو المسار خاطئ فلم يُقرأ شيء أصلًا (وهذا ليس ادّعاءً بل عطل).
    ///
    /// لذلك يُطلق هنا مسبار صغير داخل الحاوية نفسها — صفر قدرات، Job، قائمة مقابض
    /// صريحة — يفتح المسارات فتحًا خامًا بلا مرور بالـPEP، ويبلّغ عن نتيجة كل فتح:
    ///
    ///   MISSION_ALLOWED_RESOURCE_SCOPE     يجب أن يُفتح
    ///   MISSION_CONTROL_POSITIVE_FIXTURE   يجب أن يُفتح  (الضابط الموجب)
    ///   MISSION_DENIED_CONTROL_RESOURCE    يجب أن يُرفض
    ///
    /// فإن فشل الضابط الموجب، فالرفض في الحالة الممنوعة لا يثبت شيئًا: قد يكون
    /// المسبار عاجزًا عن فتح أي شيء. عندها INCONCLUSIVE لا PASS.
    ///
    /// شيفرة المسبار من تأليف المحوّل، وتُدرَّج في نطاق منفصل عن نطاق كود التشغيل
    /// حتى لا تختلط بمنفّذ W4 الحقيقي. بصمتها مسجّلة في الدليل.
    /// </summary>
    internal sealed class AclControlProbe
    {
        internal const string ExpectedReadable = "READABLE";
        internal const string ExpectedDenied = "DENIED";

        private const string ProtocolPrefix = "POLARIS_ACL_PROBE";
        private const string ProtocolDone = "POLARIS_ACL_PROBE_DONE";

        public string Root = "";
        public string ScriptPath = "";
        public string TargetsPath = "";
        public string ScriptSha256 = "";
        public string FailureStage = "";
        public string FailureDetail = "";
        public bool Ran;
        public bool ProtocolComplete;
        public string RawOutput = "";
        public List<AclControlTarget> Targets = new List<AclControlTarget>();

        public bool Stage(string workspace, List<AclControlTarget> targets)
        {
            try
            {
                Targets = targets;
                Root = Path.Combine(workspace, "control-code");
                Directory.CreateDirectory(Root);

                ScriptPath = Path.Combine(Root, "acl-probe.mjs");
                TargetsPath = Path.Combine(Root, "acl-probe-targets.tsv");

                File.WriteAllText(Path.Combine(Root, "package.json"), "{\"type\":\"module\"}\n");
                File.WriteAllText(ScriptPath, Script(), new UTF8Encoding(false));

                StringBuilder lines = new StringBuilder();
                foreach (AclControlTarget target in targets)
                {
                    lines.Append(target.ScopeClass).Append('\t')
                         .Append(target.Expected).Append('\t')
                         .Append(target.Path).Append('\n');
                }
                File.WriteAllText(TargetsPath, lines.ToString(), new UTF8Encoding(false));

                ScriptSha256 = Sha256(ScriptPath);
                return true;
            }
            catch (Exception error)
            {
                FailureStage = "ACL_CONTROL_STAGING";
                FailureDetail = error.GetType().Name + ": " + error.Message;
                return false;
            }
        }

        public void Parse(string output)
        {
            RawOutput = output == null ? "" : output;
            Ran = true;
            string[] lines = RawOutput.Replace("\r\n", "\n").Split('\n');
            foreach (string line in lines)
            {
                if (line == ProtocolDone) { ProtocolComplete = true; continue; }
                if (!line.StartsWith(ProtocolPrefix + "\t", StringComparison.Ordinal)) { continue; }
                string[] parts = line.Split('\t');
                if (parts.Length < 7) { continue; }
                string scopeClass = parts[1];
                foreach (AclControlTarget target in Targets)
                {
                    if (!string.Equals(target.ScopeClass, scopeClass, StringComparison.Ordinal)) { continue; }
                    target.Reported = true;
                    target.Opened = string.Equals(parts[3], "true", StringComparison.OrdinalIgnoreCase);
                    long bytes;
                    if (long.TryParse(parts[4], out bytes)) { target.BytesRead = bytes; }
                    target.ErrorCode = parts[5];
                    if (parts.Length > 7) { target.ObservedVolume = parts[7]; }
                    if (parts.Length > 8) { target.ObservedFileId = parts[8]; }
                    if (parts.Length > 9) { target.LinkStatCode = parts[9]; }
                    if (parts.Length > 10) { target.ParentLinkStatCode = parts[10]; }
                    break;
                }
            }
        }

        public bool Reported(string scopeClass)
        {
            foreach (AclControlTarget target in Targets)
            {
                if (string.Equals(target.ScopeClass, scopeClass, StringComparison.Ordinal)) { return target.Reported; }
            }
            return false;
        }

        public bool Opened(string scopeClass)
        {
            foreach (AclControlTarget target in Targets)
            {
                if (string.Equals(target.ScopeClass, scopeClass, StringComparison.Ordinal))
                {
                    return target.Reported && target.Opened && target.BytesRead > 0;
                }
            }
            return false;
        }

        /// <summary>الهدف المسجَّل لصنف نطاق بعينه، أو null إن لم يكن من أهداف الضابط.</summary>
        public AclControlTarget Find(string scopeClass)
        {
            foreach (AclControlTarget target in Targets)
            {
                if (string.Equals(target.ScopeClass, scopeClass, StringComparison.Ordinal)) { return target; }
            }
            return null;
        }

        /// <summary>الضابط الموجب صالح فقط إذا فُتح المورد الممنوح فعلًا وقُرئ منه.</summary>
        public bool PositiveControlValid
        {
            get { return Opened(MissionFixtures.ScopePositiveControlResource); }
        }

        /// <summary>الحدّ الأمني يمنع المورد الممنوع فعلًا: أُبلغ عنه ولم يُفتح.</summary>
        public bool DeniedResourceRefusedByOs
        {
            get
            {
                return Reported(MissionFixtures.ScopeDeniedControlResource)
                    && !Opened(MissionFixtures.ScopeDeniedControlResource);
            }
        }

        public void Emit(JsonWriter json)
        {
            json.Name("os_acl_control").BeginObject();
            json.Property("ran", Ran);
            json.Property("protocol_complete", ProtocolComplete);
            json.Property("control_code_scope", Root);
            json.Property("probe_script", ScriptPath);
            json.Property("probe_script_sha256", ScriptSha256);
            json.Property("probe_script_authored_by", "polaris.w4.windows-adapter (not the W4 executor; a separate control)");
            json.Property("failure_stage", FailureStage);
            json.Property("failure_detail", FailureDetail);
            json.Property("positive_control_valid", PositiveControlValid);
            json.Property("denied_resource_refused_by_os", DeniedResourceRefusedByOs);
            json.Name("targets").BeginArray();
            foreach (AclControlTarget target in Targets)
            {
                json.BeginObject();
                json.Property("scope_class", target.ScopeClass);
                json.Property("path", target.Path);
                json.Property("expected", target.Expected);
                json.Property("reported", target.Reported);
                json.Property("opened", target.Opened);
                json.Property("bytes_read", target.BytesRead);
                json.Property("error_code", target.ErrorCode);
                json.Property("observed_volume", target.ObservedVolume);
                json.Property("observed_file_id", target.ObservedFileId);
                json.Property("link_stat_code", target.LinkStatCode);
                json.Property("parent_link_stat_code", target.ParentLinkStatCode);
                json.Property("matches_expectation", MatchesExpectation(target));
                json.EndObject();
            }
            json.EndArray();
            json.Property("raw_output", RawOutput.Length > 4000 ? RawOutput.Substring(0, 4000) : RawOutput);
            json.EndObject();
        }

        private static bool MatchesExpectation(AclControlTarget target)
        {
            if (!target.Reported) { return false; }
            if (target.Expected == ExpectedReadable) { return target.Opened && target.BytesRead > 0; }
            return !target.Opened;
        }

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

        /// <summary>
        /// شيفرة الضابط. تُكتب بعلامات اقتباس مفردة عمدًا حتى تبقى قابلة للقراءة
        /// داخل سلسلة حرفية، ولا تفتح إلا ما في ملف الأهداف.
        /// </summary>
        private static string Script()
        {
            string[] lines = new string[]
            {
                @"// ضابط إنفاذ ACL على مستوى نظام التشغيل، يعمل داخل AppContainer.",
                @"// يفتح المسارات فتحًا خامًا: لا Gateway ولا PDP ولا PEP في الطريق.",
                @"import { openSync, readSync, closeSync, readFileSync, fstatSync, lstatSync } from 'node:fs';",
                @"import { dirname, join } from 'node:path';",
                @"import { fileURLToPath } from 'node:url';",
                @"",
                @"const here = dirname(fileURLToPath(import.meta.url));",
                @"const raw = readFileSync(join(here, 'acl-probe-targets.tsv'), 'utf8');",
                @"for (const line of raw.split(/\r?\n/)) {",
                @"  if (line.length === 0) continue;",
                @"  const parts = line.split('\t');",
                @"  if (parts.length < 3) continue;",
                @"  const scope = parts[0];",
                @"  const expected = parts[1];",
                @"  const target = parts[2];",
                @"  let opened = false;",
                @"  let bytes = 0;",
                @"  let code = '';",
                @"  let dev = '';",
                @"  let ino = '';",
                @"  let linkCode = 'OK';",
                @"  let parentCode = 'OK';",
                @"  // استعلام عن المدخل نفسه وعن مجلده بلا اتباع رابط. يقيس هل تملك",
                @"  // الحاوية حقّ الاستعلام داخل النطاق الممنوح، وهو ما يحتاجه الفحص",
                @"  // التمهيدي في المنفّذ. تشخيصي بحت ولا يدخل في أي حكم.",
                @"  try { lstatSync(target); } catch (error) { linkCode = error && error.code ? String(error.code) : 'UNKNOWN'; }",
                @"  try { lstatSync(dirname(target)); } catch (error) { parentCode = error && error.code ? String(error.code) : 'UNKNOWN'; }",
                @"  try {",
                @"    const fd = openSync(target, 'r');",
                @"    opened = true;",
                @"    // الهوية من المقبض نفسه: هي عين ما يقارنه المنفّذ، فيصير خلاف",
                @"    // الترميز بين المُطلِق وبيئة التشغيل مرصودًا في التشغيل ذاته.",
                @"    try { const s = fstatSync(fd, { bigint: true }); dev = String(s.dev); ino = String(s.ino); } catch (error) { dev = ''; ino = ''; }",
                @"    const buffer = Buffer.alloc(256);",
                @"    bytes = readSync(fd, buffer, 0, 256, 0);",
                @"    closeSync(fd);",
                @"  } catch (error) {",
                @"    code = error && error.code ? String(error.code) : 'UNKNOWN';",
                @"  }",
                @"  process.stdout.write('POLARIS_ACL_PROBE\t' + scope + '\t' + expected + '\t' + String(opened) + '\t' + String(bytes) + '\t' + code + '\t' + target + '\t' + dev + '\t' + ino + '\t' + linkCode + '\t' + parentCode + '\n');",
                @"}",
                @"process.stdout.write('POLARIS_ACL_PROBE_DONE\n');",
                @""
            };
            return string.Join("\n", lines);
        }
    }
}
