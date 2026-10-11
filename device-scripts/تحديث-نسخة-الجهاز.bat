@echo off
chcp 65001 >nul
title تحديث نسخة الجهاز — نظام إدارة المخبز
echo ==================================================
echo    تحديث نسخة الجهاز من GitHub
echo ==================================================
echo.
cd /d C:\almoutmag\bakery-system
if not exist ".git" (
  echo خطأ: مجلد المشروع غير موجود في C:\almoutmag\bakery-system
  pause
  exit /b 1
)
echo جارٍ سحب آخر إصدار...
git pull origin main
echo.
echo ==================================================
echo   تم التحديث — كل ملفات المشروع الآن آخر إصدار
echo   الموقع الحي يعمل تلقائياً بالإصدار الجديد:
echo   https://q033511-pixel.github.io/bakery-system/
echo ==================================================
echo.
pause
