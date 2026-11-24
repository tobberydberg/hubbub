import { useCallback, useEffect, useState } from 'react'
import { AlarmClock, CalendarClock, Send, Trash2 } from 'lucide-react'
import { talk, type ScheduledMessage, type UpcomingReminder } from '@renderer/api/talk'
import { formatAt, laterChoices } from '@renderer/lib/time'
import { showToast, type AccountState } from '@renderer/store/app'
import { jumpToMessage } from '@renderer/sync/actions'
import { getSync } from '@renderer/sync/engine'
import { pickTime, removeReminder } from '@renderer/sync/messaging'

// Right-hand panel lists: our scheduled messages in a conversation, and our upcoming reminders.

const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Reminders and scheduled messages show their text with rich objects reduced to their names */
function plain(message: string, params: Record<string, { name: string }> | [] | undefined): string {
  const p = Array.isArray(params) ? {} : (params ?? {})
  return message.replace(/\{([a-z0-9-]+)\}/gi, (whole, key: string) => p[key]?.name ?? whole)
}

export function ScheduledPanel({ account, token }: { account: AccountState; token: string }) {
  const accountId = account.info.id
  const [items, setItems] = useState<ScheduledMessage[] | null>(null)
  const load = useCallback(
    () =>
      talk(accountId)
        .scheduled(token)
        .then((list) => setItems([...list].sort((a, b) => a.sendAt - b.sendAt)))
        .catch(() => setItems([])),
    [accountId, token]
  )
  useEffect(() => {
    void load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    try {
      await fn()
      if (done) showToast(done)
    } catch (err) {
      showToast(errorText(err), 'error')
    }
    await load()
    void getSync(accountId)?.refreshRooms()
  }

  return (
    <div className="rhs-body">
      {items === null && <div className="empty-state">Loading…</div>}
      {items?.length === 0 && <div className="empty-state">No scheduled messages in this conversation</div>}
      {items?.map((m) => (
        <div key={m.id} className="rhs-item">
          <div className="rhs-item-meta">
            <CalendarClock size={14} /> {formatAt(m.sendAt)}
            {m.silent && ' · without notification'}
            {m.threadTitle && ` · new thread “${m.threadTitle}”`}
          </div>
          <div className="rhs-item-text">{m.message}</div>
          <div className="rhs-item-actions">
            <button
              className="btn btn-tertiary small"
              onClick={() =>
                void run(async () => {
                  await talk(accountId).unschedule(token, m.id)
                  await talk(accountId).send(token, {
                    message: m.message,
                    referenceId: crypto.randomUUID().replace(/-/g, ''),
                    silent: m.silent,
                    threadId: m.threadId
                  })
                }, 'Sent')
              }
            >
              <Send size={14} /> Send now
            </button>
            <button
              className="btn btn-tertiary small"
              onClick={() =>
                pickTime(
                  'Send later',
                  'Reschedule',
                  m.sendAt,
                  (at) =>
                    void run(
                      () => talk(accountId).reschedule(token, m.id, { message: m.message, sendAt: at }),
                      `Rescheduled for ${formatAt(at)}`
                    )
                )
              }
            >
              <CalendarClock size={14} /> Change time
            </button>
            <button
              className="btn btn-tertiary small danger"
              onClick={() =>
                void run(() => talk(accountId).unschedule(token, m.id), 'Scheduled message deleted')
              }
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function RemindersPanel({ account }: { account: AccountState }) {
  const accountId = account.info.id
  const [items, setItems] = useState<UpcomingReminder[] | null>(null)
  const load = useCallback(
    () =>
      talk(accountId)
        .upcomingReminders()
        .then(setItems)
        .catch(() => setItems([])),
    [accountId]
  )
  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="rhs-body">
      {items === null && <div className="empty-state">Loading…</div>}
      {items?.length === 0 && (
        <div className="empty-state">
          No upcoming reminders. Use “Remind me…” in a message’s menu to set one.
        </div>
      )}
      {items?.map((r) => {
        const room = account.rooms[r.roomToken]
        return (
          <div key={`${r.roomToken}/${r.messageId}`} className="rhs-item">
            <div className="rhs-item-meta">
              <AlarmClock size={14} /> {formatAt(r.reminderTimestamp)}
              {room && ` · ${room.displayName}`}
            </div>
            <button
              className="rhs-item-text link"
              onClick={() => void jumpToMessage(accountId, r.roomToken, r.messageId)}
            >
              <b>{r.actorDisplayName}:</b> {plain(r.message, r.messageParameters)}
            </button>
            <div className="rhs-item-actions">
              <button
                className="btn btn-tertiary small"
                onClick={() =>
                  pickTime(
                    'Remind me',
                    'Change',
                    laterChoices()[3].at,
                    (at) => void talk(accountId).setReminder(r.roomToken, r.messageId, at).then(load)
                  )
                }
              >
                <CalendarClock size={14} /> Change
              </button>
              <button
                className="btn btn-tertiary small"
                onClick={() => void removeReminder(accountId, r.roomToken, r.messageId).then(load)}
              >
                <Trash2 size={14} /> Remove
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
