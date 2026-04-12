const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let mainWindow = null
const API_PORT = 3456
const isDev = process.env.NODE_ENV === 'development'

function getResourcePath(...segments) {
  const appPath = app.getAppPath()

  if (isDev) {
    return path.join(__dirname, '..', ...segments)
  }

  // Try app.asar.unpacked first (for native modules like better-sqlite3)
  const unpackedPath = path.join(appPath.replace('app.asar', 'app.asar.unpacked'), ...segments)
  if (fs.existsSync(unpackedPath)) return unpackedPath

  return path.join(appPath, ...segments)
}

function startApiServer() {
  return new Promise((resolve, reject) => {
    try {
      // Set env before requiring the API module
      process.env.MANAGR_API_PORT = String(API_PORT)

      // Resolve the API entry point
      const apiPath = getResourcePath('server', 'dist', 'src', 'api.js')
      console.log(`[managr] Loading API from: ${apiPath}`)

      // The server directory needs to be in the module resolution path
      // so that better-sqlite3 and other native modules can be found
      const serverNodeModules = getResourcePath('server', 'node_modules')
      if (fs.existsSync(serverNodeModules)) {
        require('module').globalPaths.push(serverNodeModules)
      }

      // Import and run the API server directly in this process
      // Using dynamic import for ESM modules
      import('file://' + apiPath.replace(/\\/g, '/')).then(() => {
        console.log('[managr] API server loaded')
        // Wait for it to actually be listening
        const check = () => {
          const http = require('http')
          const req = http.get(`http://localhost:${API_PORT}/api/platform`, res => {
            if (res.statusCode === 200) resolve()
            else setTimeout(check, 100)
          })
          req.on('error', () => setTimeout(check, 100))
          req.end()
        }
        setTimeout(check, 300)
      }).catch(err => {
        console.error('[managr] Failed to load API as ESM, trying fork...', err.message)
        // Fallback: fork as a child process using Electron's own node
        const { fork } = require('child_process')
        const child = fork(apiPath, [], {
          env: { ...process.env, MANAGR_API_PORT: String(API_PORT) },
          cwd: path.dirname(apiPath),
          execArgv: [],
        })
        child.on('error', e => console.error('[api]', e.message))
        child.on('exit', code => console.log(`[api] exited ${code}`))

        // Store for cleanup
        app._apiChild = child

        const check = () => {
          const http = require('http')
          const req = http.get(`http://localhost:${API_PORT}/api/platform`, res => {
            if (res.statusCode === 200) resolve()
            else setTimeout(check, 200)
          })
          req.on('error', () => setTimeout(check, 200))
          req.end()
        }
        setTimeout(check, 500)
      })
    } catch (err) {
      console.error('[managr] API startup error:', err)
      reject(err)
    }
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 860,
    minHeight: 540,
    title: 'managr',
    show: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    backgroundColor: '#222831',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    const indexPath = getResourcePath('dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  console.log('[managr] Starting API server...')
  await startApiServer()
  console.log('[managr] API server ready, opening window...')
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (app._apiChild) {
    app._apiChild.kill()
    app._apiChild = null
  }
})
