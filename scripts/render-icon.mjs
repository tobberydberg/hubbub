// Renders the SVG icons to the PNGs electron-builder and the app need. Run with: npm run icons
//   build/icon.svg  -> build/icon.png (1024), resources/icon.png (512), src/renderer/src/assets/logo.svg
//   build/tray.svg  -> resources/tray.png (+ @2x) and resources/tray-unread.png (+ @2x)
import { app, BrowserWindow } from 'electron'
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => readFileSync(join(root, p), 'utf8')
const UNREAD_DOT = '<circle cx="840" cy="184" r="184" fill="#d24b4e" stroke="#ffffff" stroke-width="48"/>'

app.disableHardwareAcceleration()
// Each render closes its window; don't let that quit the app before all icons are written
app.on('window-all-closed', () => {})

async function render(svg, size) {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    transparent: true,
    frame: false,
    useContentSize: true,
    webPreferences: { offscreen: true }
  })
  const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((r) => setTimeout(r, 400))
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size })
  win.destroy()
  return image.resize({ width: size, height: size, quality: 'best' })
}

app.whenReady().then(async () => {
  const icon = read('build/icon.svg')
  const png = await render(icon, 1024)
  writeFileSync(join(root, 'build/icon.png'), png.toPNG())
  writeFileSync(
    join(root, 'resources/icon.png'),
    png.resize({ width: 512, height: 512, quality: 'best' }).toPNG()
  )
  copyFileSync(join(root, 'build/icon.svg'), join(root, 'src/renderer/src/assets/logo.svg'))

  // Render trays large and downscale, which keeps the small sizes smooth
  const tray = read('build/tray.svg')
  const unread = tray.replace('</svg>', `${UNREAD_DOT}</svg>`)
  for (const [name, svg] of [
    ['tray', tray],
    ['tray-unread', unread]
  ]) {
    const big = await render(svg, 256)
    writeFileSync(
      join(root, `resources/${name}.png`),
      big.resize({ width: 16, height: 16, quality: 'best' }).toPNG()
    )
    writeFileSync(
      join(root, `resources/${name}@2x.png`),
      big.resize({ width: 32, height: 32, quality: 'best' }).toPNG()
    )
  }
  console.log('Wrote build/icon.png, resources/icon.png, resources/tray*.png and the renderer logo')
  app.quit()
})
