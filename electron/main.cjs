const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const { spawn } = require('child_process')
const fs = require('fs')

let mainWindow = null
let apiProcess = null
const API_PORT = 3456
const isDev = process.env.NODE_ENV === 'development'

function findNode() {
  // In Electron, process.execPath is the Electron binary, not node.
  // Use the system node instead so native modules (better-sqlite3) work.
  const { execSync } = require('child_process')
  const isWin = process.platform === 'win32'
  try {
    const cmd = isWin ? 'where node' : 'which node'
    const result = execSync(cmd, { encoding: 'utf-8' }).trim()
    // 'where' on Windows can return multiple lines — take the first
    return result.split(/\r?\n/)[0]
  } catch {
    return 'node' // fallback to PATH
  }
}

function getResourcePath(...segments) {
  // In production, files are packed into app.asar.
  // But the server needs to run outside asar as a real Node process.
  // Electron provides app.getAppPath() which points to the asar.
  // The unpacked files are at app.asar.unpacked or alongside the asar.
  const appPath = app.getAppPath()

  if (isDev) {
    return path.join(__dirname, '..', ...segments)
  }

  // Try app.asar.unpacked first (for files marked as asarUnpack)
  const unpackedPath = path.join(appPath.replace('app.asar', 'app.asar.unpacked'), ...segments)
  if (fs.existsSync(unpackedPath)) return unpackedPath

  // Fallback to regular path (outside asar)
  return path.join(appPath, ...segments)
}

function startApiServer() {
  const apiPath = getResourcePath('server', 'dist', 'src', 'api.js')
  const nodePath = findNode()

  console.log(`[managr] Node: ${nodePath}`)
  console.log(`[managr] API script: ${apiPath}`)
  console.log(`[managr] Exists: ${fs.existsSync(apiPath)}`)

  apiProcess = spawn(nodePath, [apiPath], {
    env: { ...process.env, MANAGR_API_PORT: String(API_PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Run outside of asar
    cwd: path.dirname(apiPath),
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
  if (apiProcess) {
    apiProcess.kill()
    apiProcess = null
  }
})
