const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')

let mainWindow = null
let apiProcess = null
const API_PORT = 3456
const isDev = process.env.NODE_ENV === 'development'

function findNode() {
  // In Electron, process.execPath is the Electron binary, not node.
  // Use the system node instead so native modules (better-sqlite3) work.
  const { execSync } = require('child_process')
  try {
    return execSync('which node', { encoding: 'utf-8' }).trim()
  } catch {
    return 'node' // fallback to PATH
  }
}

function startApiServer() {
  const apiPath = path.join(__dirname, '..', 'server', 'dist', 'src', 'api.js')
  const nodePath = findNode()

  apiProcess = spawn(nodePath, [apiPath], {
    env: { ...process.env, MANAGR_API_PORT: String(API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  apiProcess.stdout.on('data', data => {
    console.log(`[api] ${data.toString().trim()}`)
  })

  apiProcess.stderr.on('data', data => {
    console.error(`[api] ${data.toString().trim()}`)
  })

  apiProcess.on('exit', code => {
    console.log(`[api] Process exited with code ${code}`)
  })

  return new Promise((resolve) => {
    // Wait for the API to be ready
    const check = () => {
      const http = require('http')
      const req = http.get(`http://localhost:${API_PORT}/api/platform`, res => {
        if (res.statusCode === 200) {
          resolve()
        } else {
          setTimeout(check, 200)
        }
      })
      req.on('error', () => setTimeout(check, 200))
      req.end()
    }
    setTimeout(check, 500)
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

  // Show once content is ready to avoid white flash
  mainWindow.once('ready-to-show', () => mainWindow.show())

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // Load the built React app
    const indexPath = path.join(__dirname, '..', 'dist', 'index.html')
    mainWindow.loadFile(indexPath)
  }

  // Open external links in the default browser
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
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
})
