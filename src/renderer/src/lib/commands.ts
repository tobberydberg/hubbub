// Slash commands, as in Mattermost: a message starting with "/" and a known command runs it instead
// of being sent. Unknown commands are sent as they are (Talk bots often react to "/something"), and
// "//" sends a message that starts with a slash.

export interface SlashCommand {
  name: string
  aliases?: string[]
  /** Usage of the arguments, e.g. "@someone [message]" */
  args?: string
  /** The command does nothing without arguments */
  argsRequired?: boolean
  description: string
}

export const COMMANDS: SlashCommand[] = [
  { name: 'away', description: 'Set your status to Away' },
  { name: 'online', description: 'Set your status to Online' },
  { name: 'dnd', description: 'Set your status to Do not disturb' },
  { name: 'offline', description: 'Appear offline to others' },
  { name: 'status', args: '[message]', description: 'Set your status message, or clear it' },
  {
    name: 'msg',
    aliases: ['dm'],
    args: '@someone [message]',
    argsRequired: true,
    description: 'Open a direct message, and send a message if you add one'
  },
  { name: 'call', args: '[@someone …]', description: 'Start a call here, or call people' },
  {
    name: 'invite',
    aliases: ['add'],
    args: '@someone …',
    argsRequired: true,
    description: 'Add people to this conversation'
  },
  {
    name: 'kick',
    aliases: ['remove'],
    args: '@someone',
    argsRequired: true,
    description: 'Remove someone from this conversation'
  },
  { name: 'join', args: 'conversation', argsRequired: true, description: 'Open a conversation by name' },
  { name: 'leave', description: 'Leave this conversation' },
  { name: 'mute', description: 'Mute notifications for this conversation' },
  { name: 'unmute', description: 'Unmute notifications for this conversation' },
  {
    name: 'header',
    aliases: ['purpose'],
    args: 'text',
    description: 'Set the description of this conversation'
  },
  { name: 'rename', args: 'name', argsRequired: true, description: 'Rename this conversation' },
  {
    name: 'me',
    args: 'action',
    argsRequired: true,
    description: 'Send an action in italics, like /me waves'
  },
  { name: 'poll', args: '[question]', description: 'Create a poll in this conversation' },
  { name: 'meeting', description: 'Schedule a meeting for this conversation in your calendar' },
  { name: 'shrug', args: '[message]', description: 'Add ¯\\_(ツ)_/¯ to your message' },
  { name: 'code', args: 'text', argsRequired: true, description: 'Send text as a code block' },
  { name: 'search', args: 'terms', argsRequired: true, description: 'Search messages' },
  { name: 'settings', description: 'Open the settings' },
  { name: 'help', description: 'Show the slash commands' }
]

function find(name: string): SlashCommand | undefined {
  const n = name.toLowerCase()
  return COMMANDS.find((c) => c.name === n || c.aliases?.includes(n))
}

/** The command a message runs, or null to send it as a message. */
export function parseCommand(text: string): { command: SlashCommand; args: string } | null {
  const m = /^\/([a-z]+)(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const command = find(m[1])
  if (!command) return null
  return { command, args: (m[2] ?? '').trim() }
}

/** "//text" is sent as "/text" */
export function unescapeSlash(text: string): string {
  return text.startsWith('//') ? text.slice(1) : text
}

/** Commands for the suggestion list while the first word is being typed ("/", "/ca", …). */
export function commandSuggestions(draft: string): SlashCommand[] | null {
  const m = /^\/([a-z]*)$/i.exec(draft)
  if (!m) return null
  const prefix = m[1].toLowerCase()
  return COMMANDS.filter((c) => c.name.startsWith(prefix) || c.aliases?.some((a) => a.startsWith(prefix)))
}

/** The known command being typed, for a usage hint ("/msg …"). */
export function commandInProgress(draft: string): SlashCommand | null {
  const m = /^\/([a-z]+)\s/i.exec(draft)
  return m ? (find(m[1]) ?? null) : null
}

/**
 * Splits arguments into mentioned user ids (as the mention autocomplete inserts them: @alice or
 * @"user id") and the rest of the text.
 */
export function splitMentions(args: string): { users: string[]; text: string } {
  const users: string[] = []
  let rest = args
  const re = /^\s*@(?:"([^"]+)"|(\S+))/
  for (let m = re.exec(rest); m; m = re.exec(rest)) {
    users.push(m[1] ?? m[2])
    rest = rest.slice(m[0].length)
  }
  return { users, text: rest.trim() }
}
