/**
 * After electron-builder packs the app, copy the Electron-rebuilt
 * better-sqlite3 native module into the server's unpacked node_modules.
 * This ensures the forked API process uses the correct binary.
 */
const path = require('path')
const fs = require('fs')

exports.default = async function afterPack(context) {
  const appDir = path.join(context.appOutDir, 'resources', 'app.asar.unpacked')

  // Source: root node_modules (rebuilt for Electron by electron-builder)
  const rootBinding = path.join(appDir, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')

  // Destination: server node_modules (still has system-Node binary)
  const serverBinding = path.join(appDir, 'server', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')

  if (fs.existsSync(rootBinding) && fs.existsSync(path.dirname(serverBinding))) {
    console.log('[afterPack] Copying Electron-rebuilt better-sqlite3 to server/node_modules')
    fs.copyFileSync(rootBinding, serverBinding)
    console.log('[afterPack] Done')
  } else {
    console.log('[afterPack] Root binding:', fs.existsSync(rootBinding))
    console.log('[afterPack] Server dir:', fs.existsSync(path.dirname(serverBinding)))
  }
}
