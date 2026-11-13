using System;
using System.Diagnostics;
using System.Globalization;

namespace Polaris.ConfinementSpike.Launcher
{
    // التحقق من بقاء أو فناء عملية بعد إنهاء الحصر.
    // نطابق الاسم أيضًا حتى لا نضلَّل بإعادة استخدام معرف العملية
    public static class OrphanVerifier
    {
        public static int ExtractPidFromDetail(string detail, string key)
        {
            if (string.IsNullOrEmpty(detail)) { return 0; }
            int index = detail.IndexOf(key, StringComparison.Ordinal);
            if (index < 0) { return 0; }
            int start = index + key.Length;
            int end = start;
            while (end < detail.Length && char.IsDigit(detail[end])) { end++; }
            if (end == start) { return 0; }
            int value;
            int.TryParse(detail.Substring(start, end - start), NumberStyles.Integer, CultureInfo.InvariantCulture, out value);
            return value;
        }

        public static bool IsAlive(int processId, string expectedProcessName)
        {
            if (processId <= 0) { return false; }
            try
            {
                Process process = Process.GetProcessById(processId);
                if (process.HasExited) { return false; }
                return string.Equals(process.ProcessName, expectedProcessName, StringComparison.OrdinalIgnoreCase);
            }
            catch (ArgumentException)
            {
                return false;
            }
            catch (InvalidOperationException)
            {
                return false;
            }
        }

        public static bool KillIfAlive(int processId, string expectedProcessName)
        {
            if (!IsAlive(processId, expectedProcessName)) { return false; }
            try
            {
                Process process = Process.GetProcessById(processId);
                process.Kill();
                return true;
            }
            catch (Exception)
            {
                return false;
            }
        }
    }
}
