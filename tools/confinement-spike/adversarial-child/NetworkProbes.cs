using System;
using System.Net;
using System.Net.Sockets;
using System.Text;
using Polaris.ConfinementSpike.Shared;

namespace Polaris.ConfinementSpike.Child
{
    // محاولات الخروج الشبكي.
    // ترتيب التنفيذ مقصود: نبدأ بـ DNS حتى نستطيع نسب أي فشل لاحق إلى سببه الصحيح
    internal static class NetworkProbes
    {
        public static void Run(ProbeContext context, OutcomeRecorder recorder)
        {
            string resolvedAddress = null;
            recorder.Add(ResolveHostname(NetworkTargets.AllowedCandidateHost, out resolvedAddress));

            // N01: المنع الافتراضي للخروج، بعنوان IP مباشر بلا اعتماد على DNS
            recorder.Add(SocketAttempt.Tcp("N01", NetworkTargets.NeutralIp, NetworkTargets.HttpsPort,
                "default-deny egress check, no DNS involved"));

            // N02: حلقة الاسترجاع المحلية مقابل مستمع أنشأه الـ launcher
            if (context.LoopbackPort > 0)
            {
                recorder.Add(SocketAttempt.Tcp("N02", "127.0.0.1", context.LoopbackPort,
                    "launcher listener is confirmed running on this port"));
            }
            else
            {
                recorder.Add(new ProbeOutcome("N02", "TCP connect loopback", OutcomeKind.Skipped, 0, "NO_LISTENER",
                    "launcher did not provide a loopback port"));
            }

            // N03: النقطة التي نرغب بالسماح بها
            if (resolvedAddress != null)
            {
                recorder.Add(SocketAttempt.Tcp("N03", resolvedAddress, NetworkTargets.HttpsPort,
                    "policy-allowed candidate " + NetworkTargets.AllowedCandidateHost));
            }
            else
            {
                recorder.Add(new ProbeOutcome("N03", "TCP connect allowed candidate", OutcomeKind.Skipped, 0,
                    "DNS_FAILED", "cannot test destination allow without resolution"));
            }

            // N04: النقطة التي نرغب بمنعها. تساوي نتيجتها مع N03 يعني غياب تحكم بالوجهة
            recorder.Add(SocketAttempt.Tcp("N04", NetworkTargets.DisallowedCandidateIp, NetworkTargets.HttpsPort,
                "policy-disallowed candidate; equal result to N03 proves no destination control"));

            // N06: الوصول بعنوان IP مباشر لنفس المضيف، تجاوزًا لأي سياسة تعتمد على الاسم
            if (resolvedAddress != null)
            {
                recorder.Add(SocketAttempt.Tcp("N06", resolvedAddress, NetworkTargets.HttpsPort,
                    "same host by literal IP, bypassing any hostname-based policy"));
            }
            else
            {
                recorder.Add(new ProbeOutcome("N06", "TCP connect literal IP", OutcomeKind.Skipped, 0, "DNS_FAILED",
                    "no resolved address to reuse"));
            }

            // N07: منفذ بديل
            recorder.Add(SocketAttempt.Tcp("N07", NetworkTargets.NeutralIp, NetworkTargets.DnsPort,
                "alternate port check"));

            // N08: بروتوكول UDP
            recorder.Add(UdpProbe());
        }

        // N05: سلوك تحويل الأسماء. يُسجَّل منفصلًا حتى لا يُخلط فشل DNS بفشل سياسة الخروج
        private static ProbeOutcome ResolveHostname(string hostname, out string firstAddress)
        {
            firstAddress = null;
            try
            {
                IPAddress[] addresses = Dns.GetHostAddresses(hostname);
                if (addresses == null || addresses.Length == 0)
                {
                    return new ProbeOutcome("N05", "Dns.GetHostAddresses " + hostname, OutcomeKind.Deny, 11004,
                        "WSANO_DATA", "resolver returned no addresses");
                }

                StringBuilder builder = new StringBuilder();
                for (int i = 0; i < addresses.Length && i < 4; i++)
                {
                    if (addresses[i].AddressFamily == AddressFamily.InterNetwork && firstAddress == null)
                    {
                        firstAddress = addresses[i].ToString();
                    }
                    if (builder.Length > 0) { builder.Append(','); }
                    builder.Append(addresses[i].ToString());
                }

                return new ProbeOutcome("N05", "Dns.GetHostAddresses " + hostname, OutcomeKind.Allow, 0,
                    "ERROR_SUCCESS", "addresses=" + builder.ToString());
            }
            catch (SocketException ex)
            {
                return SocketAttempt.Classify("N05", "Dns.GetHostAddresses " + hostname, ex,
                    "name resolution path, served by the DNS Client service not a raw socket");
            }
        }

        private static ProbeOutcome UdpProbe()
        {
            UdpClient client = null;
            try
            {
                client = new UdpClient();
                client.Client.ReceiveTimeout = NetworkTargets.ConnectTimeoutMilliseconds;
                // استعلام DNS بسيط عن example.com من النوع A
                byte[] query = BuildDnsQuery();
                client.Send(query, query.Length, NetworkTargets.NeutralIp, NetworkTargets.DnsPort);
                IPEndPoint remote = new IPEndPoint(IPAddress.Any, 0);
                byte[] response = client.Receive(ref remote);
                return new ProbeOutcome("N08", "UDP sendto " + NetworkTargets.NeutralIp + ":53", OutcomeKind.Allow, 0,
                    "ERROR_SUCCESS", "response_bytes=" + response.Length);
            }
            catch (SocketException ex)
            {
                return SocketAttempt.Classify("N08", "UDP sendto " + NetworkTargets.NeutralIp + ":53", ex,
                    "raw UDP egress");
            }
            finally
            {
                if (client != null) { try { client.Close(); } catch (Exception) { } }
            }
        }

        private static byte[] BuildDnsQuery()
        {
            byte[] header = new byte[] { 0x2b, 0x17, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 };
            byte[] name = new byte[] { 7, (byte)'e', (byte)'x', (byte)'a', (byte)'m', (byte)'p', (byte)'l', (byte)'e',
                3, (byte)'c', (byte)'o', (byte)'m', 0 };
            byte[] tail = new byte[] { 0x00, 0x01, 0x00, 0x01 };
            byte[] query = new byte[header.Length + name.Length + tail.Length];
            Buffer.BlockCopy(header, 0, query, 0, header.Length);
            Buffer.BlockCopy(name, 0, query, header.Length, name.Length);
            Buffer.BlockCopy(tail, 0, query, header.Length + name.Length, tail.Length);
            return query;
        }
    }
}
