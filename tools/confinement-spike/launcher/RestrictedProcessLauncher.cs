using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.ConfinementSpike.Launcher
{
    // مسؤولية واحدة: إنشاء عملية بقائمة سمات موسعة ثم ضمها إلى Job قبل استئنافها.
    // الترتيب مهم: العملية تُنشأ معلّقة حتى لا تنفذ أي تعليمة خارج الـ job
    public sealed class RestrictedProcessLauncher
    {
        private const uint WaitTimeout = 0x00000102;

        public LaunchResult Launch(LaunchRequest request)
        {
            LaunchResult result = new LaunchResult();

            List<IntPtr> inheritable = CollectInheritableHandles(request);
            int attributeCount = (inheritable.Count > 0 ? 1 : 0)
                               + (request.Profile != null ? 1 : 0)
                               + (request.LessPrivilegedAppContainer ? 1 : 0);

            IntPtr attributeList = IntPtr.Zero;
            IntPtr handleArray = IntPtr.Zero;
            IntPtr capabilitiesBuffer = IntPtr.Zero;
            IntPtr lpacBuffer = IntPtr.Zero;

            try
            {
                if (attributeCount > 0)
                {
                    IntPtr size = IntPtr.Zero;
                    ProcessNativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, attributeCount, 0, ref size);
                    attributeList = Marshal.AllocHGlobal(size);
                    if (!ProcessNativeMethods.InitializeProcThreadAttributeList(attributeList, attributeCount, 0, ref size))
                    {
                        result.ErrorCode = Marshal.GetLastWin32Error();
                        result.FailureStage = "InitializeProcThreadAttributeList";
                        return result;
                    }

                    if (inheritable.Count > 0)
                    {
                        handleArray = Marshal.AllocHGlobal(IntPtr.Size * inheritable.Count);
                        for (int i = 0; i < inheritable.Count; i++)
                        {
                            Marshal.WriteIntPtr(handleArray, i * IntPtr.Size, inheritable[i]);
                        }
                        if (!ProcessNativeMethods.UpdateProcThreadAttribute(
                                attributeList, 0, ProcessNativeMethods.PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                                handleArray, new IntPtr(IntPtr.Size * inheritable.Count), IntPtr.Zero, IntPtr.Zero))
                        {
                            result.ErrorCode = Marshal.GetLastWin32Error();
                            result.FailureStage = "UpdateProcThreadAttribute(HANDLE_LIST)";
                            return result;
                        }
                    }

                    if (request.Profile != null)
                    {
                        ProcessNativeMethods.SECURITY_CAPABILITIES capabilities =
                            new ProcessNativeMethods.SECURITY_CAPABILITIES();
                        capabilities.AppContainerSid = request.Profile.Sid;
                        capabilities.Capabilities = request.Capabilities != null ? request.Capabilities.Pointer : IntPtr.Zero;
                        capabilities.CapabilityCount = request.Capabilities != null ? request.Capabilities.Count : 0;
                        capabilities.Reserved = 0;

                        int capabilitiesSize = Marshal.SizeOf(typeof(ProcessNativeMethods.SECURITY_CAPABILITIES));
                        capabilitiesBuffer = Marshal.AllocHGlobal(capabilitiesSize);
                        Marshal.StructureToPtr(capabilities, capabilitiesBuffer, false);

                        if (!ProcessNativeMethods.UpdateProcThreadAttribute(
                                attributeList, 0, ProcessNativeMethods.PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                                capabilitiesBuffer, new IntPtr(capabilitiesSize), IntPtr.Zero, IntPtr.Zero))
                        {
                            result.ErrorCode = Marshal.GetLastWin32Error();
                            result.FailureStage = "UpdateProcThreadAttribute(SECURITY_CAPABILITIES)";
                            return result;
                        }
                    }

                    if (request.LessPrivilegedAppContainer)
                    {
                        lpacBuffer = Marshal.AllocHGlobal(sizeof(uint));
                        Marshal.WriteInt32(lpacBuffer, (int)ProcessNativeMethods.PROCESS_CREATION_ALL_APPLICATION_PACKAGES_OPT_OUT);
                        if (!ProcessNativeMethods.UpdateProcThreadAttribute(
                                attributeList, 0, ProcessNativeMethods.PROC_THREAD_ATTRIBUTE_ALL_APPLICATION_PACKAGES_POLICY,
                                lpacBuffer, new IntPtr(sizeof(uint)), IntPtr.Zero, IntPtr.Zero))
                        {
                            result.ErrorCode = Marshal.GetLastWin32Error();
                            result.FailureStage = "UpdateProcThreadAttribute(ALL_APPLICATION_PACKAGES_POLICY)";
                            return result;
                        }
                    }
                }

                return CreateAndRun(request, attributeList, inheritable.Count > 0, result);
            }
            finally
            {
                if (attributeList != IntPtr.Zero)
                {
                    ProcessNativeMethods.DeleteProcThreadAttributeList(attributeList);
                    Marshal.FreeHGlobal(attributeList);
                }
                if (handleArray != IntPtr.Zero) { Marshal.FreeHGlobal(handleArray); }
                if (capabilitiesBuffer != IntPtr.Zero) { Marshal.FreeHGlobal(capabilitiesBuffer); }
                if (lpacBuffer != IntPtr.Zero) { Marshal.FreeHGlobal(lpacBuffer); }
            }
        }

        private static List<IntPtr> CollectInheritableHandles(LaunchRequest request)
        {
            List<IntPtr> handles = new List<IntPtr>();
            if (request.StandardOutputHandle != IntPtr.Zero) { handles.Add(request.StandardOutputHandle); }
            if (request.StandardErrorHandle != IntPtr.Zero && request.StandardErrorHandle != request.StandardOutputHandle)
            {
                handles.Add(request.StandardErrorHandle);
            }
            if (request.LeakedHandle != IntPtr.Zero) { handles.Add(request.LeakedHandle); }
            return handles;
        }

        private LaunchResult CreateAndRun(LaunchRequest request, IntPtr attributeList, bool inheritHandles, LaunchResult result)
        {
            ProcessNativeMethods.STARTUPINFOEX startupInfo = new ProcessNativeMethods.STARTUPINFOEX();
            startupInfo.StartupInfo.cb = Marshal.SizeOf(typeof(ProcessNativeMethods.STARTUPINFOEX));
            startupInfo.lpAttributeList = attributeList;
            if (inheritHandles)
            {
                startupInfo.StartupInfo.dwFlags = ProcessNativeMethods.STARTF_USESTDHANDLES;
                startupInfo.StartupInfo.hStdOutput = request.StandardOutputHandle;
                startupInfo.StartupInfo.hStdError = request.StandardErrorHandle;
                startupInfo.StartupInfo.hStdInput = IntPtr.Zero;
            }

            uint flags = ProcessNativeMethods.CREATE_SUSPENDED | ProcessNativeMethods.CREATE_NO_WINDOW;
            if (attributeList != IntPtr.Zero)
            {
                flags |= ProcessNativeMethods.EXTENDED_STARTUPINFO_PRESENT;
            }

            string commandLine = "\"" + request.ExecutablePath + "\" " + request.Arguments;
            ProcessNativeMethods.PROCESS_INFORMATION processInformation;

            bool created = ProcessNativeMethods.CreateProcessW(
                null, commandLine, IntPtr.Zero, IntPtr.Zero, inheritHandles, flags,
                IntPtr.Zero, request.WorkingDirectory, ref startupInfo, out processInformation);

            if (!created)
            {
                result.Created = false;
                result.ErrorCode = Marshal.GetLastWin32Error();
                result.FailureStage = "CreateProcessW";
                return result;
            }

            try
            {
                if (request.JobHandle != IntPtr.Zero)
                {
                    result.AssignedToJob = JobNativeMethods.AssignProcessToJobObject(
                        request.JobHandle, processInformation.hProcess);
                    if (!result.AssignedToJob)
                    {
                        result.JobAssignError = Marshal.GetLastWin32Error();
                    }
                }

                ProcessNativeMethods.ResumeThread(processInformation.hThread);
                result.Created = true;
                result.ProcessId = processInformation.dwProcessId;

                uint wait = ProcessNativeMethods.WaitForSingleObject(
                    processInformation.hProcess, (uint)request.TimeoutMilliseconds);
                if (wait == WaitTimeout)
                {
                    result.TimedOut = true;
                    ProcessNativeMethods.TerminateProcess(processInformation.hProcess, 258);
                }
                else
                {
                    uint exitCode;
                    ProcessNativeMethods.GetExitCodeProcess(processInformation.hProcess, out exitCode);
                    result.ExitCode = exitCode;
                }
                return result;
            }
            finally
            {
                ProcessNativeMethods.CloseHandle(processInformation.hThread);
                ProcessNativeMethods.CloseHandle(processInformation.hProcess);
            }
        }
    }
}
