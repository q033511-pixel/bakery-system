@echo off
chcp 65001 >nul
title تحميل تطبيق سطح المكتب — نظام إدارة المخبز
echo ==================================================
echo    تحميل تطبيق سطح المكتب (EXE) — نظام إدارة المخبز
echo    الإصدار 8.1 — قفل بالرمز السري
echo ==================================================
echo.
if not exist "C:\almoutmag" mkdir "C:\almoutmag"
echo جارٍ التحميل... حجم الملف حوالي 70 ميجابايت — انتظر قليلاً
echo.
powershell -NoProfile -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri 'https://github.com/q033511-pixel/bakery-system/releases/download/v8.1.0/AlMoutmag-Bakery-Portable.exe' -OutFile 'C:\almoutmag\نظام-إدارة-المخبز.exe'"
if exist "C:\almoutmag\نظام-إدارة-المخبز.exe" (
  echo ==================================================
  echo   تم التحميل بنجاح!
  echo   الملف: C:\almoutmag\نظام-إدارة-المخبز.exe
  echo   افتح الملف مباشرة — لا يحتاج أي تثبيت
  echo   بياناتك تُحفظ تلقائياً على جهازك
  echo ==================================================
  explorer /select,"C:\almoutmag\نظام-إدارة-المخبز.exe"
) else (
  echo فشل التحميل — تأكد من الاتصال بالإنترنت ثم أعد المحاولة
)
echo.
pause
