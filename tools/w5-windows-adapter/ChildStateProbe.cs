using System;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;
using Polaris.W4.WindowsAdapter;

namespace Polaris.W5.WindowsAdapter
{
    /// <summary>
    /// مقبض عملية يبقى مفتوحًا عبر الإيقاف.
    ///
    /// العيب الذي يغلقه: معرّف العملية ليس هوية. بعد الموت يُعاد استعماله، فسؤال
    /// «هل المعرّف موجود؟» بعد الإيقاف سؤال عن معرّف لا عن ابننا. المقبض يثبّت
    /// كائن النواة نفسه: الانتظار عليه ورمز خروجه يعودان لهذا الابن بعينه، ولو
    /// أعاد النظام استعمال رقمه في اللحظة نفسها.
    ///
    /// ولذلك يُفتح قبل الإيقاف لا بعده: مقبض يُفتح بعد الموت لا يُفتح أصلًا.
    /// </summary>
    internal sealed class ChildHandle : IDisposable
    {
        private IntPtr _handle = IntPtr.Zero;

        public int ProcessId;
        public bool Valid;
        public int OpenWin32Error;

        public IntPtr Handle { get { return _handle; } }

        public static ChildHandle Open(int processId)
        {
            ChildHandle opened = new ChildHandle();
            opened.ProcessId = processId;
            if (processId <= 0)
            {
                opened.OpenWin32Error = PanicStopNative.ErrorInvalidParameter;
                return opened;
            }
            uint access = PanicStopNative.Synchronize | PanicStopNative.ProcessQueryLimitedInformation;
            IntPtr handle = NativeExtras.OpenProcess(access, false, (uint) processId);
            if (handle == IntPtr.Zero)
            {
                opened.OpenWin32Error = Marshal.GetLastWin32Error();
                return opened;
            }
            opened._handle = handle;
            opened.Valid = true;
            return opened;
        }

        public void Dispose()
        {
            if (_handle != IntPtr.Zero)
            {
                ProcessNativeMethods.CloseHandle(_handle);
                _handle = IntPtr.Zero;
                Valid = false;
            }
        }
    }

    /// <summary>
    /// قياس واحد لحالة الابن. كل حقل نتيجة نداء، لا استنتاجًا من نداء آخر.
    /// </summary>
    internal sealed class ChildStateObservation
    {
        public string Label = "";
        public string At = "";
        public long MonotonicMicroseconds;
        public int ProcessId;

        public bool ProcessHandleValid;
        public int OpenProcessWin32Error;

        public bool ExitCodeQuerySucceeded;
        public int ExitCodeQueryWin32Error;
        public long ExitCode = -1;
        public bool ExitCodeIsStillActive;

        public string WaitResult = "NOT_QUERIED";
        public int WaitWin32Error;

        public bool JobMembershipQueried;
        public bool JobMembershipQuerySucceeded;
        public bool InJob;
        public int JobMembershipWin32Error;

        /// <summary>حيّ مُثبَتًا: لا استنتاجًا من وجود معرّف ولا من مضيّ زمن.</summary>
        public bool ObservedAlive;
        /// <summary>خرج مُثبَتًا: الكائن مُؤشَّر ورمز خروجه مقروء.</summary>
        public bool ObservedExited;
        /// <summary>لا هذا ولا ذاك: القياس نفسه لم ينجح. لا يُقرأ حياةً ولا موتًا.</summary>
        public bool StateUnproven;
        public string ReasonCode = "";

        public void Emit(JsonWriter json)
        {
            json.BeginObject();
            json.Property("label", Label);
            json.Property("at", At);
            json.Property("monotonic_us", MonotonicMicroseconds);
            json.Property("pid", ProcessId);
            json.Property("process_handle_valid", ProcessHandleValid);
            json.Property("open_process_win32_error", OpenProcessWin32Error);
            json.Property("get_exit_code_process_succeeded", ExitCodeQuerySucceeded);
            json.Property("get_exit_code_process_win32_error", ExitCodeQueryWin32Error);
            json.Property("exit_code", ExitCode);
            json.Property("exit_code_is_still_active", ExitCodeIsStillActive);
            json.Property("still_active_value", PanicStopNative.StillActive);
            json.Property("wait_for_single_object_0", WaitResult);
            json.Property("wait_win32_error", WaitWin32Error);
            json.Property("job_membership_queried", JobMembershipQueried);
            json.Property("is_process_in_job_succeeded", JobMembershipQuerySucceeded);
            json.Property("in_job", InJob);
            json.Property("is_process_in_job_win32_error", JobMembershipWin32Error);
            json.Property("observed_alive", ObservedAlive);
            json.Property("observed_exited", ObservedExited);
            json.Property("state_unproven", StateUnproven);
            json.Property("reason_code", ReasonCode);
            json.EndObject();
        }
    }

    /// <summary>
    /// محكّ الحياة الصريح.
    ///
    /// «حيّ» هنا يعني: كائن العملية مُؤشَّرٌ إليه بمقبض صالح، وGetExitCodeProcess
    /// نجحت، ورمزها STILL_ACTIVE، والانتظار بمهلة صفر عاد WAIT_TIMEOUT.
    ///
    /// الزوجُ ضروري لا زائد: STILL_ACTIVE قيمة رمز خروج مشروعة يمكن لعملية أن
    /// تخرج بها فعلًا، فتقرأ وحدها حياةً كاذبة. والانتظار يفصل: كائن عملية خرجت
    /// يكون مُؤشَّرًا فيعود WAIT_OBJECT_0. ولا يُقبل أحدهما بديلًا عن الآخر.
    ///
    /// وليس اسم العملية جزءًا من المحكّ: الملكية تُثبت بعضوية الـJob من النواة.
    /// </summary>
    internal static class ChildStateProbe
    {
        internal const string ReasonProven = "";
        internal const string ReasonHandleUnavailable = "CHILD_PROCESS_HANDLE_UNAVAILABLE";
        internal const string ReasonQueryFailed = "CHILD_STATE_QUERY_FAILED";

        public static ChildStateObservation Observe(
            string label, ChildHandle child, IntPtr jobHandle, PanicStopTimeline timeline)
        {
            ChildStateObservation observation = new ChildStateObservation();
            observation.Label = label;
            observation.At = DateTime.UtcNow.ToString(
                "yyyy-MM-ddTHH:mm:ss.fffZ", System.Globalization.CultureInfo.InvariantCulture);
            observation.MonotonicMicroseconds = timeline == null ? -1 : timeline.NowMicroseconds();
            observation.ProcessId = child == null ? 0 : child.ProcessId;

            if (child == null || !child.Valid)
            {
                observation.ProcessHandleValid = false;
                observation.OpenProcessWin32Error = child == null ? PanicStopNative.ErrorInvalidParameter : child.OpenWin32Error;
                observation.StateUnproven = true;
                observation.ReasonCode = ReasonHandleUnavailable;
                return observation;
            }

            observation.ProcessHandleValid = true;
            observation.OpenProcessWin32Error = child.OpenWin32Error;

            uint exitCode = 0;
            if (ProcessNativeMethods.GetExitCodeProcess(child.Handle, out exitCode))
            {
                observation.ExitCodeQuerySucceeded = true;
                observation.ExitCode = exitCode;
                observation.ExitCodeIsStillActive = exitCode == PanicStopNative.StillActive;
            }
            else
            {
                observation.ExitCodeQueryWin32Error = Marshal.GetLastWin32Error();
            }

            uint wait = ProcessNativeMethods.WaitForSingleObject(child.Handle, 0);
            observation.WaitResult = PanicStopNative.WaitResultName(wait);
            if (wait == PanicStopNative.WaitFailed)
            {
                observation.WaitWin32Error = Marshal.GetLastWin32Error();
            }

            if (jobHandle != IntPtr.Zero)
            {
                observation.JobMembershipQueried = true;
                bool inJob = false;
                if (PanicStopNative.IsProcessInJob(child.Handle, jobHandle, out inJob))
                {
                    observation.JobMembershipQuerySucceeded = true;
                    observation.InJob = inJob;
                }
                else
                {
                    observation.JobMembershipWin32Error = Marshal.GetLastWin32Error();
                }
            }

            bool alive = observation.ExitCodeQuerySucceeded
                && observation.ExitCodeIsStillActive
                && observation.WaitResult == "WAIT_TIMEOUT";
            bool exited = observation.WaitResult == "WAIT_OBJECT_0"
                && observation.ExitCodeQuerySucceeded
                && !observation.ExitCodeIsStillActive;

            observation.ObservedAlive = alive;
            observation.ObservedExited = exited;
            observation.StateUnproven = !alive && !exited;
            observation.ReasonCode = observation.StateUnproven ? ReasonQueryFailed : ReasonProven;
            return observation;
        }
    }
}
