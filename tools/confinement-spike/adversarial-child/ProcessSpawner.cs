using System;
using System.Globalization;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Child.Native;

namespace Polaris.ConfinementSpike.Child
{
    // نتيجة محاولة إنشاء عملية، بصيغة خام تحتفظ برقم خطأ Windows
    internal sealed class SpawnResult
    {
        public bool Created;
        public int ErrorCode;
        public uint ProcessId;
        public bool ChildInJob;
    }

    // مسؤولية واحدة: إنشاء نسخة من البرنامج العدائي بدور محدد
    internal static class ProcessSpawner
    {
        public static SpawnResult Spawn(string selfExecutablePath, string arguments, uint creationFlags)
        {
            SpawnResult result = new SpawnResult();

            ChildNativeMethods.STARTUPINFO startupInfo = new ChildNativeMethods.STARTUPINFO();
            startupInfo.cb = Marshal.SizeOf(typeof(ChildNativeMethods.STARTUPINFO));
            ChildNativeMethods.PROCESS_INFORMATION processInformation;

            string commandLine = "\"" + selfExecutablePath + "\" " + arguments;

            bool created = ChildNativeMethods.CreateProcessW(
                null,
                commandLine,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                creationFlags | ChildNativeMethods.CREATE_NO_WINDOW,
                IntPtr.Zero,
                null,
                ref startupInfo,
                out processInformation);

            if (!created)
            {
                result.Created = false;
                result.ErrorCode = Marshal.GetLastWin32Error();
                return result;
            }

            bool inJob = false;
            ChildNativeMethods.IsProcessInJob(processInformation.hProcess, IntPtr.Zero, out inJob);

            result.Created = true;
            result.ErrorCode = 0;
            result.ProcessId = processInformation.dwProcessId;
            result.ChildInJob = inJob;

            ChildNativeMethods.CloseHandle(processInformation.hThread);
            ChildNativeMethods.CloseHandle(processInformation.hProcess);
            return result;
        }

        public static string SleeperArguments(int milliseconds)
        {
            return "--role sleeper --sleep " + milliseconds.ToString(CultureInfo.InvariantCulture);
        }
    }
}
