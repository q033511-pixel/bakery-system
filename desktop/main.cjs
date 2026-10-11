/**
 * AlMoutmag Bakery — Electron main process
 * تطبيق سطح مكتب يغلّف نظام إدارة المخبز: بيانات المستخدم تُخزَّن محلياً
 * في IndexedDB داخل مجلد بيانات التطبيق (userData) — آمنة ودائمة.
 */
const { app, BrowserWindow, shell, Menu } = require('electron')
const path = require('node:path')

app.setAppUserModelId('com.almoutmag.bakery')

// منع نوافذ متعددة أثناء التحميل
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 380,
    minHeight: 600,
    title: 'نظام إدارة المخبز — المُطّعِم',
    backgroundColor: '#fffbeb',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  })

  // لا قائمة افتراضية — تجربة أنظف
  Menu.setApplicationMenu(null)

  win.once('ready-to-show', () => win.show())

  // أي رابط خارجي يفتح في المتصفح النظام
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  win.loadFile(path.join(__dirname, 'dist', 'index.html'))
}

app.whenReady().then(createWindow)

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
