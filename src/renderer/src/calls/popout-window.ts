// The popped-out call window, for code outside the call view that needs to know about it (whether
// it has the focus, for marking the call's chat read).

let current: Window | null = null

export function setCallWindow(win: Window | null): void {
  current = win
}

export function callWindowFocused(): boolean {
  try {
    return !!current && !current.closed && current.document.hasFocus()
  } catch {
    return false
  }
}
