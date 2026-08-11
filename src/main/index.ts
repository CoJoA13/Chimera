import { app, BrowserWindow, shell } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerIpc } from './ipc/register'
import { SessionManager } from './ipc/sessions'
import { startScheduler } from './scheduler'
import { WatcherManager } from './watcherManager'
import { FederationManager } from './federation'
import { pruneOldData } from './store/maintenance'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Keep one data directory across dev and packaged builds (productName differs
// from the package name, which would otherwise silently fork userData).
app.setPath('userData', join(app.getPath('appData'), 'chimera'))

// Single instance: schedules/watchers/federation must not run twice over one DB.
if (!app.requestSingleInstanceLock()) {
  // Exit synchronously: do not let the losing process reach whenReady and
  // briefly touch the shared DB, schedulers, watchers, or federation port.
  app.exit(0)
}
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
})

let mainWindow: BrowserWindow | null = null
const sessionManager = new SessionManager(() => mainWindow?.webContents ?? null)

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 760,
    minHeight: 500,
    title: 'Chimera',
    backgroundColor: '#0d1117',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // ESM preload requires sandbox: false; renderer still has no Node access.
      sandbox: false
    }
  })

  const openExternalHttp = (url: string): void => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString())
      }
    } catch {
      // Ignore malformed and non-web URLs.
    }
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttp(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url === mainWindow?.webContents.getURL()) return
    event.preventDefault()
    openExternalHttp(url)
  })
  mainWindow.webContents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(() => {
  const watcherManager = new WatcherManager(sessionManager)
  const federationManager = new FederationManager(sessionManager.getBus())
  registerIpc(sessionManager, watcherManager, federationManager)
  sessionManager.initBusDirectory()
  startScheduler(sessionManager)
  watcherManager.start()
  void federationManager.start()
  pruneOldData()
  setInterval(pruneOldData, 24 * 60 * 60 * 1000)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void sessionManager.disposeAll()
})
