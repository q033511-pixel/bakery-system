/**
 * تشغيل نموذج المزامنة داخل Electron — يمثل "نسخة الويندوز" أو "الموقع"
 * الجهاز يُحدد من متغير البيئة PROTO_DEVICE (device-site | device-exe)
 * الموقع يُحمل عبر http://localhost — origin حقيقي بـIndexedDB دائم
 */
const { app, BrowserWindow } = require('electron')

const DEVICE = process.env.PROTO_DEVICE || 'device-site'
const URL_ = process.env.PROTO_URL || 'http://localhost:7777/'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1180, height: 860, show: false,
    webPreferences: {
      contextIsolation: false, // نموذج أولي فقط — يسمح بحقن هوية الجهاز للصفحة
      nodeIntegration: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(
      `window.__SYNC_DEVICE_ID = ${JSON.stringify(DEVICE)};
       window.__SYNC_TOKEN = ${JSON.stringify(DEVICE === 'device-site' ? 'site-token-proto-a' : 'exe-token-proto-b')};
       window.__SYNC_SERVER = ${JSON.stringify(URL_.replace(/\/$/, ''))};`
    )
  })
  // هوية الجهاز تُقرأ قبل تحميل app.js — نمررها في الرابط أيضاً (البديل الأضمن)
  win.loadURL(URL_ + '?device=' + DEVICE)
})
