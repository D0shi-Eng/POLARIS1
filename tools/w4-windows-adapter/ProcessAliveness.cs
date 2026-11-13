using System;
using System.Diagnostics;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// هل ما زالت عملية حيّة بعد هدم الحصر.
    /// يُطابَق الاسم أيضًا حتى لا يضلّلنا إعادة استخدام معرّف العملية.
    /// </summary>
    internal static class ProcessAliveness
    {
        internal static bool IsAlive(int processId, string expectedProcessName)
        {
            if (processId <= 0) { return false; }
            try
            {
                Process process = Process.GetProcessById(processId);
                if (process.HasExited) { return false; }
                return string.Equals(process.ProcessName, expectedProcessName, StringComparison.OrdinalIgnoreCase);
            }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
        }
    }
}
