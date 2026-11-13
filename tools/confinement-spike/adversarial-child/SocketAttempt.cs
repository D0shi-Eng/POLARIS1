using System;
using System.Net;
using System.Net.Sockets;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // محاولة اتصال واحدة مع تسجيل رمز خطأ المقبس الحقيقي.
    // التصنيف هنا خام فقط، والحكم النهائي يتم في الـ launcher بمقارنة خط الأساس
    internal static class SocketAttempt
    {
        public static ProbeOutcome Tcp(string id, string ipAddress, int port, string note)
        {
            IPAddress address;
            if (!IPAddress.TryParse(ipAddress, out address))
            {
                return new ProbeOutcome(id, "TCP connect " + ipAddress + ":" + port, OutcomeKind.Skipped, 0,
                    "NO_ADDRESS", "address unavailable: " + note);
            }

            Socket socket = null;
            try
            {
                socket = new Socket(address.AddressFamily, SocketType.Stream, ProtocolType.Tcp);
                IAsyncResult pending = socket.BeginConnect(new IPEndPoint(address, port), null, null);
                bool completed = pending.AsyncWaitHandle.WaitOne(NetworkTargets.ConnectTimeoutMilliseconds, false);
                if (!completed)
                {
                    return new ProbeOutcome(id, "TCP connect " + ipAddress + ":" + port, OutcomeKind.Error, 10060,
                        "WSAETIMEDOUT", "AMBIGUOUS timeout after " + NetworkTargets.ConnectTimeoutMilliseconds + "ms; " + note);
                }
                socket.EndConnect(pending);
                return new ProbeOutcome(id, "TCP connect " + ipAddress + ":" + port, OutcomeKind.Allow, 0,
                    "ERROR_SUCCESS", "connected; " + note);
            }
            catch (SocketException ex)
            {
                return Classify(id, "TCP connect " + ipAddress + ":" + port, ex, note);
            }
            catch (ObjectDisposedException)
            {
                return new ProbeOutcome(id, "TCP connect " + ipAddress + ":" + port, OutcomeKind.Error, 0,
                    "SOCKET_DISPOSED", note);
            }
            finally
            {
                if (socket != null) { try { socket.Close(); } catch (Exception) { } }
            }
        }

        public static ProbeOutcome Classify(string id, string attempt, SocketException ex, string note)
        {
            int code = ex.ErrorCode;
            string name = Win32ErrorNames.Resolve(code);
            string outcome;
            string qualifier;

            switch (code)
            {
                case 10013: // WSAEACCES
                    outcome = OutcomeKind.Deny;
                    qualifier = "UNAMBIGUOUS policy block at socket layer";
                    break;
                case 10051: // WSAENETUNREACH
                case 10065: // WSAEHOSTUNREACH
                    outcome = OutcomeKind.Deny;
                    qualifier = "AMBIGUOUS unreachable; correlate with baseline variant";
                    break;
                case 10061: // WSAECONNREFUSED
                    outcome = OutcomeKind.Deny;
                    qualifier = "AMBIGUOUS refused; may be policy block or absent listener";
                    break;
                case 10060: // WSAETIMEDOUT
                    outcome = OutcomeKind.Error;
                    qualifier = "AMBIGUOUS timeout";
                    break;
                default:
                    outcome = OutcomeKind.Error;
                    qualifier = "unclassified socket error";
                    break;
            }

            return new ProbeOutcome(id, attempt, outcome, code, name, qualifier + "; " + note);
        }
    }
}
