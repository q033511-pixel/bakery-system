@echo off
chcp 65001 >nul
title حذف النسخة القديمة وتنصيب الجديدة — نظام إدارة المخبز
echo ==============================================================
echo    نظام إدارة المخبز — المُطّعِم
echo    أداة: حذف النسخة القديمة المعلقة + تنصيب أحدث نسخة (8.1.2)
echo ==============================================================
echo.
echo   هذه الأداة ستقوم بالتالي:
echo     1) إغلاق النسخة القديمة إن كانت شغالة
echo     2) أخذ نسخة احتياطية من بياناتك في C:\almoutmag
echo     3) حذف النسخة القديمة من كل الأماكن الشائعة
echo     4) تحميل النسخة الجديدة من GitHub وفحصها
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

echo [4/5] تحميل النسخة الجديدة — حجم الملف حوالي 70 ميجابايت،
echo       انتظر حتى يمتلئ شريط التقدم ولا تغلق النافذة...
set "EXEURL=https://github.com/q033511-pixel/bakery-system/releases/download/v8.1.2/AlMoutmag-Bakery-Portable.exe"
set "EXE=C:\almoutmag\نظام-إدارة-المخبز.exe"
curl.exe -L --fail --retry 3 --progress-bar --output "%EXE%" "%EXEURL%"
powershell -NoProfile -Command "$exe='C:\almoutmag\نظام-إدارة-المخبز.exe'; $ok=$false; if(Test-Path -LiteralPath $exe){ $ok=((Get-Item -LiteralPath $exe).Length -gt 50000000) }; if(-not $ok){ [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; try { Invoke-WebRequest -Uri 'https://github.com/q033511-pixel/bakery-system/releases/download/v8.1.2/AlMoutmag-Bakery-Portable.exe' -OutFile $exe -UseBasicParsing } catch {}; if(Test-Path -LiteralPath $exe){ $ok=((Get-Item -LiteralPath $exe).Length -gt 50000000) } }; Unblock-File -LiteralPath $exe -ErrorAction SilentlyContinue; if($ok){ exit 0 } else { exit 1 }"
if errorlevel 1 goto :download_fail
echo       تم التحميل والفحص بنجاح.

echo [5/5] إنشاء اختصار على سطح المكتب وفتح التطبيق...
powershell -NoProfile -Command "$exe='C:\almoutmag\نظام-إدارة-المخبز.exe'; $ws=New-Object -ComObject WScript.Shell; $sc=$ws.CreateShortcut(([Environment]::GetFolderPath('Desktop'))+'\نظام إدارة المخبز.lnk'); $sc.TargetPath=$exe; $sc.WorkingDirectory='C:\almoutmag'; $sc.IconLocation=($exe+',0'); $sc.Save()"
start "" "%EXE%"

echo.
echo ==============================================================
echo   تم! النسخة الجديدة 8.1.2 نُصبت وفتحت الآن.
echo.
echo   - اختصار «نظام إدارة المخبز» أصبح على سطح المكتب
echo   - كل بياناتك القديمة موجودة كما هي (لم تُلمس)
echo   - إن سألك ويندوز عند أول تشغيل: اضغط «معلومات إضافية»
echo     ثم «تشغيل على أي حال»
echo.
echo   هذه النسخة فيها إصلاح تعليق اختيار المورد في فاتورة الشراء
echo   + إضافة مورد/عميل فوري من داخل الفواتير.
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
