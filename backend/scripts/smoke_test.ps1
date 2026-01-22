$specPath = Join-Path $PSScriptRoot '..\docs\openapi_endpoints.json'
$spec = Get-Content $specPath -Raw | ConvertFrom-Json

$nodeBase = $env:NODE_API_URL
if (-not $nodeBase) { $nodeBase = 'https://mkc-backend-kqov.onrender.com' }
$pyBase = $env:PYTHON_API_URL
if (-not $pyBase) { $pyBase = 'https://mkc-5slv.onrender.com/api/v1' }
$out = @()

foreach ($p in $spec.paths.PSObject.Properties) {
    $path = $p.Name
    $entry = $p.Value
    foreach ($methodProp in $entry.PSObject.Properties) {
        $method = $methodProp.Name.ToUpper()
        $url = if ($path -like '/api/v1*') { $pyBase + $path } else { $nodeBase + $path }
        $result = @{ path=$path; method=$method; url=$url; status='ERR'; ok=$false; bodySnippet=''; }
        try {
            if ($method -eq 'GET') {
                $resp = Invoke-RestMethod -Uri $url -Method GET -ErrorAction Stop
                $result.status = 200
                $result.ok = $true
                $result.bodySnippet = ($resp | ConvertTo-Json -Depth 2) -replace "\r|\n"," "
            } else {
                # POST/PATCH/DELETE - send minimal JSON
                $resp = Invoke-RestMethod -Uri $url -Method $method -Body (@{} | ConvertTo-Json) -ContentType 'application/json' -ErrorAction Stop
                $result.status = 200
                $result.ok = $true
                $result.bodySnippet = ($resp | ConvertTo-Json -Depth 2) -replace "\r|\n"," "
            }
        } catch {
            $err = $_.Exception
            if ($err.Response -ne $null) {
                try {
                    $code = $err.Response.StatusCode.Value__
                    $result.status = $code
                    $result.bodySnippet = ($err.Response.Content | ConvertTo-Json -Depth 1) -replace "\r|\n"," "
                } catch {
                    $result.bodySnippet = $err.Message
                }
            } else {
                $result.bodySnippet = $err.Message
            }
        }
        $out += $result
        Write-Output "$($path) $($method) $($result.status)"
    }
}

$logPath = Join-Path $PSScriptRoot '..\logs\smoke_results_ps.json'
$out | ConvertTo-Json -Depth 5 | Out-File -FilePath $logPath -Encoding UTF8
Write-Output "PowerShell smoke test complete. Results saved to $logPath"