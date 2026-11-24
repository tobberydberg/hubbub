import { searchEmojis, type EmojiInfo } from 'emoji-picker-react/data'

// Emoji while typing, like Mattermost: ":thu" suggests 👍, ":thumbsup:" and emoticons like ":-)"
// turn into the emoji. Shortcodes are the emoji's names with underscores ("slightly_smiling_face"),
// plus the short ones people know from Slack, Mattermost and GitHub.

export interface EmojiSuggestion {
  emoji: string
  /** Shortcode without the colons */
  code: string
}

const ALIASES: Record<string, string> = {
  '+1': '👍',
  '-1': '👎',
  thumbsup: '👍',
  thumbsdown: '👎',
  smile: '😄',
  smiley: '😃',
  grin: '😁',
  laughing: '😆',
  joy: '😂',
  rofl: '🤣',
  wink: '😉',
  blush: '😊',
  slight_smile: '🙂',
  heart_eyes: '😍',
  kissing_heart: '😘',
  sweat_smile: '😅',
  thinking: '🤔',
  neutral_face: '😐',
  confused: '😕',
  disappointed: '😞',
  cry: '😢',
  sob: '😭',
  angry: '😠',
  rage: '😡',
  scream: '😱',
  sunglasses: '😎',
  heart: '❤️',
  broken_heart: '💔',
  ok_hand: '👌',
  clap: '👏',
  pray: '🙏',
  wave: '👋',
  muscle: '💪',
  raised_hands: '🙌',
  tada: '🎉',
  fire: '🔥',
  rocket: '🚀',
  eyes: '👀',
  '100': '💯',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  warning: '⚠️',
  coffee: '☕',
  beer: '🍺',
  star: '⭐',
  sparkles: '✨',
  bulb: '💡',
  zap: '⚡'
}

/** Emoticons and their emoji, longest first so ":-)" wins over ":)" */
const EMOTICONS: [string, string][] = (
  [
    [":'-(", '😢'],
    [":'(", '😢'],
    ['</3', '💔'],
    [':-)', '🙂'],
    [':)', '🙂'],
    [':-]', '🙂'],
    [':]', '🙂'],
    [':-(', '🙁'],
    [':(', '🙁'],
    [';-)', '😉'],
    [';)', '😉'],
    [':-D', '😃'],
    [':D', '😃'],
    [':-P', '😛'],
    [':P', '😛'],
    [':-p', '😛'],
    [':p', '😛'],
    [':-O', '😮'],
    [':O', '😮'],
    [':-o', '😮'],
    [':o', '😮'],
    [':-|', '😐'],
    [':|', '😐'],
    [':-/', '😕'],
    [':/', '😕'],
    [':-*', '😘'],
    [':*', '😘'],
    ['B-)', '😎'],
    ['8-)', '😎'],
    ['<3', '❤️']
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length)

const EMOTICON = new Map(EMOTICONS)

const codeOf = (e: EmojiInfo): string => e.name.replace(/[^a-z0-9+-]+/gi, '_').toLowerCase()

/**
 * The emoji query being typed at the caret: a ":" at the start of a word and at least two characters
 * after it, like Mattermost (so "12:30" and ":)" don't open the list).
 */
export function emojiQuery(text: string, caret: number): { start: number; query: string } | null {
  const m = /(^|[\s(])(:([a-z0-9_+-]{2,}))$/i.exec(text.slice(0, caret))
  if (!m) return null
  return { start: caret - m[2].length, query: m[3].toLowerCase() }
}

/** Best matches first: shortcodes and names that start with the query, then names containing it. */
export function searchEmoji(query: string, limit = 8): EmojiSuggestion[] {
  const q = query.toLowerCase()
  const words = q.replace(/_/g, ' ')
  const scored: { s: EmojiSuggestion; score: number; order: number }[] = []
  const seen = new Set<string>()
  const add = (s: EmojiSuggestion, score: number): void => {
    if (seen.has(s.emoji)) return
    seen.add(s.emoji)
    scored.push({ s, score, order: scored.length })
  }
  for (const [code, emoji] of Object.entries(ALIASES)) {
    if (code === q) add({ emoji, code }, 0)
    else if (code.startsWith(q)) add({ emoji, code }, 1)
  }
  for (const e of searchEmojis(words)) {
    const name = e.name.toLowerCase()
    const score =
      name === words
        ? 0
        : name.startsWith(words)
          ? 2
          : name.split(' ').some((w) => w.startsWith(words))
            ? 3
            : e.names.some((n) => n.startsWith(words))
              ? 4
              : 5
    add({ emoji: e.emoji, code: codeOf(e) }, score)
  }
  // Names merely containing the query ("thu" in "Lithuania") only when nothing starts with it
  const anyStart = scored.some((x) => x.score < 5)
  return scored
    .filter((x) => !anyStart || x.score < 5)
    .sort((a, b) => a.score - b.score || a.order - b.order)
    .slice(0, limit)
    .map((x) => x.s)
}

/** The emoji for a complete shortcode, e.g. "thumbsup" or "slightly_smiling_face". */
export function emojiForCode(code: string): string | undefined {
  const c = code.toLowerCase()
  if (ALIASES[c]) return ALIASES[c]
  const name = c.replace(/_/g, ' ')
  return searchEmojis(name).find((e) => e.name.toLowerCase() === name)?.emoji
}

/** Whether `index` is inside inline code or a code block, where nothing is converted. */
function inCode(text: string, index: number): boolean {
  const before = text.slice(0, index)
  if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return true
  const line = before.slice(before.lastIndexOf('\n') + 1).replace(/```/g, '')
  return (line.match(/`/g)?.length ?? 0) % 2 === 1
}

/** A word that becomes an emoji: an emoticon or a complete ":shortcode:". */
function emojiForWord(word: string): string | undefined {
  const emoticon = EMOTICON.get(word)
  if (emoticon) return emoticon
  const m = /^:([a-z0-9_+-]+):$/i.exec(word)
  return m ? emojiForCode(m[1]) : undefined
}

export interface Conversion {
  text: string
  caret: number
  /** What was replaced, to undo it with Backspace */
  undo: { text: string; caret: number }
}

/**
 * After a keystroke: converts the word that was just finished, either by a space or new line after
 * an emoticon (":-) ") or by the closing colon of a shortcode (":tada:").
 */
export function convertAtCaret(text: string, caret: number): Conversion | null {
  const before = text.slice(0, caret)
  const typed = before.slice(-1)
  let end: number
  if (/\s/.test(typed)) end = caret - 1
  else if (typed === ':') end = caret
  else return null
  const start = Math.max(before.lastIndexOf(' ', end - 1), before.lastIndexOf('\n', end - 1)) + 1
  const word = text.slice(start, end)
  // A colon only finishes shortcodes; ":D:" or "a:b:" stay as they are
  if (typed === ':' && !word.startsWith(':')) return null
  const emoji = emojiForWord(word)
  if (!emoji || inCode(text, start)) return null
  const next = text.slice(0, start) + emoji + text.slice(end)
  return { text: next, caret: caret - word.length + emoji.length, undo: { text, caret } }
}

/** Before sending: converts an emoticon or shortcode the message ends with (":-)" then Enter). */
export function convertLastWord(text: string): string {
  const m = /(^|\s)(\S+)$/.exec(text)
  if (!m) return text
  const emoji = emojiForWord(m[2])
  if (!emoji || inCode(text, text.length - m[2].length)) return text
  return text.slice(0, text.length - m[2].length) + emoji
}
