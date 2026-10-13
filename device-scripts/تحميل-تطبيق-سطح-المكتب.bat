@echo off
chcp 65001 >nul
title تحميل تطبيق سطح المكتب — نظام إدارة المخبز
echo ==================================================
echo    تحميل تطبيق سطح المكتب (EXE) — نظام إدارة المخبز
echo    الإصدار 8.1.4 — قفل بالرمز السري + إصلاح كامل
echo ==================================================
echo.
if not exist "C:\almoutmag" mkdir "C:\almoutmag"
echo جارٍ التحميل... حجم الملف حوالي 105 ميجابايت — انتظر قليلاً
echo.
set "ZIPURL=https://github.com/q033511-pixel/bakery-system/releases/download/v8.1.4/AlMoutmag-Bakery-Windows.zip"
set "ZIP=C:\almoutmag\AlMoutmag-Bakery-Windows.zip"
curl.exe -L --fail --retry 3 --progress-bar --output "%ZIP%" "%ZIPURL%"
powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'C:\almoutmag\app' | Out-Null; $zip='C:\almoutmag\AlMoutmag-Bakery-Windows.zip'; $ok=$false; if(Test-Path -LiteralPath $zip){ $ok=((Get-Item -LiteralPath $zip).Length -gt 50000000) }; if($ok){ try { tar -xf $zip -C 'C:\almoutmag\app'; if($LASTEXITCODE -eq 0){ $ok=$true } } catch {}; if(-not $ok){ try { Expand-Archive -LiteralPath $zip -DestinationPath 'C:\almoutmag\app' -Force; $ok=$true } catch {} } }; $exe='C:\almoutmag\app\AlMoutmag Bakery.exe'; if($ok -and (Test-Path -LiteralPath $exe)) { Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue; Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue; exit 0 } else { exit 1 }"
if exist "C:\almoutmag\app\AlMoutmag Bakery.exe" (
  echo ==================================================
  echo   تم التحميل والتنصيب بنجاح!
  echo   الملف: C:\almoutmag\app\AlMoutmag Bakery.exe
  echo   افتح الملف مباشرة — لا يحتاج أي تثبيت
  echo   بياناتك تُحفظ تلقائياً على جهازك
  echo ==================================================
  start "" "C:\almoutmag\app\AlMoutmag Bakery.exe"
) else (
  echo فشل التحميل — تأكد من الاتصال بالإنترنت ثم أعد المحاولة
)
echo.
pause
