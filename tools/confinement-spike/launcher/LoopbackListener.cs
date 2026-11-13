using System;
using System.Net;
using System.Net.Sockets;
using System.Threading;

namespace Polaris.ConfinementSpike.Launcher
{
    // مستمع محلي حقيقي. وجوده ضروري حتى لا يُفسَّر فشل اتصال loopback
    // بأنه غياب خدمة بدل أن يكون منعًا أمنيًا
    public sealed class LoopbackListener : IDisposable
    {
        private TcpListener _listener;
        private Thread _acceptThread;
        private volatile bool _running;

        public int Port { get; private set; }

        public void Start()
        {
            _listener = new TcpListener(IPAddress.Loopback, 0);
            _listener.Start();
            Port = ((IPEndPoint)_listener.LocalEndpoint).Port;
            _running = true;

            _acceptThread = new Thread(AcceptLoop);
            _acceptThread.IsBackground = true;
            _acceptThread.Start();
        }

        private void AcceptLoop()
        {
            while (_running)
            {
                try
                {
                    if (!_listener.Pending())
                    {
                        Thread.Sleep(50);
                        continue;
                    }
                    using (TcpClient client = _listener.AcceptTcpClient())
                    {
                        byte[] banner = System.Text.Encoding.ASCII.GetBytes("POLARIS_W1_LOOPBACK\n");
                        client.GetStream().Write(banner, 0, banner.Length);
                    }
                }
                catch (Exception)
                {
                    // إنهاء المستمع أثناء الانتظار يرمي استثناءً متوقعًا
                }
            }
        }

        public void Dispose()
        {
            _running = false;
            try { if (_listener != null) { _listener.Stop(); } } catch (Exception) { }
        }
    }
}
