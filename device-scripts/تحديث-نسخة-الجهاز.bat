@echo off
chcp 65001 >nul
title تحديث تطبيق الويندوز — نظام إدارة المخبز
echo ==============================================================
echo    تحديث تطبيق الويندوز (EXE) إلى أحدث إصدار
echo    الإصدار الجديد: 8.1.4
echo ==============================================================
echo.
echo  ماذا سيفعل:
echo   1) إغلاق التطبيق إن كان شغالاً
echo   2) أخذ نسخة احتياطية من بياناتك (للاحتياط فقط)
echo   3) تحميل أحدث نسخة كاملة (ZIP) وفك ضغطها في C:\almoutmag\app
echo   4) تحديث اختصار سطح المكتب وفتح التطبيق
echo.
echo  بياناتك (فواتير، عملاء، مخزون...) محفوظة في مجلد بيانات
echo  مستقل داخل ويندوز ولا تُحذف أبداً عند التحديث.
echo.
pause
echo.

echo [1/4] إغلاق التطبيق إن كان شغالاً...
taskkill /F /IM "AlMoutmag-Bakery-Portable.exe" >nul 2>&1
taskkill /F /IM "AlMoutmag Bakery.exe" >nul 2>&1
taskkill /F /IM "نظام-إدارة-المخبز.exe" >nul 2>&1
taskkill /F /IM "نظام إدارة المخبز.exe" >nul 2>&1
powershell -NoProfile -Command "Get-Process | Where-Object { $_.ProcessName -like '*AlMoutmag*' -or $_.ProcessName -like '*المخبز*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 3 /nobreak >nul
echo       تم الإغلاق.

if not exist "C:\almoutmag" mkdir "C:\almoutmag"

echo [2/4] أخذ نسخة احتياطية من بياناتك...
powershell -NoProfile -Command "$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $dest=('C:\almoutmag\نسخة-احتياطية-من-بياناتك-' + $stamp); $found=$false; Get-ChildItem -LiteralPath $env:APPDATA -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'AlMoutmag*' } | ForEach-Object { $found=$true; Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue }; if($found){ Write-Host '      تم حفظ نسخة احتياطية في:' $dest } else { Write-Host '      لا يوجد مجلد بيانات بعد — نتجاوز' }"

echo [3/4] تحميل الإصدار 8.1.4 — حجم الملف حوالي 105 ميجابايت،
echo       انتظر حتى يمتلئ شريط التقدم ولا تغلق النافذة...
set "ZIPURL=https://github.com/q033511-pixel/bakery-system/releases/download/v8.1.4/AlMoutmag-Bakery-Windows.zip"
set "ZIP=C:\almoutmag\AlMoutmag-Bakery-Windows.zip"
curl.exe -L --fail --retry 3 --progress-bar --output "%ZIP%" "%ZIPURL%"
powershell -NoProfile -Command "$zip='C:\almoutmag\AlMoutmag-Bakery-Windows.zip'; $ok=$false; if(Test-Path -LiteralPath $zip){ $ok=((Get-Item -LiteralPath $zip).Length -gt 50000000) }; if(-not $ok){ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://github.com/q033511-pixel/bakery-system/releases/download/v8.1.4/AlMoutmag-Bakery-Windows.zip' -OutFile $zip -UseBasicParsing } catch {}; if(Test-Path -LiteralPath $zip){ $ok=((Get-Item -LiteralPath $zip).Length -gt 50000000) } }; Unblock-File -LiteralPath $zip -ErrorAction SilentlyContinue; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 goto :download_fail
echo       تم التحميل بنجاح، الآن فك الضغط (دقيقة تقريباً)...

powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'C:\almoutmag\app' | Out-Null; $ok=$false; try { tar -xf 'C:\almoutmag\AlMoutmag-Bakery-Windows.zip' -C 'C:\almoutmag\app'; if($LASTEXITCODE -eq 0){ $ok=$true } } catch {}; if(-not $ok){ try { Expand-Archive -LiteralPath 'C:\almoutmag\AlMoutmag-Bakery-Windows.zip' -DestinationPath 'C:\almoutmag\app' -Force; $ok=$true } catch {} }; $exe='C:\almoutmag\app\AlMoutmag Bakery.exe'; if($ok -and (Test-Path -LiteralPath $exe) -and ((Get-Item -LiteralPath $exe).Length -gt 50000000)) { Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue; Remove-Item -LiteralPath 'C:\almoutmag\AlMoutmag-Bakery-Windows.zip' -Force -ErrorAction SilentlyContinue; exit 0 } else { exit 1 }"
if errorlevel 1 goto :extract_fail
echo       تم فك الضغط والفحص بنجاح.

echo [4/4] تحديث اختصار سطح المكتب وفتح التطبيق...
powershell -NoProfile -Command "$exe='C:\almoutmag\app\AlMoutmag Bakery.exe'; $ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut(([Environment]::GetFolderPath('Desktop'))+'\نظام إدارة المخبز.lnk'); $sc.TargetPath=$exe; $sc.WorkingDirectory='C:\almoutmag\app'; $sc.IconLocation=($exe+',0'); $sc.Save()"
start "" "C:\almoutmag\app\AlMoutmag Bakery.exe"

echo.
echo ==============================================================
echo   تم التحديث! التطبيق الآن أحدث إصدار (8.1.3).
echo.
echo   - التطبيق أصبح يفتح بشكل صحيح (إصلاح مشكلة الشاشة البيضاء)
echo   - كل بياناتك القديمة موجودة كما هي (لم تُلمس)
echo   - إن سألك ويندوز عند أول تشغيل: اضغط «معلومات إضافية»
echo     ثم «تشغيل على أي حال»
echo ==============================================================
echo.
pause
exit /b 0

:download_fail
echo.
echo ==============================================================
echo   فشل التحميل!
echo   1) تأكد من اتصال الإنترنت ثم شغّل هذا الملف من جديد
echo   2) أو افتح المتصفح وحمّل النسخة يدوياً من:
echo      https://github.com/q033511-pixel/bakery-system/releases
echo ==============================================================
echo.
pause
exit /b 1

:extract_fail
echo.
echo ==============================================================
echo   فشل فك الضغط!
echo   شغّل هذا الملف من جديد — إن تكررت المشكلة حمّل الملف يدوياً:
echo   https://github.com/q033511-pixel/bakery-system/releases
echo   ثم فك ضغطه وانسخ محتوياته إلى C:\almoutmag\app
echo ==============================================================
echo.
pause
exit /b 1
