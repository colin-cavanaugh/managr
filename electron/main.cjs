const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')

let mainWindow = null
let apiProcess = null
const API_PORT = 3456
const isDev = process.env.NODE_ENV === 'development'

function getResourcePath(...segments) {
  const appPath = app.getAppPath()

  if (isDev) {
    return path.join(__dirname, '..', ...segments)
  }

  const unpackedPath = path.join(appPath.replace('app.asar', 'app.asar.unpacked'), ...segments)
  if (fs.existsSync(unpackedPath)) return unpackedPath

  return path.join(appPath, ...segments)
}

function startApiServer() {
  const apiPath = getResourcePath('server', 'dist', 'src', 'api.js')

  console.log(`[managr] API script: ${apiPath}`)
  console.log(`[managr] Exists: ${fs.existsSync(apiPath)}`)

  // Use fork() — runs on Electron's bundled Node.js, no system Node needed.
  // fork() creates a child process using the same Node binary as the parent.
  apiProcess = fork(apiPath, [], {
    env: { ...process.env, MANAGR_API_PORT: String(API_PORT) },
    cwd: path.dirname(apiPath),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })

  apiProcess.stdout.on('data', data => {
    console.log(`[api] ${data.toString().trim()}`)
  })

  apiProcess.stderr.on('data', data => {
    console.error(`[api] ${data.toString().trim()}`)
  })

  apiProcess.on('error', err => {
    console.error(`[api] Fork error: ${err.message}`)
  })

  apiProcess.on('exit', code => {
    console.log(`[api] Process exited with code ${code}`)
  })

  return new Promise((resolve) => {
    const check = () => {
      const http = require('http')
      const req = http.get(`http://localhost:${API_PORT}/api/platform`, res => {
        if (res.statusCode === 200) resolve()
        else setTimeout(check, 150)
      })
      req.on('error', () => setTimeout(check, 150))
      req.end()
    }
    setTimeout(check, 300)
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
  // Show window immediately — don't block on API
  createWindow()

  console.log('[managr] Starting API server...')
  try {
    await Promise.race([
      startApiServer(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('API startup timed out after 15s')), 15000))
    ])
    console.log('[managr] API server ready')
  } catch (err) {
    console.error('[managr] API failed to start:', err.message)
    // Show error in the window
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#DFD0B8;background:#222831;min-height:100vh"><h2>managr failed to start</h2><p style="color:#948979">The API server could not start. Error:</p><pre style="color:#a85454;background:#1a1e26;padding:12px;border-radius:6px">${err.message}</pre><p style="color:#948979">Try restarting the app.</p></div>'
      `)
    }
  }

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
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
})
