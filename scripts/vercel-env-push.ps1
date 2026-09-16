<#
.SYNOPSIS
  KEY=VALUE 파일을 읽어 Vercel 프로젝트 환경변수로 밀어 넣는다 (REST API, upsert).

.DESCRIPTION
  개발 Vercel 프로젝트(mint-mlp-dev)에 운영과 같은 18개 키를 손으로 다시 치는 대신 쓴다.
  Vercel CLI의 `env pull`은 Sensitive 값을 내려주지 않으므로 운영에서 복사하는 방식은 못 쓴다.
  대신 로컬 파일에 값을 채워서 올린다. 파일 형식은 scripts/vercel-env.example 참고.

  타입 규칙(운영 프로젝트와 동일):
    VITE_* / PUBLIC_*  → encrypted  (Vercel이 이 접두사는 Sensitive를 거부한다)
    그 외             → sensitive  (대시보드에서 값 다시 못 봄)

.EXAMPLE
  $env:VERCEL_TOKEN = "..."          # Full Account 범위 토큰
  .\scripts\vercel-env-push.ps1 -EnvFile .\.env.dev-vercel -ProjectId prj_xxxx -DryRun
  .\scripts\vercel-env-push.ps1 -EnvFile .\.env.dev-vercel -ProjectId prj_xxxx

.NOTES
  - 값 파일은 .env* 로 시작하게 이름 지으면 .gitignore에 걸려 커밋되지 않는다.
  - 같은 키가 이미 있으면 upsert로 덮어쓴다.
#>
param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$ProjectId,
  [string]$TeamId = "team_23A3usYbjxU9cQVXUnwkZQW4",
  [ValidateSet("production", "preview", "development")][string]$Target = "production",
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$token = $env:VERCEL_TOKEN
if (-not $token) { throw "VERCEL_TOKEN 환경변수가 비어 있다. Full Account 범위 토큰을 넣을 것." }
if (-not (Test-Path $EnvFile)) { throw "파일 없음: $EnvFile" }

$entries = @()
foreach ($raw in Get-Content $EnvFile -Encoding UTF8) {
  $line = $raw.Trim()
  if ($line -eq "" -or $line.StartsWith("#")) { continue }
  $idx = $line.IndexOf("=")
  if ($idx -lt 1) { Write-Warning "무시(형식 아님): $line"; continue }
  $key = $line.Substring(0, $idx).Trim()
  $value = $line.Substring($idx + 1).Trim()
  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ($value -eq "") { Write-Warning "무시(값 비어 있음): $key"; continue }
  $type = if ($key -match '^(VITE_|PUBLIC_)') { "encrypted" } else { "sensitive" }
  $entries += [pscustomobject]@{ key = $key; value = $value; type = $type }
}

if ($entries.Count -eq 0) { throw "올릴 항목이 없다." }

Write-Host ("대상: project={0} team={1} target={2} 항목={3}개" -f $ProjectId, $TeamId, $Target, $entries.Count)
foreach ($e in $entries) { Write-Host ("  {0,-28} {1,-10} len={2}" -f $e.key, $e.type, $e.value.Length) }
if ($DryRun) { Write-Host "DryRun: 전송 안 함"; exit 0 }

$uri = "https://api.vercel.com/v10/projects/$ProjectId/env?teamId=$TeamId&upsert=true"
$headers = @{ Authorization = "Bearer $token" }
$ok = 0; $fail = 0
foreach ($e in $entries) {
  $body = @{ key = $e.key; value = $e.value; type = $e.type; target = @($Target) } | ConvertTo-Json -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
  try {
    $null = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -ContentType "application/json; charset=utf-8" -Body $bytes
    Write-Host ("OK   {0}" -f $e.key)
    $ok++
  } catch {
    $msg = $_.Exception.Message
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      $reader = New-Object System.IO.StreamReader($stream)
      $msg = $reader.ReadToEnd()
    } catch {}
    Write-Host ("FAIL {0}: {1}" -f $e.key, $msg) -ForegroundColor Red
    $fail++
  }
}
Write-Host ("완료: 성공 {0}, 실패 {1}" -f $ok, $fail)
if ($fail -gt 0) { exit 1 }
