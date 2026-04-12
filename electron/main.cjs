const { app, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, execSync } = require('child_process')

let mainWindow = null
let apiProcess = null
const API_PORT = 3456
const isDev = process.env.NODE_ENV === 'development'

function findSystemNode() {
  try {
    const cmd = process.platform === 'win32' ? 'where node' : 'which node'
    const result = execSync(cmd, { encoding: 'utf-8', windowsHide: true }).trim()
    return result.split(/\r?\n/)[0]
  } catch {
    return null
  }
}

function getResourcePath(...segments) {
  const appPath = app.getAppPath()
  if (isDev) return path.join(__dirname, '..', ...segments)
  const unpackedPath = path.join(appPath.replace('app.asar', 'app.asar.unpacked'), ...segments)
  if (fs.existsSync(unpackedPath)) return unpackedPath
  return path.join(appPath, ...segments)
}

function startApiServer() {
  const apiPath = getResourcePath('server', 'dist', 'src', 'api.js')
  const nodePath = findSystemNode()

  console.log(`[managr] API: ${apiPath}`)
  console.log(`[managr] Node: ${nodePath || 'not found, using fork'}`)

  if (nodePath) {
    // Use system Node — guaranteed to work with installed native modules
    apiProcess = spawn(nodePath, [apiPath], {
      env: { ...process.env, MANAGR_API_PORT: String(API_PORT) },
      cwd: path.dirname(apiPath),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  } else {
    // Fallback: fork with Electron's Node
    const { fork } = require('child_process')
    apiProcess = fork(apiPath, [], {
      env: { ...process.env, MANAGR_API_PORT: String(API_PORT) },
      cwd: path.dirname(apiPath),
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
  }

  apiProcess.stdout.on('data', d => console.log(`[api] ${d.toString().trim()}`))
  apiProcess.stderr.on('data', d => console.error(`[api] ${d.toString().trim()}`))
  apiProcess.on('error', e => console.error(`[api] Error: ${e.message}`))
  apiProcess.on('exit', code => console.log(`[api] Exited: ${code}`))

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
    mainWindow.loadFile(getResourcePath('dist', 'index.html'))
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

app.whenReady().then(async () => {
  createWindow()

  console.log('[managr] Starting API server...')
  try {
    await Promise.race([
      startApiServer(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('API startup timed out after 15s')), 15000))
    ])
    console.log('[managr] API server ready')
  } catch (err) {
    console.error('[managr] API failed:', err.message)
    if (mainWindow) {
      mainWindow.webContents.executeJavaScript(`
        document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#DFD0B8;background:#222831;min-height:100vh"><h2>managr failed to start</h2><p style="color:#948979">The API server could not start. Error:</p><pre style="color:#a85454;background:#1a1e26;padding:12px;border-radius:6px">${err.message}</pre><p style="color:#948979">Try restarting the app or install <a href="https://nodejs.org" style="color:#948979">Node.js</a>.</p></div>'
      `)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (apiProcess) { apiProcess.kill(); apiProcess = null }
})
