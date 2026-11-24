import type { ChatMessage } from '@shared/talk-types'
import { talk } from '@renderer/api/talk'
import { formatAt } from '@renderer/lib/time'
import { setApp, showToast } from '@renderer/store/app'
import { getSync } from './engine'

// Reminders, pinned messages and scheduled messages.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export async function remindMe(
  accountId: string,
  token: string,
  messageId: number,
  at: number
): Promise<void> {
  try {
    await talk(accountId).setReminder(token, messageId, at)
    showToast(`Hubbub will remind you ${formatAt(at).replace(/^(Today|Tomorrow)/, (d) => d.toLowerCase())}`)
  } catch (err) {
    showToast(`Could not set the reminder: ${errorText(err)}`, 'error')
  }
}

export async function removeReminder(accountId: string, token: string, messageId: number): Promise<void> {
  try {
    await talk(accountId).deleteReminder(token, messageId)
    showToast('Reminder removed')
  } catch (err) {
    showToast(`Could not remove the reminder: ${errorText(err)}`, 'error')
  }
}

/** Asks for a date and time, starting at `initial` (unix seconds). */
export function pickTime(
  title: string,
  confirmLabel: string,
  initial: number,
  onPick: (at: number) => void
): void {
  setApp({ modal: { type: 'pick-time', title, confirmLabel, initial, onPick } })
}

export async function pinMessage(
  accountId: string,
  token: string,
  msg: ChatMessage,
  until?: number
): Promise<void> {
  try {
    await talk(accountId).pin(token, msg.id, until)
    void getSync(accountId)?.refreshRooms()
  } catch (err) {
    showToast(`Could not pin the message: ${errorText(err)}`, 'error')
  }
}

export async function unpinMessage(accountId: string, token: string, messageId: number): Promise<void> {
  try {
    await talk(accountId).unpin(token, messageId)
    void getSync(accountId)?.refreshRooms()
  } catch (err) {
    showToast(`Could not unpin the message: ${errorText(err)}`, 'error')
  }
}

/** Hides the pinned message bar for us; it comes back when another message is pinned. */
export async function hidePinned(accountId: string, token: string, messageId: number): Promise<void> {
  try {
    await talk(accountId).hidePin(token, messageId)
    void getSync(accountId)?.refreshRooms()
  } catch (err) {
    showToast(`Could not hide the pinned message: ${errorText(err)}`, 'error')
  }
}

export async function scheduleMessage(
  accountId: string,
  token: string,
  message: string,
  sendAt: number,
  extras: { replyTo?: number; threadId?: number; threadTitle?: string; silent?: boolean } = {}
): Promise<boolean> {
  try {
    await talk(accountId).schedule(token, { message, sendAt, ...extras })
    showToast(`Message scheduled for ${formatAt(sendAt)}`)
    void getSync(accountId)?.refreshRooms()
    return true
  } catch (err) {
    showToast(`Could not schedule the message: ${errorText(err)}`, 'error')
    return false
  }
}
