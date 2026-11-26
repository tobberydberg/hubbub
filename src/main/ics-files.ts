import { app, BrowserWindow, dialog } from 'electron'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

// Saving and opening iCalendar files for the calendar's export and import, through the system's
// file dialogs: the window never gets to read or write files of its own choosing.

const MAX = 20 * 1024 * 1024

/** Development only: a folder standing in for the file dialogs, for automated tests */
const testDir = (): string | undefined => (!app.isPackaged ? process.env.HUBBUB_TEST_ICS_DIR : undefined)

/** Asks where to save, and saves; resolves with the path, or null when cancelled */
export async function saveIcs(
  window: BrowserWindow | null,
  suggested: string,
  text: string
): Promise<string | null> {
  const name = `${suggested.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'calendar'}.ics`
  const dir = testDir()
  if (dir) {
    await writeFile(join(dir, name), text, 'utf8')
    return join(dir, name)
  }
  const options = {
    title: 'Export calendar',
    defaultPath: name,
    filters: [{ name: 'iCalendar', extensions: ['ics'] }]
  }
  const res = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
  if (res.canceled || !res.filePath) return null
  await writeFile(res.filePath, text, 'utf8')
  return res.filePath
}

/** Asks for an .ics file and reads it; resolves with its name and text, or null when cancelled */
export async function openIcs(window: BrowserWindow | null): Promise<{ name: string; text: string } | null> {
  const dir = testDir()
  if (dir) return { name: 'import.ics', text: await readFile(join(dir, 'import.ics'), 'utf8') }
  const options = {
    title: 'Import calendar file',
    properties: ['openFile' as const],
    filters: [{ name: 'iCalendar', extensions: ['ics', 'ical', 'ifb', 'icalendar'] }]
  }
  const res = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options)
  const path = res.filePaths[0]
  if (res.canceled || !path) return null
  if ((await stat(path)).size > MAX) throw new Error('The file is larger than 20 MB')
  return { name: basename(path), text: await readFile(path, 'utf8') }
}
