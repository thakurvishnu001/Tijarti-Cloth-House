$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
node -e "const fs=require('node:fs'); fs.realpathSync=fs.realpathSync.native; require('node:module').syncBuiltinESMExports(); require('./server.cjs')"
