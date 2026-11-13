# POLARIS Phase-08 remediation - diagnostic: does provider-side structured output (json_schema) keep replies syntactically valid.
# Development aid only; writes evidence\p08-native\jsonschema-probe.local.json. Model-neutral: it probes the
# standard OpenAI-compatible request fields, it names no model family.
$ErrorActionPreference = 'Stop'
$base = 'http://127.0.0.1:1234'
$out = 'D:\POLARIS\evidence\p08-native\jsonschema-probe.local.json'
$models = Invoke-RestMethod -Uri "$base/api/v0/models" -TimeoutSec 30
$model = ($models.data | Where-Object { $_.id -like '*27b*' -and $_.state -eq 'loaded' } | Select-Object -First 1)
if ($null -eq $model) { $model = ($models.data | Where-Object { $_.type -eq 'llm' } | Select-Object -First 1) }
$prompt = 'Analyse this CSV with Python: month,riyadh,jeddah,dammam / Jan,120,95,60 / Feb,135,90,72. Reply with one JSON object {"output_summary": str, "tools": [{"skill_id":"polaris.skill.agentic-work","tool_id":"polaris.execution.python","arguments":{"code": str},"reason": str,"expected_output": str}, {"skill_id":"polaris.skill.agentic-work","tool_id":"polaris.artifact.document","arguments":{"format":"docx","path":"outputs/r.docx","spec":{"title": str,"blocks":[{"type":"table","header":[str],"rows":[[str]]}]}},"reason": str}], "continue": true}. The code must build a dict of totals per region with csv.DictReader and print each line with an f-string like f"{region}: {total}". The document holds a table of the totals.'
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
      if ($d.content) { $content += $d.content.Length; $sample += $d.content }
      if ($d.reasoning_content) { $reasoning += $d.reasoning_content.Length }
      if ($d.reasoning) { $reasoning += $d.reasoning.Length }
    }
  }
  $valid = $true; try { $null = $sample | ConvertFrom-Json } catch { $valid = $false }
  [ordered] @{ label = $label; ms = $sw.ElapsedMilliseconds; first_chunk_ms = $first; content_chars = $content; reasoning_chars = $reasoning; finish = $finish; json_valid = $valid; usage = $usage; content = $sample }
}
$results = @()
$schema = @{ type = 'json_schema'; json_schema = @{ name = 'polaris_reply'; schema = @{ type = 'object' } } }
foreach ($round in 1..2) {
  foreach ($v in @(@(@{ reasoning_effort = 'low' }, 'low/text'), @(@{ reasoning_effort = 'low'; response_format = $schema }, 'low/json_schema'))) {
    try { $results += Probe $v[0] ($v[1] + ' #' + $round) } catch { $results += [ordered] @{ label = $v[1]; error = $_.Exception.Message } }
  }
}
$record = [ordered] @{ measured_at = (Get-Date).ToUniversalTime().ToString('o'); model = $model.id; model_entry = $model; results = $results } 
[System.IO.File]::WriteAllText($out, ($record | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
