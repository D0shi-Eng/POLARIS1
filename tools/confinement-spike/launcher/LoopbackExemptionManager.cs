using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Polaris.ConfinementSpike.Launcher
{
    // إدارة إعفاء loopback عبر أداة النظام CheckNetIsolation.
    // الإعفاء مؤقت ويُزال دائمًا بعد الاختبار، ولا يُترك أي تغيير دائم على النظام
    public sealed class LoopbackExemptionManager
    {
        private readonly List<string> _log = new List<string>();
        private string _appliedSid;

        public IList<string> Log { get { return _log; } }

        public bool Apply(string appContainerSid)
        {
            bool ok = Run("LoopbackExempt -a -p=" + appContainerSid);
            if (ok) { _appliedSid = appContainerSid; }
            return ok;
        }

        public void Remove()
        {
            if (string.IsNullOrEmpty(_appliedSid)) { return; }
            Run("LoopbackExempt -d -p=" + _appliedSid);
            _appliedSid = null;
        }

        private bool Run(string arguments)
        {
            try
            {
                ProcessStartInfo startInfo = new ProcessStartInfo(
                    Environment.GetFolderPath(Environment.SpecialFolder.System) + "\\CheckNetIsolation.exe", arguments);
                startInfo.UseShellExecute = false;
                startInfo.RedirectStandardOutput = true;
                startInfo.RedirectStandardError = true;
                startInfo.CreateNoWindow = true;

                using (Process process = Process.Start(startInfo))
                {
                    string output = process.StandardOutput.ReadToEnd() + process.StandardError.ReadToEnd();
                    process.WaitForExit(20000);
                    _log.Add("CHECKNETISOLATION " + arguments + " exit=" + process.ExitCode
                        + " " + output.Replace("\r", " ").Replace("\n", " ").Trim());
                    return process.ExitCode == 0;
                }
            }
            catch (Exception ex)
            {
                _log.Add("CHECKNETISOLATION " + arguments + " threw " + ex.GetType().Name + " " + ex.Message);
                return false;
            }
        }
    }
}
