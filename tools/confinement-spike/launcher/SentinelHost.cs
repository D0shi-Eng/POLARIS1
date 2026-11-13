using System;
using System.Diagnostics;

namespace Polaris.ConfinementSpike.Launcher
{
    // عملية بريئة تعمل خارج الحصر، تُستخدم هدفًا لاختبار التأثير على عملية غير مرتبطة.
    // لا نستهدف أي عملية نظام حقيقية إطلاقًا
    public sealed class SentinelHost : IDisposable
    {
        private Process _process;

        public int ProcessId { get { return _process != null ? _process.Id : 0; } }

        public void Start(string executablePath, int lifetimeMilliseconds)
        {
            ProcessStartInfo startInfo = new ProcessStartInfo(executablePath,
                "--role sentinel --sleep " + lifetimeMilliseconds);
            startInfo.UseShellExecute = false;
            startInfo.CreateNoWindow = true;
            startInfo.RedirectStandardOutput = true;
            _process = Process.Start(startInfo);
        }

        public bool IsAlive()
        {
            try { return _process != null && !_process.HasExited; }
            catch (Exception) { return false; }
        }

        public void Dispose()
        {
            try
            {
                if (_process != null && !_process.HasExited)
                {
                    _process.Kill();
                }
            }
            catch (Exception) { }
        }
    }
}
