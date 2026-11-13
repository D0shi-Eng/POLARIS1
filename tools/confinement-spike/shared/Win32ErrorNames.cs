using System.Collections.Generic;
using System.Globalization;

namespace Polaris.ConfinementSpike.Shared
{
    // تحويل رقم خطأ Windows إلى اسم رمزي مقروء، لأن الأدلة يجب أن توضح سبب المنع لا مجرد رقم
    public static class Win32ErrorNames
    {
        private static readonly Dictionary<int, string> Names = Build();

        private static Dictionary<int, string> Build()
        {
            Dictionary<int, string> map = new Dictionary<int, string>();
            map[0] = "ERROR_SUCCESS";
            map[2] = "ERROR_FILE_NOT_FOUND";
            map[3] = "ERROR_PATH_NOT_FOUND";
            map[5] = "ERROR_ACCESS_DENIED";
            map[6] = "ERROR_INVALID_HANDLE";
            map[8] = "ERROR_NOT_ENOUGH_MEMORY";
            map[19] = "ERROR_WRITE_PROTECT";
            map[32] = "ERROR_SHARING_VIOLATION";
            map[50] = "ERROR_NOT_SUPPORTED";
            map[53] = "ERROR_BAD_NETPATH";
            map[64] = "ERROR_NETNAME_DELETED";
            map[67] = "ERROR_BAD_NET_NAME";
            map[87] = "ERROR_INVALID_PARAMETER";
            map[123] = "ERROR_INVALID_NAME";
            map[183] = "ERROR_ALREADY_EXISTS";
            map[267] = "ERROR_DIRECTORY";
            map[740] = "ERROR_ELEVATION_REQUIRED";
            map[1314] = "ERROR_PRIVILEGE_NOT_HELD";
            map[1326] = "ERROR_LOGON_FAILURE";
            map[1816] = "ERROR_NOT_ENOUGH_QUOTA";
            map[1812] = "ERROR_RESOURCE_DATA_NOT_FOUND";
            map[10013] = "WSAEACCES";
            map[10049] = "WSAEADDRNOTAVAIL";
            map[10051] = "WSAENETUNREACH";
            map[10054] = "WSAECONNRESET";
            map[10060] = "WSAETIMEDOUT";
            map[10061] = "WSAECONNREFUSED";
            map[11001] = "WSAHOST_NOT_FOUND";
            map[11002] = "WSATRY_AGAIN";
            map[11004] = "WSANO_DATA";
            return map;
        }

        public static string Resolve(int code)
        {
            string name;
            if (Names.TryGetValue(code, out name))
            {
                return name;
            }
            return "WIN32_" + code.ToString(CultureInfo.InvariantCulture);
        }
    }
}
