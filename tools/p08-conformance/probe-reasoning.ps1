# POLARIS Phase-08 remediation - diagnostic: how the local model's hidden reasoning consumes the output budget.
# Development aid only; writes evidence\p08-native\reasoning-probe.local.json. Model-neutral: it probes the
# standard OpenAI-compatible request fields, it names no model family.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:1234'
$out = 'D:\POLARIS\evidence\p08-native\reasoning-probe.local.json'
$models = Invoke-RestMethod -Uri "$base/api/v0/models" -TimeoutSec 30
$model = ($models.data | Where-Object { $_.id -like '*27b*' -and $_.state -eq 'loaded' } | Select-Object -First 1)
if ($null -eq $model) { $model = ($models.data | Where-Object { $_.type -eq 'llm' } | Select-Object -First 1) }
$prompt = 'Analyse this CSV with Python: month,riyadh,jeddah,dammam / Jan,120,95,60 / Feb,135,90,72. Reply with one JSON object {"output_summary": str, "tools": [{"tool_id":"polaris.execution.python","arguments":{"code": str}}]} whose code prints the total per region.'
function Probe([hashtable] $extra, [string] $label) {
  $body = @{ model = $model.id; stream = $true; temperature = 0; max_tokens = 4096; messages = @(@{ role = 'system'; content = 'You are an agent. Reply with exactly one JSON object.' }, @{ role = 'user'; content = $prompt }) }
  foreach ($k in $extra.Keys) { $body[$k] = $extra[$k] }
  $json = $body | ConvertTo-Json -Depth 8 -Compress
  $req = [System.Net.HttpWebRequest]::Create("$base/v1/chat/completions")
  $req.Method = 'POST'; $req.ContentType = 'application/json'; $req.Timeout = 900000; $req.ReadWriteTimeout = 900000
  $bytes = [Text.Encoding]::UTF8.GetBytes($json); $s = $req.GetRequestStream(); $s.Write($bytes, 0, $bytes.Length); $s.Close()
  $sw = [Diagnostics.Stopwatch]::StartNew(); $first = $null
  $resp = $req.GetResponse(); $reader = New-Object IO.StreamReader($resp.GetResponseStream())
  $content = 0; $reasoning = 0; $finish = ''; $keys = @{}; $usage = $null; $sample = ''
  while (-not $reader.EndOfStream) {
    $line = $reader.ReadLine()
    if (-not $line.StartsWith('data: ')) { continue }
    $data = $line.Substring(6); if ($data -eq '[DONE]') { break }
    if ($null -eq $first) { $first = $sw.ElapsedMilliseconds }
    $c = $data | ConvertFrom-Json
    if ($c.usage) { $usage = $c.usage }
    foreach ($ch in $c.choices) {
      if ($ch.finish_reason) { $finish = $ch.finish_reason }
      $d = $ch.delta
      if ($null -eq $d) { continue }
      foreach ($p in $d.PSObject.Properties) { $keys[$p.Name] = $true }
      if ($d.content) { $content += $d.content.Length; if ($sample.Length -lt 200) { $sample += $d.content } }
      if ($d.reasoning_content) { $reasoning += $d.reasoning_content.Length }
      if ($d.reasoning) { $reasoning += $d.reasoning.Length }
    }
  }
  [ordered] @{ label = $label; extra = $extra; ms = $sw.ElapsedMilliseconds; first_chunk_ms = $first; content_chars = $content; reasoning_chars = $reasoning; finish = $finish; delta_keys = @($keys.Keys); usage = $usage; content_sample = $sample }
}
$results = @()
foreach ($v in @(@(@{}, 'default'), @(@{ reasoning_effort = 'low' }, 'reasoning_effort=low'), @(@{ reasoning_effort = 'none' }, 'reasoning_effort=none'))) {
  try { $results += Probe $v[0] $v[1] } catch { $results += [ordered] @{ label = $v[1]; error = $_.Exception.Message } }
}
$record = [ordered] @{ measured_at = (Get-Date).ToUniversalTime().ToString('o'); model = $model.id; model_entry = $model; results = $results } 
[System.IO.File]::WriteAllText($out, ($record | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
