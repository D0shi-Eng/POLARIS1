using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.W4.WindowsAdapter
{
    /// <summary>
    /// Job Object بدلالات ADR-001: كل ما يُضم يموت بإغلاق الـJob، ولا انفصال.
    ///
    /// BREAKAWAY غير مضبوط عمدًا: عدم ضبطه هو المنع. ضبطه يسمح لعملية ابنة أن
    /// تخرج من الحصر، وهو بالضبط ما لا يجوز.
    /// </summary>
    internal sealed class JobScope : IDisposable
    {
        private IntPtr _handle = IntPtr.Zero;
        public int LastError;
        public string FailureStage = "";

        public IntPtr Handle { get { return _handle; } }

        public bool Create(string name)
        {
            _handle = JobNativeMethods.CreateJobObjectW(IntPtr.Zero, name);
            if (_handle == IntPtr.Zero)
            {
                LastError = Marshal.GetLastWin32Error();
                FailureStage = "CreateJobObjectW";
                return false;
            }

            JobNativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION information =
                new JobNativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            information.BasicLimitInformation.LimitFlags = JobNativeMethods.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            int size = Marshal.SizeOf(typeof(JobNativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                Marshal.StructureToPtr(information, buffer, false);
                if (!JobNativeMethods.SetInformationJobObject(
                        _handle, JobNativeMethods.JobObjectExtendedLimitInformation, buffer, (uint)size))
                {
                    LastError = Marshal.GetLastWin32Error();
                    FailureStage = "SetInformationJobObject(ExtendedLimit)";
                    return false;
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
            return true;
        }

        /// <summary>معرّفات العمليات التي ما زالت داخل الـJob. فارغة تعني لا ناجين.</summary>
        public List<int> LiveProcessIds()
        {
            List<int> ids = new List<int>();
            if (_handle == IntPtr.Zero) { return ids; }

            int headerSize = Marshal.SizeOf(typeof(NativeExtras.JOBOBJECT_BASIC_PROCESS_ID_LIST));
            int size = headerSize + (IntPtr.Size * 256);
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                // التوقيع يأخذ lpReturnLength مؤشِّرًا خامًا؛ طوله غير لازم هنا
                // لأن NumberOfProcessIdsInList داخل البنية هو مصدر العدّ.
                if (!JobNativeMethods.QueryInformationJobObject(
                        _handle, JobNativeMethods.JobObjectBasicProcessIdList, buffer, (uint)size, IntPtr.Zero))
                {
                    LastError = Marshal.GetLastWin32Error();
                    return ids;
                }
                NativeExtras.JOBOBJECT_BASIC_PROCESS_ID_LIST list =
                    (NativeExtras.JOBOBJECT_BASIC_PROCESS_ID_LIST)Marshal.PtrToStructure(
                        buffer, typeof(NativeExtras.JOBOBJECT_BASIC_PROCESS_ID_LIST));

                // أول معرّف يقع داخل البنية نفسها، والباقي يليه مباشرة.
                IntPtr cursor = new IntPtr(buffer.ToInt64() + headerSize - IntPtr.Size);
                for (uint i = 0; i < list.NumberOfProcessIdsInList && i < 256; i++)
                {
                    IntPtr value = Marshal.ReadIntPtr(cursor, (int)(i * IntPtr.Size));
                    ids.Add((int)value.ToInt64());
                }
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
            return ids;
        }

        /// <summary>إغلاق الـJob. مع KILL_ON_JOB_CLOSE يعني موت كل ما بداخله.</summary>
        public void Dispose()
        {
            if (_handle != IntPtr.Zero)
            {
                ProcessNativeMethods.CloseHandle(_handle);
                _handle = IntPtr.Zero;
            }
        }
    }
}
