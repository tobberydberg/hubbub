import { clipboard, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

// Electron shows no context menu by default: this adds the usual one, with spelling suggestions,
// clipboard actions and link/image entries.

export function installContextMenu(win: BrowserWindow, isSafeUrl: (url: string) => boolean): void {
  const wc = win.webContents
  wc.on('context-menu', (_event, p) => {
    const items: MenuItemConstructorOptions[] = []
    const section = (entries: MenuItemConstructorOptions[]): void => {
      if (!entries.length) return
      if (items.length) items.push({ type: 'separator' })
      items.push(...entries)
    }

    if (p.isEditable && p.misspelledWord) {
      section([
        ...p.dictionarySuggestions
          .slice(0, 5)
          .map((s): MenuItemConstructorOptions => ({ label: s, click: () => wc.replaceMisspelling(s) })),
        ...(p.dictionarySuggestions.length ? [] : [{ label: 'No suggestions', enabled: false }]),
        {
          label: 'Add to dictionary',
          click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord)
        }
      ])
    }

    // Internal links (mentions) are handled by the app itself; only offer real web links
    if (p.linkURL && isSafeUrl(p.linkURL)) {
      section([
        { label: 'Open link', click: () => void shell.openExternal(p.linkURL) },
        { label: 'Copy link', click: () => clipboard.writeText(p.linkURL) }
      ])
    }

    if (p.mediaType === 'image' && p.srcURL) {
      section([{ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) }])
    }

    if (p.isEditable) {
      section([
        { role: 'undo', enabled: p.editFlags.canUndo },
        { role: 'redo', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: p.editFlags.canCut },
        { role: 'copy', enabled: p.editFlags.canCopy },
        { role: 'paste', enabled: p.editFlags.canPaste },
        { role: 'pasteAndMatchStyle', enabled: p.editFlags.canPaste },
        { role: 'selectAll', enabled: p.editFlags.canSelectAll }
      ])
    } else if (p.selectionText.trim()) {
      section([{ role: 'copy' }])
    }

    if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
  })
}
