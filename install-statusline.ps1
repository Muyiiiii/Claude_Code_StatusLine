#Requires -Version 5.1

& {
    Set-StrictMode -Version Latest
    $ErrorActionPreference = "Stop"
    $ProgressPreference = "SilentlyContinue"

    $baseUrl = "https://raw.githubusercontent.com/Muyiiiii/muyi_code_statusline/main/bin"
    $tempDirectory = $null
    $previousSecurityProtocol = $null

    function Invoke-Download {
        param(
            [Parameter(Mandatory = $true)][string]$Uri,
            [Parameter(Mandatory = $true)][string]$OutFile
        )

        $parameters = @{
            Uri = $Uri
            OutFile = $OutFile
            ErrorAction = "Stop"
        }
        if ($PSVersionTable.PSVersion.Major -lt 6) {
            $parameters["UseBasicParsing"] = $true
        }
        Invoke-WebRequest @parameters | Out-Null
    }

    try {
        $nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
        if ($null -eq $nodeCommand) {
            throw "Node.js 18 or later is required. Install Node.js, reopen PowerShell, and try again."
        }

        $tempDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("muyi-code-statusline-" + [guid]::NewGuid().ToString("N"))
        $installerPath = Join-Path $tempDirectory "install.js"
        $statuslinePath = Join-Path $tempDirectory "statusline.js"
        New-Item -ItemType Directory -Path $tempDirectory | Out-Null

        # Windows PowerShell 5.1 may otherwise negotiate an obsolete TLS version.
        if ($PSVersionTable.PSEdition -eq "Desktop") {
            $previousSecurityProtocol = [Net.ServicePointManager]::SecurityProtocol
            [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        }

        Invoke-Download -Uri "$baseUrl/install.js" -OutFile $installerPath
        Invoke-Download -Uri "$baseUrl/statusline.js" -OutFile $statuslinePath

        foreach ($download in @($installerPath, $statuslinePath)) {
            if (-not (Test-Path -LiteralPath $download -PathType Leaf) -or
                (Get-Item -LiteralPath $download).Length -eq 0) {
                throw "Download failed: $download is missing or empty."
            }

            & $nodeCommand.Source --check $download
            $checkExitCode = $LASTEXITCODE
            if ($checkExitCode -ne 0) {
                throw "Downloaded JavaScript failed validation: $download"
            }
        }

        & $nodeCommand.Source $installerPath
        $installerExitCode = $LASTEXITCODE
        if ($installerExitCode -ne 0) {
            throw "The Node.js installer failed with exit code $installerExitCode."
        }
    }
    finally {
        if ($null -ne $previousSecurityProtocol) {
            [Net.ServicePointManager]::SecurityProtocol = $previousSecurityProtocol
        }
        if ($null -ne $tempDirectory -and (Test-Path -LiteralPath $tempDirectory)) {
            Remove-Item -LiteralPath $tempDirectory -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}
