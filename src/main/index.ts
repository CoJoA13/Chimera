import { app, BrowserWindow, Menu, Notification, shell, Tray } from 'electron'
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
  showMainWindow()
})

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let backgroundNoticeShown = false
const sessionManager = new SessionManager(() => mainWindow?.webContents ?? null)

function showMainWindow(): void {
  if (!app.isReady()) return
  if (!mainWindow) createWindow()
  if (mainWindow?.isMinimized()) mainWindow.restore()
  mainWindow?.show()
  mainWindow?.focus()
}

function createTray(): void {
  if (tray) return
  try {
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(__dirname, '../../build/icon.png')
    tray = new Tray(iconPath)
    tray.setToolTip('Chimera')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Chimera', click: showMainWindow },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            isQuitting = true
            app.quit()
          }
        }
      ])
    )
    tray.on('click', showMainWindow)
  } catch (err) {
    tray = null
    console.error('[tray] failed to create:', err)
  }
}

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
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow?.hide()
    if (!backgroundNoticeShown && Notification.isSupported()) {
      backgroundNoticeShown = true
      new Notification({
        title: 'Chimera is still running',
        body: 'Background agents remain active. Reopen Chimera or use Settings to quit completely.'
      }).show()
    }
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
  createTray()

  app.on('activate', () => {
    showMainWindow()
  })
})

// Closing every window keeps background schedules, watchers, missions, and
// federation alive. The tray menu is the explicit application quit path.
app.on('window-all-closed', () => {})

app.on('before-quit', () => {
  isQuitting = true
  void sessionManager.disposeAll()
})
