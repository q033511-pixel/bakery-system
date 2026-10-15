@echo off
chcp 65001 >nul
title حذف النسخة القديمة وتنصيب الجديدة — نظام إدارة المخبز
echo ==============================================================
echo    نظام إدارة المخبز — المُطّعِم
echo    أداة: حذف النسخة القديمة المعلقة + تنصيب أحدث نسخة (8.2.0)
echo ==============================================================
echo.
echo   هذه الأداة ستقوم بالتالي:
echo     1) إغلاق النسخة القديمة إن كانت شغالة
echo     2) أخذ نسخة احتياطية من بياناتك في C:\almoutmag
echo     3) حذف النسخة القديمة من كل الأماكن الشائعة
echo     4) تحميل نسخة الويندوز الكاملة (ZIP) وفك الضغط
echo     5) إنشاء اختصار على سطح المكتب وفتح التطبيق
echo.
echo   مهم: بياناتك لن تضيع — الفواتير والعملاء والمخزون محفوظة
echo   في مجلد بيانات مستقل داخل ويندوز، وهذا المجلد لن يُلمس أبداً.
echo.
pause
echo.

echo [1/5] إغلاق النسخة القديمة إن كانت شغالة...
taskkill /F /IM "AlMoutmag-Bakery-Portable.exe" >nul 2>&1
taskkill /F /IM "AlMoutmag Bakery.exe" >nul 2>&1
taskkill /F /IM "نظام-إدارة-المخبز.exe" >nul 2>&1
taskkill /F /IM "نظام إدارة المخبز.exe" >nul 2>&1
powershell -NoProfile -Command "Get-Process | Where-Object { $_.ProcessName -like '*AlMoutmag*' -or $_.ProcessName -like '*المخبز*' } | Stop-Process -Force -ErrorAction SilentlyContinue"
timeout /t 3 /nobreak >nul
echo       تم الإغلاق.

if not exist "C:\almoutmag" mkdir "C:\almoutmag"

echo [2/5] أخذ نسخة احتياطية من بياناتك (للاحتياط فقط)...
powershell -NoProfile -Command "$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'; $dest=('C:\almoutmag\نسخة-احتياطية-من-بياناتك-' + $stamp); $found=$false; Get-ChildItem -LiteralPath $env:APPDATA -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'AlMoutmag*' } | ForEach-Object { $found=$true; Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force -ErrorAction SilentlyContinue }; if($found){ Write-Host '      تم حفظ نسخة احتياطية في:' $dest } else { Write-Host '      لا يوجد مجلد بيانات بعد (نظام جديد) — نتجاوز' }"

echo [3/5] حذف النسخة القديمة من كل الأماكن الشائعة...
powershell -NoProfile -Command "$dirs=@('C:\almoutmag',[Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('Personal'),($env:USERPROFILE+'\Downloads'),($env:PUBLIC+'\Desktop')); foreach($d in $dirs){ if(Test-Path -LiteralPath $d){ Get-ChildItem -LiteralPath $d -File -Recurse -Depth 1 -ErrorAction SilentlyContinue | Where-Object { ($_.Extension -eq '.exe' -and ($_.Name -like 'AlMoutmag*' -or $_.Name -like '*المخبز*')) -or ($_.Extension -eq '.lnk' -and ($_.Name -like '*المخبز*' -or $_.Name -like '*AlMoutmag*')) } | ForEach-Object { Write-Host '      حذف:' $_.FullName; Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue } } }"
echo       تم الحذف.

echo [4/5] تحميل نسخة الويندوز الكاملة — حجم الملف حوالي 105 ميجابايت،
echo       انتظر حتى يمتلئ شريط التقدم ولا تغلق النافذة...
set "ZIPURL=https://github.com/q033511-pixel/bakery-system/releases/download/v8.2.0/AlMoutmag-Bakery-Windows.zip"
set "ZIP=C:\almoutmag\AlMoutmag-Bakery-Windows.zip"
curl.exe -L --fail --retry 3 --progress-bar --output "%ZIP%" "%ZIPURL%"
powershell -NoProfile -Command "$zip='C:\almoutmag\AlMoutmag-Bakery-Windows.zip'; $ok=$false; if(Test-Path -LiteralPath $zip){ $ok=((Get-Item -LiteralPath $zip).Length -gt 50000000) }; if(-not $ok){ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://github.com/q033511-pixel/bakery-system/releases/download/v8.2.0/AlMoutmag-Bakery-Windows.zip' -OutFile $zip -UseBasicParsing } catch {}; if(Test-Path -LiteralPath $zip){ $ok=((Get-Item -LiteralPath $zip).Length -gt 50000000) } }; Unblock-File -LiteralPath $zip -ErrorAction SilentlyContinue; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 goto :download_fail
echo       تم التحميل بنجاح، الآن فك الضغط (دقيقة تقريباً)...

powershell -NoProfile -Command "New-Item -ItemType Directory -Force -Path 'C:\almoutmag\app' | Out-Null; $ok=$false; try { tar -xf 'C:\almoutmag\AlMoutmag-Bakery-Windows.zip' -C 'C:\almoutmag\app'; if($LASTEXITCODE -eq 0){ $ok=$true } } catch {}; if(-not $ok){ try { Expand-Archive -LiteralPath 'C:\almoutmag\AlMoutmag-Bakery-Windows.zip' -DestinationPath 'C:\almoutmag\app' -Force; $ok=$true } catch {} }; $exe='C:\almoutmag\app\AlMoutmag Bakery.exe'; if($ok -and (Test-Path -LiteralPath $exe) -and ((Get-Item -LiteralPath $exe).Length -gt 50000000)) { Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue; Remove-Item -LiteralPath 'C:\almoutmag\AlMoutmag-Bakery-Windows.zip' -Force -ErrorAction SilentlyContinue; exit 0 } else { exit 1 }"
if errorlevel 1 goto :extract_fail
echo       تم فك الضغط والفحص بنجاح.

echo [5/5] إنشاء اختصار على سطح المكتب وفتح التطبيق...
powershell -NoProfile -Command "$exe='C:\almoutmag\app\AlMoutmag Bakery.exe'; $ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut(([Environment]::GetFolderPath('Desktop'))+'\نظام إدارة المخبز.lnk'); $sc.TargetPath=$exe; $sc.WorkingDirectory='C:\almoutmag\app'; $sc.IconLocation=($exe+',0'); $sc.Save()"
start "" "C:\almoutmag\app\AlMoutmag Bakery.exe"

echo.
echo ==============================================================
echo   تم! النسخة الجديدة 8.2.0 نُصبت وفتحت الآن.
echo.
echo   - التطبيق أصبح يفتح بشكل صحيح (إصلاح مشكلة الشاشة البيضاء)
echo   - اختصار «نظام إدارة المخبز» أصبح على سطح المكتب
echo   - كل بياناتك القديمة موجودة كما هي (لم تُلمس)
echo   - إن سألك ويندوز عند أول تشغيل: اضغط «معلومات إضافية»
echo     ثم «تشغيل على أي حال»
echo.
echo   هذه النسخة فيها أيضاً: إصلاح تعليق اختيار المورد
echo   + إضافة مورد/عميل فورية + إغلاق قوائم الاختيار بشكل صحيح.
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
