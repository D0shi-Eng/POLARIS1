# مراحل القياس الأصلي لسطح المكتب.
#
# ما يُقاس هنا لا يُقاس في أي مكان آخر: إطلاق حقيقي، ونافذة حقيقية، وWebView2
# حقيقي، وخروج حقيقي. وما يمكن قياسه بلا Win32 يُقاس بلا Win32 عمدًا — استدعاء
# أصلي لا يمكن التحقق منه قبل التشغيل هو أكبر مصدر فشل في هذا الملف، فحُصر في
# دالة واحدة، وفشلها يُصنَّف BLOCKED ولا يُسقط التشغيل كله.
#
# الترميز: ASCII في كل سطر تنفيذي. العربية في التعليقات وحدها. هذا ليس ذوقًا:
# محرف واحد غير ASCII داخل نص مُقتبَس هو ما أوقف P01-W2، والحارس
# tools/p01-conformance/ascii-discipline.mjs يمنع تكراره.

Set-StrictMode -Version Latest

$script:Win32Ready = $false
$script:Win32Error = ''

<#
  الجزء الوحيد الذي يحتاج Win32. معزول ومحاط بـtry حتى يكون فشله نتيجة مصنّفة
  لا انهيارًا: قياس هندسة النافذة أقل أهمية من بقية التشغيل.
#>
function Initialize-PolarisWindowInterop {
  if ($script:Win32Ready) { return $true }
  try {
    $source = @'
using System;
using System.Runtime.InteropServices;

public static class PolarisWindowInterop
{
    [StructLayout(LayoutKind.Sequential)]
    public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    public struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public int dwFlags; }

    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr hWnd, uint dwFlags);
    [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    public static int[] Rect(IntPtr handle)
    {
        RECT r;
        if (!GetWindowRect(handle, out r)) { return new int[0]; }
        return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }

    public static int[] MonitorRect(IntPtr handle)
    {
        IntPtr monitor = MonitorFromWindow(handle, 2);
        MONITORINFO info = new MONITORINFO();
        info.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
        if (!GetMonitorInfo(monitor, ref info)) { return new int[0]; }
        RECT r = info.rcWork;
        return new int[] { r.Left, r.Top, r.Right - r.Left, r.Bottom - r.Top };
    }

    public static bool Resize(IntPtr handle, int width, int height)
    {
        return SetWindowPos(handle, IntPtr.Zero, 0, 0, width, height, 0x0002 | 0x0004 | 0x0010);
    }

    public static bool Maximize(IntPtr handle) { return ShowWindow(handle, 3); }
    public static bool Restore(IntPtr handle) { return ShowWindow(handle, 9); }
    public static bool Zoomed(IntPtr handle) { return IsZoomed(handle); }
    public static bool Visible(IntPtr handle) { return IsWindowVisible(handle); }
}
'@
    Add-Type -TypeDefinition $source -Language CSharp -ErrorAction Stop
    $script:Win32Ready = $true
    return $true
  }
  catch {
    $script:Win32Error = $_.Exception.Message
    $script:Win32Ready = $false
    return $false
  }
}

<#
  ينتظر ظهور ملف ثم قراءته كـJSON صالح. الانتظار على المحتوى لا على الوجود:
  ملف نصف مكتوب يوجد ولا يُقرأ.
#>
function Wait-PolarisJsonFile {
  param(
    [Parameter(Mandatory = $true)][string] $Path,
    [int] $TimeoutSeconds = 60
  )
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if (Test-Path -LiteralPath $Path) {
      try {
        $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 -ErrorAction Stop
        if (-not [string]::IsNullOrWhiteSpace($raw)) {
          return ($raw | ConvertFrom-Json)
        }
      }
      catch {
        # ملف قيد الكتابة. نعيد المحاولة.
      }
    }
    Start-Sleep -Milliseconds 200
  }
  return $null
}

<#
  يفتح التطبيق ويقيس ما يمكن قياسه من خارج النافذة.

  ترتيب القياس مقصود: زمن بدء العملية أولا، ثم ظهور النافذة، ثم وصول تقرير
  المضيف. كل رقم يحمل مصدره، ولا رقم يُقدَّر ثم يُكتب كأنه مقيس.
#>
function Invoke-PolarisLaunchProbe {
  param(
    [Parameter(Mandatory = $true)][string] $ExecutablePath,
    [Parameter(Mandatory = $true)][string] $ReportPath,
    [hashtable] $Environment = @{},
    [int] $TimeoutSeconds = 90,
    [int] $ForbiddenPort = 0,
    [switch] $ProbeWindow
  )

  $record = [ordered] @{
    executable          = $ExecutablePath
    started             = $false
    window_appeared     = $false
    window_title        = ''
    process_exited      = $false
    exit_code           = $null
    orphan_processes    = 0
    startup_report      = $null
    e2e_report          = $null
    measurements        = [ordered] @{}
    window              = [ordered] @{ status = 'NOT_TESTED'; reason = 'NOT_REQUESTED' }
    dev_server_port     = $ForbiddenPort
    dev_server_listening = $null
    reason_codes        = @()
  }

  if (-not (Test-Path -LiteralPath $ExecutablePath)) {
    $record.reason_codes += 'EXECUTABLE_MISSING'
    return $record
  }

  if (Test-Path -LiteralPath $ReportPath) { Remove-Item -LiteralPath $ReportPath -Force }
  $e2ePath = [System.IO.Path]::Combine(
    [System.IO.Path]::GetDirectoryName($ReportPath),
    ([System.IO.Path]::GetFileNameWithoutExtension($ReportPath) + '-e2e.json'))
  if (Test-Path -LiteralPath $e2ePath) { Remove-Item -LiteralPath $e2ePath -Force }

  foreach ($key in $Environment.Keys) {
    Set-Item -Path ("Env:" + $key) -Value $Environment[$key]
  }

  # الإثبات المستقل: لا مستمع على منفذ خادم التطوير لحظة الإطلاق. يُرصد فقط،
  # ولا يُغلق شيء لا تملكه هذه العملية.
  if ($ForbiddenPort -gt 0) {
    try {
      $listeners = @(Get-NetTCPConnection -LocalPort $ForbiddenPort -State Listen -ErrorAction Stop)
      $record.dev_server_listening = ($listeners.Count -gt 0)
    }
    catch {
      # لا اتصال على المنفذ يرمي هنا أيضًا؛ نفرّقه عن غياب الأمر نفسه.
      if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) { $record.dev_server_listening = $false }
      else { $record.reason_codes += 'LISTENER_PROBE_UNAVAILABLE' }
    }
    if ($record.dev_server_listening -eq $true) { $record.reason_codes += 'DEV_SERVER_LISTENING_AT_LAUNCH' }
  }

  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $process = Start-Process -FilePath $ExecutablePath -PassThru
  $record.started = $true

  # ظهور النافذة: مقاس من مقبض النافذة الرئيسية، بلا استدعاء أصلي.
  $windowDeadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $windowDeadline) {
    $process.Refresh()
    if ($process.HasExited) { break }
    if ($process.MainWindowHandle -ne [System.IntPtr]::Zero) {
      $record.window_appeared = $true
      $record.window_title = [string] $process.MainWindowTitle
      $record.measurements.window_visible_ms = [int] $clock.Elapsed.TotalMilliseconds
      break
    }
    Start-Sleep -Milliseconds 100
  }

  $startup = Wait-PolarisJsonFile -Path $ReportPath -TimeoutSeconds $TimeoutSeconds
  if ($null -ne $startup) {
    $record.startup_report = $startup
    $record.measurements.host_measured_renderer_first_request_ms = $startup.renderer_first_request_ms
    $record.measurements.host_measured_bootstrap_request_ms = $startup.bootstrap_request_ms
    $record.measurements.host_measured_bootstrap_handle_ms = $startup.bootstrap_handle_ms
    $record.measurements.cold_start_to_bootstrap_ms = [int] $clock.Elapsed.TotalMilliseconds
  }
  else {
    $record.reason_codes += 'STARTUP_REPORT_ABSENT'
  }

  if ($ProbeWindow -and $record.window_appeared) {
    $record.window = Measure-PolarisWindow -Handle $process.MainWindowHandle
  }

  # تقرير E2E إن كان الثنائي يحمل أداة القياس.
  $e2e = Wait-PolarisJsonFile -Path $e2ePath -TimeoutSeconds 45
  if ($null -ne $e2e) { $record.e2e_report = $e2e }

  # الخروج: الإغلاق المهذب أولا، ثم الإنهاء إن لزم. التمييز بينهما هو الادعاء.
  $closed = $false
  try { $closed = $process.CloseMainWindow() } catch { $closed = $false }
  if ($closed) { [void] $process.WaitForExit(15000) }
  $process.Refresh()
  if (-not $process.HasExited) {
    $record.reason_codes += 'WINDOW_CLOSE_DID_NOT_EXIT'
    try { $process.Kill() } catch { }
    [void] $process.WaitForExit(10000)
  }
  $process.Refresh()
  $record.process_exited = $process.HasExited
  if ($process.HasExited) {
    try { $record.exit_code = $process.ExitCode } catch { $record.exit_code = $null }
    $record.measurements.exit_ms = [int] $clock.Elapsed.TotalMilliseconds
  }

  Start-Sleep -Milliseconds 800
  $leafName = [System.IO.Path]::GetFileNameWithoutExtension($ExecutablePath)
  $survivors = @(Get-Process -Name $leafName -ErrorAction SilentlyContinue)
  $record.orphan_processes = $survivors.Count
  if ($survivors.Count -gt 0) { $record.reason_codes += 'ORPHAN_PROCESS_SURVIVED' }

  foreach ($key in $Environment.Keys) {
    Remove-Item -Path ("Env:" + $key) -ErrorAction SilentlyContinue
  }

  return $record
}

<#
  هندسة النافذة: الحد الادنى، والتكبير، والاستعادة، والبقاء داخل الشاشة.
#>
function Measure-PolarisWindow {
  param([Parameter(Mandatory = $true)] $Handle)

  if (-not (Initialize-PolarisWindowInterop)) {
    return [ordered] @{
      status = 'BLOCKED'
      reason = 'WINDOW_INTEROP_UNAVAILABLE'
      detail = $script:Win32Error
    }
  }

  $result = [ordered] @{ status = 'MEASURED'; reason = '' }
  try {
    $initial = [PolarisWindowInterop]::Rect($Handle)
    $result.initial_rect = $initial
    $result.visible = [PolarisWindowInterop]::Visible($Handle)

    $monitor = [PolarisWindowInterop]::MonitorRect($Handle)
    $result.monitor_work_rect = $monitor
    if ($monitor.Length -eq 4 -and $initial.Length -eq 4) {
      $result.on_screen = ($initial[0] -lt ($monitor[0] + $monitor[2])) -and
                          (($initial[0] + $initial[2]) -gt $monitor[0]) -and
                          ($initial[1] -lt ($monitor[1] + $monitor[3])) -and
                          (($initial[1] + $initial[3]) -gt $monitor[1])
    }
    else {
      $result.on_screen = $null
    }

    # الحد الادنى: نطلب حجما اصغر منه ونقرأ ما استقر عليه النظام فعلا.
    [void] [PolarisWindowInterop]::Resize($Handle, 400, 300)
    Start-Sleep -Milliseconds 400
    $clamped = [PolarisWindowInterop]::Rect($Handle)
    $result.after_undersize_rect = $clamped
    if ($clamped.Length -eq 4) {
      $result.min_width_enforced = ($clamped[2] -ge 940)
      $result.min_height_enforced = ($clamped[3] -ge 620)
    }

    [void] [PolarisWindowInterop]::Maximize($Handle)
    Start-Sleep -Milliseconds 500
    $result.maximized = [PolarisWindowInterop]::Zoomed($Handle)
    $result.maximized_rect = [PolarisWindowInterop]::Rect($Handle)

    [void] [PolarisWindowInterop]::Restore($Handle)
    Start-Sleep -Milliseconds 500
    $result.restored = (-not [PolarisWindowInterop]::Zoomed($Handle))
    $restoredRect = [PolarisWindowInterop]::Rect($Handle)
    $result.restored_rect = $restoredRect
    if ($restoredRect.Length -eq 4 -and $monitor.Length -eq 4) {
      $result.restored_on_screen = ($restoredRect[0] -lt ($monitor[0] + $monitor[2])) -and
                                   (($restoredRect[0] + $restoredRect[2]) -gt $monitor[0]) -and
                                   ($restoredRect[1] -lt ($monitor[1] + $monitor[3])) -and
                                   (($restoredRect[1] + $restoredRect[3]) -gt $monitor[1])
    }
  }
  catch {
    $result.status = 'BLOCKED'
    $result.reason = 'WINDOW_MEASUREMENT_FAILED'
    $result.detail = $_.Exception.Message
  }
  return $result
}
