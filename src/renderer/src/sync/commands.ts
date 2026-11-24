import { RoomType } from '@shared/talk-types'
import { talk, TalkError } from '@renderer/api/talk'
import { requestCall } from '@renderer/calls/call'
import { splitMentions, type SlashCommand } from '@renderer/lib/commands'
import { hasFeature, setApp, showToast, useApp } from '@renderer/store/app'
import { openSearch } from '@renderer/components/rhs/Rhs'
import {
  callPeople,
  confirmLeaveRoom,
  joinListedRoom,
  openDirectMessage,
  openRoom,
  sendMessage,
  setMuted,
  setUserStatus,
  type PersonRef
} from './actions'
import { loadDirectory } from './people'

// Runs slash commands (see lib/commands.ts).

export interface CommandContext {
  accountId: string
  token: string
  /** The native thread the command was typed in */
  threadId?: number
  /** Sends text where the command was typed (the conversation, or the thread) */
  send: (text: string) => void
  /** Puts text into the message box */
  setDraft: (text: string) => void
}

const STATUS: Record<string, [string, string]> = {
  away: ['away', 'Away'],
  online: ['online', 'Online'],
  dnd: ['dnd', 'Do not disturb'],
  offline: ['invisible', 'Offline']
}

/** People by user id, with their names from the directory where known */
async function people(accountId: string, ids: string[]): Promise<PersonRef[]> {
  const directory = await loadDirectory(accountId).catch(() => null)
  return ids.map((id) => ({ id, name: directory?.people.find((p) => p.id === id)?.name ?? id }))
}

function needsMentions(command: SlashCommand, users: string[]): boolean {
  if (users.length) return false
  showToast(`Add someone with @ after /${command.name}, e.g. /${command.name} ${command.args}`, 'error')
  return true
}

export async function runCommand(ctx: CommandContext, command: SlashCommand, args: string): Promise<void> {
  const { accountId, token } = ctx
  const api = talk(accountId)
  const account = useApp.getState().accounts[accountId]
  const room = account?.rooms[token]
  if (command.argsRequired && !args) {
    ctx.setDraft(`/${command.name} `)
    showToast(`Usage: /${command.name} ${command.args}`)
    return
  }

  try {
    switch (command.name) {
      case 'away':
      case 'online':
      case 'dnd':
      case 'offline': {
        const [status, label] = STATUS[command.name]
        await setUserStatus(accountId, status)
        showToast(`Your status is now ${label}`)
        break
      }
      case 'status':
        if (args) await api.setStatusMessage(args)
        else await api.clearStatusMessage()
        showToast(args ? `Status message set: ${args}` : 'Status message cleared')
        break
      case 'msg': {
        const { users, text } = splitMentions(args)
        // "/msg bob hi" works too
        const userId = users[0] ?? args.split(/\s+/)[0]
        const message = users.length ? text : args.slice(userId.length).trim()
        const dm = await openDirectMessage(accountId, userId)
        if (message) void sendMessage(accountId, dm, message)
        break
      }
      case 'call': {
        const { users } = splitMentions(args)
        if (users.length) await callPeople(accountId, await people(accountId, users))
        else await requestCall(accountId, token)
        break
      }
      case 'invite': {
        const { users } = splitMentions(args)
        if (needsMentions(command, users)) break
        if (room?.type === RoomType.OneToOne) {
          showToast(
            'A direct message can’t take more people. Use /call @someone to call several people.',
            'error'
          )
          break
        }
        for (const id of users) await api.addParticipant(token, id)
        showToast(users.length === 1 ? `Added ${users[0]}` : `Added ${users.length} people`)
        break
      }
      case 'kick': {
        const { users } = splitMentions(args)
        if (needsMentions(command, users)) break
        const members = await api.participants(token)
        const m = members.find((x) => x.actorType === 'users' && x.actorId === users[0])
        if (!m) {
          showToast(`${users[0]} is not in this conversation`, 'error')
          break
        }
        setApp({
          modal: {
            type: 'confirm',
            title: `Remove ${m.displayName}?`,
            body: `${m.displayName} will no longer be in ${room?.displayName ?? 'this conversation'}.`,
            confirmLabel: 'Remove',
            danger: true,
            onConfirm: () =>
              void api.removeAttendee(token, m.attendeeId).then(
                () => showToast(`Removed ${m.displayName}`),
                (err) => showToast(errorText(err), 'error')
              )
          }
        })
        break
      }
      case 'join': {
        const name = args.replace(/^[~#]/, '').toLowerCase()
        const rooms = Object.values(account?.rooms ?? {})
        const found =
          rooms.find((r) => r.displayName.toLowerCase() === name) ??
          rooms.find((r) => r.displayName.toLowerCase().startsWith(name))
        if (found) {
          openRoom(accountId, found.token)
          break
        }
        const listed = await api.listedRooms(args).catch(() => [])
        if (listed[0]) await joinListedRoom(accountId, listed[0].token)
        else showToast(`No conversation called “${args}”`, 'error')
        break
      }
      case 'leave':
        confirmLeaveRoom(accountId, token)
        break
      case 'mute':
      case 'unmute':
        await setMuted(accountId, token, command.name === 'mute')
        showToast(command.name === 'mute' ? 'Notifications muted' : 'Notifications unmuted')
        break
      case 'header':
        await api.setDescription(token, args)
        showToast(args ? 'Description updated' : 'Description removed')
        break
      case 'rename':
        await api.rename(token, args)
        break
      case 'me':
        ctx.send(`_${args}_`)
        break
      case 'shrug':
        // Escaped so Markdown keeps the backslash and underscores
        ctx.send(`${args ? `${args} ` : ''}¯\\\\\\_(ツ)\\_/¯`)
        break
      case 'code':
        ctx.send(`\`\`\`\n${args}\n\`\`\``)
        break
      case 'poll':
        if (!hasFeature(account, 'talk-polls')) throw new Error('This server does not support polls')
        if (room && (room.type === RoomType.OneToOne || room.type === RoomType.NoteToSelf)) {
          throw new Error('Polls need a group conversation')
        }
        setApp({ modal: { type: 'poll', accountId, token, threadId: ctx.threadId, question: args } })
        break
      case 'meeting':
        if (!hasFeature(account, 'schedule-meeting')) {
          throw new Error('This server cannot schedule meetings')
        }
        setApp({ modal: { type: 'meeting', accountId, token } })
        break
      case 'search':
        openSearch(accountId, args)
        break
      case 'settings':
        setApp({ modal: { type: 'settings' } })
        break
      case 'help':
        ctx.setDraft('/')
        break
    }
  } catch (err) {
    showToast(`/${command.name}: ${errorText(err)}`, 'error')
  }
}

function errorText(err: unknown): string {
  if (err instanceof TalkError && err.status === 403) return 'You aren’t allowed to do that here'
  return err instanceof Error ? err.message : String(err)
}
