using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using Polaris.ConfinementSpike.Launcher.Native;

namespace Polaris.ConfinementSpike.Launcher
{
    // يبني مصفوفة القدرات بصيغة غير مُدارة كما تتطلبها SECURITY_CAPABILITIES
    public sealed class CapabilitySet : IDisposable
    {
        private readonly List<IntPtr> _sids = new List<IntPtr>();
        private IntPtr _array = IntPtr.Zero;
        private uint _count;

        public IntPtr Pointer { get { return _array; } }
        public uint Count { get { return _count; } }

        public static CapabilitySet FromStringSids(string[] capabilitySids)
        {
            CapabilitySet set = new CapabilitySet();
            if (capabilitySids == null || capabilitySids.Length == 0)
            {
                return set;
            }

            int entrySize = Marshal.SizeOf(typeof(ProcessNativeMethods.SID_AND_ATTRIBUTES));
            set._array = Marshal.AllocHGlobal(entrySize * capabilitySids.Length);

            for (int i = 0; i < capabilitySids.Length; i++)
            {
                IntPtr sid;
                if (!AppContainerNativeMethods.ConvertStringSidToSidW(capabilitySids[i], out sid))
                {
                    throw new InvalidOperationException("ConvertStringSidToSid failed for " + capabilitySids[i]);
                }
                set._sids.Add(sid);

                ProcessNativeMethods.SID_AND_ATTRIBUTES entry = new ProcessNativeMethods.SID_AND_ATTRIBUTES();
                entry.Sid = sid;
                entry.Attributes = ProcessNativeMethods.SE_GROUP_ENABLED;
                Marshal.StructureToPtr(entry, new IntPtr(set._array.ToInt64() + (i * entrySize)), false);
            }

            set._count = (uint)capabilitySids.Length;
            return set;
        }

        public void Dispose()
        {
            for (int i = 0; i < _sids.Count; i++)
            {
                AppContainerNativeMethods.LocalFree(_sids[i]);
            }
            _sids.Clear();

            if (_array != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(_array);
                _array = IntPtr.Zero;
            }
            _count = 0;
        }
    }
}
