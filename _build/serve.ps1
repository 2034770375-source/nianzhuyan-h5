# 年猪宴 · 局域网预览服务器（零依赖）
#
# 为什么用 PowerShell 写：这台机器上没有 Node / Python，而 Windows 自带 PowerShell 与 .NET，
# 用 TcpListener 就能起一个够用的静态服务，不装任何东西。
# 只用保守语法，Windows PowerShell 5.1 与 PowerShell 7 都能跑。
#
# 用法：双击上一级的「启动-局域网预览.bat」，或手动
#   powershell -NoProfile -ExecutionPolicy Bypass -File _build\serve.ps1

param([int]$Port = 8080)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 脚本在 _build 下，根目录＝上一级（也就是 年猪宴-H5）
$Root = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

$Mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.svg'  = 'image/svg+xml'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.ico'  = 'image/x-icon'
  '.ttf'  = 'font/ttf'
  '.otf'  = 'font/otf'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
}

function Get-LanIPv4 {
  # 先问 DNS（最兼容），拿不到再问 WMI，最后退回回环地址
  try {
    $addrs = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName())
    foreach ($a in $addrs) {
      if ($a.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork) {
        $s = $a.IPAddressToString
        if ($s -ne '127.0.0.1' -and -not $s.StartsWith('169.254.')) { return $s }
      }
    }
  } catch { }
  try {
    $cfg = Get-WmiObject -Class Win32_NetworkAdapterConfiguration -Filter 'IPEnabled = True' -ErrorAction Stop
    foreach ($c in $cfg) {
      foreach ($s in $c.IPAddress) {
        if ($s -match '^\d+\.\d+\.\d+\.\d+$' -and $s -ne '127.0.0.1' -and -not $s.StartsWith('169.254.')) { return $s }
      }
    }
  } catch { }
  return '127.0.0.1'
}

# 依次试端口，默认从 8080 开始
$listener = $null
for ($p = $Port; $p -le $Port + 5; $p += 1) {
  try {
    $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $p)
    $l.Start()
    $listener = $l
    $Port = $p
    break
  } catch { }
}
if ($null -eq $listener) {
  Write-Host "端口 $Port 到 $($Port + 5) 都被占用了，先把占用它们的程序关掉再试。" -ForegroundColor Red
  exit 1
}

$lan = Get-LanIPv4
Write-Host ''
Write-Host '  年猪宴 · 局域网预览已启动' -ForegroundColor Yellow
Write-Host "  服务目录：$Root"
Write-Host ''
Write-Host "  本机打开：  http://127.0.0.1:$Port/" -ForegroundColor Green
Write-Host "  手机打开：  http://${lan}:$Port/" -ForegroundColor Green
Write-Host ''
Write-Host '  手机要和这台电脑连同一个 WiFi；第一次运行时 Windows 安全中心会问，选「允许」。' -ForegroundColor Gray
Write-Host '  电脑不要休眠、这个窗口不要关；按 Ctrl+C 结束。' -ForegroundColor Gray
if ($lan -eq '127.0.0.1') {
  Write-Host '  提示：没探到局域网 IP，请在命令行执行 ipconfig 看「无线局域网适配器」的 IPv4 地址。' -ForegroundColor DarkYellow
}
Write-Host ''

function Send-Bytes($stream, [string]$head, [byte[]]$body) {
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body -and $body.Length -gt 0) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $stream = $client.GetStream()
      $buf = New-Object byte[] 8192
      $read = $stream.Read($buf, 0, $buf.Length)
      if ($read -le 0) { continue }

      $text = [System.Text.Encoding]::ASCII.GetString($buf, 0, $read)
      $line = ($text -split "`r`n")[0]
      $parts = $line -split ' '
      $raw = '/'
      if ($parts.Length -ge 2) { $raw = $parts[1] }

      # 去掉查询串与锚点，再解码百分号
      $clean = $raw.Split('?')[0].Split('#')[0]
      try { $clean = [System.Uri]::UnescapeDataString($clean) } catch { }
      if ($clean -eq '' -or $clean -eq '/') { $clean = '/index.html' }
      # 浏览器会自动来要图标，回 204 免得刷出 404
      if ($clean -eq '/favicon.ico') {
        Send-Bytes $stream "HTTP/1.1 204 No Content`r`nConnection: close`r`n`r`n" $null
        continue
      }

      $rel = $clean.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      $full = [System.IO.Path]::GetFullPath((Join-Path $Root $rel))

      if (-not $full.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('403')
        Send-Bytes $stream "HTTP/1.1 403 Forbidden`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n" $body
        Write-Host "  403 $clean" -ForegroundColor DarkYellow
        continue
      }
      if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found: ' + $clean)
        Send-Bytes $stream "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($body.Length)`r`nConnection: close`r`n`r`n" $body
        Write-Host "  404 $clean" -ForegroundColor DarkYellow
        continue
      }

      $bytes = [System.IO.File]::ReadAllBytes($full)
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $ctype = 'application/octet-stream'
      if ($Mime.ContainsKey($ext)) { $ctype = $Mime[$ext] }
      Send-Bytes $stream "HTTP/1.1 200 OK`r`nContent-Type: $ctype`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n" $bytes
      Write-Host "  200 $clean  ($([math]::Round($bytes.Length / 1024, 1)) KB)" -ForegroundColor DarkGray
    } catch {
      # 单个请求出错不影响服务继续跑
    } finally {
      try { $client.Close() } catch { }
    }
  }
} finally {
  try { $listener.Stop() } catch { }
  Write-Host ''
  Write-Host '服务已停止。' -ForegroundColor Yellow
}
