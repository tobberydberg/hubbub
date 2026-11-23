#!/usr/bin/env node
// A small in-memory mock of the Nextcloud Talk APIs that Hubbub uses, for development,
// screenshots and demos without a real server.
//
//   npm run mock-server                         # http://localhost:8686, user "alice"
//   PORT=8687 MOCK_NAME="Partner Cloud" npm run mock-server
//
// Sign in from Hubbub with server http://localhost:8686, login "alice" and any app password,
// or use the browser login flow (the mock login page has a "Grant access" button).
// Set MOCK_CHATTY=1 to have Bob answer your direct messages.

import { createServer } from 'node:http'
import { createServer as createTlsServer } from 'node:https'
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'

const PORT = Number(process.env.PORT || 8686)
const NAME = process.env.MOCK_NAME || 'Mock Cloud'
const CHATTY = process.env.MOCK_CHATTY === '1'
/** Seconds after start when someone replies to a reply chain Alice took part in (0 = never) */
const LATE_REPLY = Number(process.env.MOCK_LATE_REPLY || 0)
// MOCK_TLS_CERT/MOCK_TLS_KEY: serve HTTPS (e.g. with a self-signed certificate, to test trusting it)
const TLS =
  process.env.MOCK_TLS_CERT && process.env.MOCK_TLS_KEY
    ? { cert: readFileSync(process.env.MOCK_TLS_CERT), key: readFileSync(process.env.MOCK_TLS_KEY) }
    : null
/** MOCK_REJECT_AUTH=1 answers 401 to everything, like a revoked app password */
const REJECT_AUTH = process.env.MOCK_REJECT_AUTH === '1'
const BASE = `${TLS ? 'https' : 'http'}://localhost:${PORT}`
const SELF = { id: 'alice', displayname: 'Alice Andersson' }

const users = {
  alice: { name: 'Alice Andersson', status: 'online', color: '#1c58d9' },
  bob: { name: 'Bob Berg', status: 'online', color: '#3db887' },
  carol: { name: 'Carol Chen', status: 'away', color: '#e07315' },
  dave: { name: 'Dave Dahl', status: 'dnd', color: '#9b4dca' },
  erin: { name: 'Erin Ek', status: 'offline', color: '#d24b4e' }
}

// A larger directory, to exercise people search
const FIRST = ['Anna', 'Åke', 'Björn', 'Cecilia', 'David', 'Elin', 'Fredrik', 'Gunilla', 'Henrik', 'Ida']
const LAST = ['Svensson', 'Öberg', 'Lindqvist', 'Nilsson']
for (const f of FIRST) {
  for (const l of LAST) {
    const id = `${f}.${l}`
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
    users[id] = { name: `${f} ${l}`, status: 'offline', color: '#5d6ab9' }
  }
}
const email = (id) => `${id}@example.com`
/** Thread notification levels set by the user: threadId -> level */
const threadLevels = new Map()

const now = () => Math.floor(Date.now() / 1000)
let nextId = 1000
let ciMessage = null
const rooms = new Map()
const messages = new Map() // token -> message[]
const tags = [{ id: '7001', name: 'Projects', sortOrder: 0, collapsed: false, type: 'custom' }]
const files = new Map() // fileId -> { name, mime, data }
const waiters = new Map() // token -> [{ since, threadId, resolve }]
const pendingFlows = new Map()

function room(token, type, name, displayName, extra = {}) {
  rooms.set(token, {
    id: rooms.size + 1,
    token,
    type,
    name,
    displayName,
    description: '',
    isFavorite: false,
    isArchived: false,
    readOnly: 0,
    unreadMessages: 0,
    unreadMention: false,
    unreadMentionDirect: false,
    lastActivity: now(),
    lastReadMessage: 0,
    notificationLevel: 0,
    participantType: 3,
    permissions: 254,
    avatarVersion: '1',
    canLeaveConversation: true,
    hasCall: false,
    tagIds: [],
    ...extra
  })
  messages.set(token, [])
}

function mentionParams(text) {
  const params = {}
  let i = 0
  const message = text.replace(/@(\w+)/g, (whole, id) => {
    if (id === 'all') {
      params[`mention-call${++i}`] = { type: 'call', id: 'all', name: 'Everyone' }
      return `{mention-call${i}}`
    }
    if (!users[id]) return whole
    params[`mention-user${++i}`] = { type: 'user', id, name: users[id].name, mention: id }
    return `{mention-user${i}}`
  })
  return { message, params }
}

function addMessage(token, actorId, text, opts = {}) {
  const list = messages.get(token)
  const id = ++nextId
  const { message, params } = mentionParams(text)
  const parent = opts.replyTo ? list.find((m) => m.id === opts.replyTo) : undefined
  let threadId = id
  if (parent) threadId = parent.threadId || parent.id
  else if (opts.threadId) threadId = opts.threadId
  const root = list.find((m) => m.id === threadId)
  const msg = {
    id,
    token,
    actorType: 'users',
    actorId,
    actorDisplayName: users[actorId]?.name ?? actorId,
    timestamp: opts.timestamp ?? now(),
    message,
    messageParameters: { ...params, ...(opts.params ?? {}) },
    messageType: 'comment',
    systemMessage: opts.system ?? '',
    isReplyable: !opts.system,
    referenceId: opts.referenceId ?? '',
    markdown: true,
    reactions: opts.reactions ?? {},
    reactionsSelf: opts.reactionsSelf ?? [],
    threadId,
    ...(opts.threadTitle ? { isThread: true, threadTitle: opts.threadTitle, threadReplies: 0 } : {}),
    ...(root?.isThread && root.id !== id ? { isThread: true, threadTitle: root.threadTitle } : {})
  }
  if (root?.isThread && root.id !== id) root.threadReplies++
  if (parent) msg.parent = strip(parent)
  list.push(msg)
  const r = rooms.get(token)
  r.lastActivity = msg.timestamp
  r.lastMessage = strip(msg)
  if (actorId !== SELF.id && !opts.system) {
    r.unreadMessages++
    if (text.includes('@alice') || text.includes('@all')) r.unreadMention = true
  } else if (actorId === SELF.id) {
    r.lastReadMessage = id
    r.unreadMessages = 0
    r.unreadMention = false
  }
  wake(token)
  return msg
}

function threadInfo(root) {
  const list = messages.get(root.token) ?? []
  const replies = list.filter((x) => x.threadId === root.id && x.id !== root.id)
  return {
    thread: {
      id: root.id,
      roomToken: root.token,
      title: root.threadTitle,
      lastMessageId: replies.at(-1)?.id ?? root.id,
      lastActivity: (replies.at(-1) ?? root).timestamp,
      numReplies: replies.length
    },
    attendee: { notificationLevel: threadLevels.get(root.id) ?? 0 },
    first: strip(root),
    last: replies.at(-1) ? strip(replies.at(-1)) : null
  }
}

function strip(m) {
  const { parent: _p, ...rest } = m
  return rest
}

function systemUpdate(token, kind, target) {
  const list = messages.get(token)
  const msg = {
    ...strip(target),
    id: ++nextId,
    actorId: SELF.id,
    actorDisplayName: SELF.displayname,
    message: kind,
    messageParameters: {},
    messageType: 'system',
    systemMessage: kind,
    timestamp: now(),
    parent: strip(target)
  }
  list.push(msg)
  wake(token)
  return msg
}

function wake(token) {
  const list = waiters.get(token) ?? []
  waiters.set(token, [])
  for (const w of list) w.resolve()
}

// --- Seed data -----------------------------------------------------------------

function seed() {
  const day = 86400
  const t0 = now() - day - 3600 * 5
  room('town-square', 3, 'town-square', 'Town Square', {
    description: 'Company-wide announcements and work-based matters'
  })
  room('off-topic', 2, 'off-topic', 'Off-Topic', {
    description: 'Non-work banter and water cooler conversation'
  })
  room('engineering', 2, 'engineering', 'Engineering', { tagIds: ['7001'] })
  room('release', 2, 'release', 'Release planning', { isFavorite: true, tagIds: ['7001'] })
  room('dm-bob', 1, 'bob', 'Bob Berg', { status: 'online' })
  room('dm-carol', 1, 'carol', 'Carol Chen', {
    status: 'away',
    statusIcon: '🏝',
    statusMessage: 'Vacationing'
  })
  room('dm-dave', 1, 'dave', 'Dave Dahl', { status: 'dnd' })
  room('note', 6, 'alice', 'Note to self')
  room('design', 3, 'design', 'Design reviews', { isFavorite: true })

  let t = t0
  const at = (mins) => (t += mins * 60)
  addMessage('town-square', 'bob', 'Good morning everyone! ☀️', { timestamp: at(0) })
  addMessage('town-square', 'carol', 'Morning! Reminder: **all-hands** is at 14:00 today.', {
    timestamp: at(2)
  })
  addMessage('town-square', 'carol', 'Agenda:\n1. Q4 roadmap\n2. New office\n3. Q&A', { timestamp: at(1) })
  const launch = addMessage(
    'town-square',
    'dave',
    'We just shipped the new *self-service portal* to production 🚀 Details in the release notes: https://example.com/release-notes',
    { timestamp: at(30), reactions: { '🎉': 4, '🚀': 2, '👍': 3 }, reactionsSelf: ['🎉'] }
  )
  addMessage('town-square', 'erin', 'Amazing work team!', { timestamp: at(3), replyTo: launch.id })
  t = now() - 3600 * 3
  const thread = addMessage(
    'town-square',
    'bob',
    'Should we move the weekly sync to Thursdays? Tuesdays clash with the ops review.',
    {
      timestamp: at(0),
      threadTitle: 'Weekly sync schedule'
    }
  )
  addMessage('town-square', 'carol', 'Thursday works for me 👍', { timestamp: at(4), threadId: thread.id })
  addMessage('town-square', 'dave', 'Same, as long as it is after 10:00.', {
    timestamp: at(2),
    threadId: thread.id
  })
  addMessage('town-square', 'alice', 'Let us try Thursdays 10:30 from next week.', {
    timestamp: at(5),
    threadId: thread.id
  })
  addMessage(
    'town-square',
    'erin',
    'Quick tip for everyone using the CLI:\n```bash\nnc-cli login --server https://cloud.example.com\nnc-cli talk send --room town-square "hello"\n```\nWorks with `app passwords` too.',
    { timestamp: at(20) }
  )
  addMessage('town-square', 'bob', '@alice can you share the slides from yesterday?', { timestamp: at(15) })
  rooms.get('town-square').lastReadMessage = nextId - 2
  rooms.get('town-square').unreadMessages = 2
  rooms.get('town-square').unreadMention = true

  t = t0
  addMessage('off-topic', 'erin', 'Anyone up for lunch at the new ramen place? 🍜', { timestamp: at(60) })
  addMessage('off-topic', 'bob', 'Count me in!', { timestamp: at(5) })
  rooms.get('off-topic').unreadMessages = 0

  t = now() - 3600 * 2
  const ci = (ciMessage = addMessage('engineering', 'dave', 'CI is green again after the flaky test fix ✅', {
    timestamp: at(0)
  }))
  addMessage('engineering', 'alice', 'Nice! Was it the upload test again?', {
    timestamp: at(2),
    replyTo: ci.id
  })
  const yes = addMessage('engineering', 'dave', 'Yes, a race with the temp folder.', {
    timestamp: at(3),
    replyTo: ci.id
  })
  addMessage('engineering', 'bob', 'I can add a retry around it too.', { timestamp: at(1), replyTo: yes.id })
  addMessage(
    'engineering',
    'carol',
    '| Service | Status |\n|---|---|\n| API | ✅ |\n| Web | ✅ |\n| Workers | ⚠️ degraded |',
    {
      timestamp: at(10)
    }
  )
  addMessage('engineering', 'bob', '@all please review the incident write-up before Friday.', {
    timestamp: at(30)
  })

  t = now() - 3600 * 6
  addMessage(
    'release',
    'carol',
    'Release 2.4 checklist:\n- [x] Changelog\n- [x] Translations\n- [ ] Final QA',
    { timestamp: at(0) }
  )
  rooms.get('release').unreadMessages = 0

  t = now() - 3600
  addMessage('dm-bob', 'bob', 'Hey! Do you have a minute to look at my PR?', { timestamp: at(0) })
  addMessage('dm-bob', 'bob', 'It is the one fixing the upload retries.', { timestamp: at(1) })
  addMessage('dm-carol', 'carol', 'Thanks for covering for me this week 🙏', { timestamp: at(-200) })
  rooms.get('dm-carol').unreadMessages = 0
  addMessage('note', 'alice', 'Ideas: dark theme for the portal, better onboarding emails', {
    timestamp: at(-300)
  })
  addMessage('design', 'erin', 'New mockups for the settings page are up for review.', {
    timestamp: at(-400)
  })
  const mockups = addMessage('design', 'erin', 'Feedback round for the mobile layouts, please reply here.', {
    timestamp: at(30),
    threadTitle: 'Mobile layouts'
  })
  addMessage('design', 'bob', 'The tab bar feels crowded on small screens.', {
    timestamp: at(5),
    threadId: mockups.id
  })
  rooms.get('design').unreadMessages = 0

  // Conversations the Calendar created for meetings (objectType "event", objectId "start#end")
  const event = (token, title, start, mins, extra = {}) =>
    room(token, 2, token, title, {
      objectType: 'event',
      objectId: `${start}#${start + mins * 60}`,
      lastActivity: Math.min(start, now()),
      ...extra
    })
  const hour = 3600
  const today = new Date()
  const at10 = Math.floor(
    new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10).getTime() / 1000
  )
  event('ev-standup', 'Daily standup', now() - 10 * 60, 30, { hasCall: true })
  event('ev-review', 'Sprint review', at10 + 24 * hour, 60)
  event('ev-retro', 'Retrospective', at10 - 24 * hour, 45)
  event('ev-kickoff', 'Project kickoff', at10 - 20 * 24 * hour, 60)
  room('ev-quick', 2, 'ev-quick', 'Quick sync', { objectType: 'instant_meeting', objectId: '' })
  addMessage('ev-standup', 'carol', 'Joining in a minute', { timestamp: now() - 300 })
  addMessage('ev-review', 'dave', 'Agenda: demo of the portal, then Q&A', { timestamp: now() - 2 * hour })
  addMessage('ev-kickoff', 'bob', 'Slides are in the project folder', { timestamp: at10 - 20 * 24 * hour })
  for (const t of ['ev-review', 'ev-retro', 'ev-kickoff', 'ev-quick']) rooms.get(t).unreadMessages = 0
  for (const r of rooms.values()) if (!r.unreadMessages) r.lastReadMessage = r.lastMessage?.id ?? 0
}
seed()
if (LATE_REPLY) {
  setTimeout(
    () => addMessage('engineering', 'carol', 'A retry sounds good, ship it 🚢', { replyTo: ciMessage.id }),
    LATE_REPLY * 1000
  )
}

// --- HTTP plumbing -------------------------------------------------------------------

function ocs(res, data, status = 200, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(
    JSON.stringify({
      ocs: { meta: { status: status < 300 ? 'ok' : 'failure', statuscode: status, message: '' }, data }
    })
  )
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const buf = Buffer.concat(chunks)
  const type = req.headers['content-type'] || ''
  if (type.includes('application/json')) return buf.length ? JSON.parse(buf.toString()) : {}
  if (type.includes('x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(buf.toString()))
  return buf
}

function avatarSvg(name, color) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${color}"/><text x="32" y="41" font-family="Arial" font-size="24" font-weight="bold" fill="#fff" text-anchor="middle">${initials}</text></svg>`
}

function roomForSelf(r) {
  return { ...r, lastMessage: r.lastMessage ?? [] }
}

const SPREED = '/ocs/v2.php/apps/spreed/api'

const handler = async (req, res) => {
  const url = new URL(req.url, BASE)
  const p = url.pathname
  const q = url.searchParams
  const m = req.method
  try {
    // Login flow v2
    if (m === 'POST' && p === '/index.php/login/v2') {
      const token = randomBytes(16).toString('hex')
      pendingFlows.set(token, process.env.MOCK_AUTO_GRANT === '1')
      return json(res, {
        poll: { token, endpoint: `${BASE}/login/v2/poll` },
        login: `${BASE}/login/v2/flow/${token}`
      })
    }
    if (m === 'GET' && p.startsWith('/login/v2/flow/')) {
      const token = p.split('/').pop()
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(
        `<html><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>${NAME}</h2><p>Hubbub wants to access your account.</p><form method="post" action="/login/v2/grant/${token}"><button style="font-size:18px;padding:10px 24px">Grant access</button></form></body></html>`
      )
    }
    if (m === 'POST' && p.startsWith('/login/v2/grant/')) {
      pendingFlows.set(p.split('/').pop(), true)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(
        '<html><body style="font-family:sans-serif;text-align:center;padding-top:80px"><h2>Account connected</h2><p>You can close this window.</p></body></html>'
      )
    }
    if (m === 'POST' && p === '/login/v2/poll') {
      const body = await readBody(req)
      if (!pendingFlows.get(body.token)) return void res.writeHead(404).end()
      pendingFlows.delete(body.token)
      return json(res, { server: BASE, loginName: 'alice', appPassword: 'mock-app-password' })
    }

    if (!req.headers.authorization?.startsWith('Basic ') || REJECT_AUTH) return ocs(res, null, 401)

    // Core
    if (p === '/ocs/v2.php/cloud/user') return ocs(res, SELF)
    if (p === '/ocs/v2.php/core/apppassword' && m === 'DELETE') return ocs(res, [])
    if (p === '/ocs/v2.php/cloud/capabilities') {
      return ocs(res, {
        capabilities: {
          theming: { name: NAME, color: process.env.MOCK_COLOR || '#0082c9' },
          spreed: {
            version: '22.0.0-mock',
            features: [
              'chat-v2',
              'chat-read-marker',
              'chat-unread',
              'chat-replies',
              'chat-reference-id',
              'reactions',
              'delete-messages',
              'edit-messages',
              'chat-get-context',
              'rich-object-sharing',
              'threads',
              'conversation-tags',
              'favorites',
              'archived-conversations-v2',
              'media-caption'
            ],
            config: { attachments: { allowed: true, folder: '/Talk' }, chat: { 'max-length': 32000 } }
          }
        }
      })
    }
    if (p.startsWith('/index.php/avatar/')) {
      const [, , , id] = p.split('/')
      const u = users[decodeURIComponent(id)] ?? { name: id, color: '#888' }
      res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
      return res.end(avatarSvg(u.name, u.color))
    }
    if (p === '/index.php/core/preview') {
      const f = files.get(q.get('fileId'))
      if (!f) return void res.writeHead(404).end()
      res.writeHead(200, { 'Content-Type': f.mime })
      return res.end(f.data)
    }
    if (p.startsWith('/ocs/v2.php/apps/user_status/api/v1/user_status')) {
      if (m === 'PUT') users.alice.status = (await readBody(req)).statusType
      return ocs(res, { userId: 'alice', status: users.alice.status })
    }
    if (p === '/ocs/v2.php/core/autocomplete/get') {
      // Like Nextcloud, also matches the e-mail address (so a shared domain matches everyone)
      const s = (q.get('search') || '').toLowerCase()
      const limit = Number(q.get('limit') || 10)
      return ocs(
        res,
        Object.entries(users)
          .filter(
            ([id, u]) => !s || id.includes(s) || u.name.toLowerCase().includes(s) || email(id).includes(s)
          )
          .slice(0, limit)
          .map(([id, u]) => ({
            id,
            label: u.name,
            source: 'users',
            subline: email(id),
            status: { status: u.status }
          }))
      )
    }
    if (p === '/ocs/v2.php/search/providers/talk-message/search') {
      const term = (q.get('term') || '').toLowerCase()
      const entries = []
      for (const [token, list] of messages) {
        for (const msg of list) {
          if (!msg.systemMessage && msg.message.toLowerCase().includes(term)) {
            entries.push({
              title: msg.actorDisplayName,
              subline: msg.message,
              resourceUrl: `${BASE}/index.php/call/${token}#message_${msg.id}`,
              attributes: { conversation: token, messageId: String(msg.id) }
            })
          }
        }
      }
      return ocs(res, { name: 'Messages', isPaginated: false, entries: entries.reverse().slice(0, 30) })
    }

    // WebDAV upload + sharing
    if (m === 'PUT' && p.startsWith('/remote.php/dav/files/')) {
      const data = await readBody(req)
      const path = decodeURIComponent(p.replace(/^\/remote\.php\/dav\/files\/[^/]+/, ''))
      if ([...files.values()].some((f) => f.path === path) && req.headers['if-none-match'] === '*') {
        return void res.writeHead(412).end()
      }
      files.set(String(++nextId), {
        path,
        name: path.split('/').pop(),
        mime: req.headers['content-type'],
        data
      })
      return void res.writeHead(201).end()
    }
    if (m === 'MKCOL') return void res.writeHead(201).end()
    if (m === 'POST' && p === '/ocs/v2.php/apps/files_sharing/api/v1/shares') {
      const body = await readBody(req)
      const [fileId, f] = [...files.entries()].find(([, f]) => f.path === body.path) ?? []
      if (!f) return ocs(res, null, 404)
      const meta = body.talkMetaData ? JSON.parse(body.talkMetaData) : {}
      addMessage(body.shareWith, 'alice', meta.caption || '{file}', {
        referenceId: body.referenceId,
        threadId: meta.threadId,
        params: {
          file: {
            type: 'file',
            id: fileId,
            name: f.name,
            path: f.path,
            mimetype: f.mime,
            size: f.data.length,
            link: `${BASE}/index.php/f/${fileId}`,
            'preview-available': f.mime?.startsWith('image/') ? 'yes' : 'no'
          }
        }
      })
      return ocs(res, { id: fileId })
    }

    // Talk
    if (p === `${SPREED}/v4/room` && m === 'GET') return ocs(res, [...rooms.values()].map(roomForSelf))
    if (p === `${SPREED}/v4/room` && m === 'POST') {
      const body = await readBody(req)
      const token = randomBytes(4).toString('hex')
      if (body.roomType === 1)
        room(token, 1, body.invite, users[body.invite]?.name ?? body.invite, {
          status: users[body.invite]?.status
        })
      else room(token, body.roomType, body.roomName, body.roomName, { participantType: 1 })
      return ocs(res, roomForSelf(rooms.get(token)), 201)
    }
    if (p === `${SPREED}/v4/listed-room`) {
      return ocs(res, [
        {
          ...roomForSelf({
            token: 'open-1',
            type: 3,
            name: 'open-1',
            displayName: 'Book club',
            description: 'Monthly book discussions'
          })
        }
      ])
    }
    if (p === `${SPREED}/v4/tags` && m === 'GET') return ocs(res, tags)
    if (p === `${SPREED}/v4/tags` && m === 'POST') {
      const tag = {
        id: String(++nextId),
        name: (await readBody(req)).name,
        sortOrder: tags.length,
        collapsed: false,
        type: 'custom'
      }
      tags.push(tag)
      return ocs(res, tag, 201)
    }
    let mt
    if ((mt = p.match(new RegExp(`^${SPREED}/v4/tags/(\\w+)(/collapsed)?$`)))) {
      const i = tags.findIndex((t) => t.id === mt[1])
      if (m === 'DELETE') tags.splice(i, 1)
      else if (mt[2]) tags[i].collapsed = (await readBody(req)).collapsed
      else tags[i].name = (await readBody(req)).name
      return ocs(res, tags[i] ?? [])
    }
    if ((mt = p.match(new RegExp(`^${SPREED}/v4/room/([\\w-]+)(/.*)?$`)))) {
      const r = rooms.get(mt[1])
      if (!r) return ocs(res, null, 404)
      const sub = mt[2] || ''
      if (sub === '') return ocs(res, roomForSelf(r))
      if (sub === '/favorite') r.isFavorite = m === 'POST'
      if (sub === '/notify') r.notificationLevel = (await readBody(req)).level
      if (sub === '/tags') r.tagIds = (await readBody(req)).tagIds
      if (sub === '/participants/self' && m === 'DELETE') rooms.delete(r.token)
      if (sub === '/participants') {
        return ocs(
          res,
          Object.entries(users).map(([id, u], i) => ({
            attendeeId: i + 1,
            actorType: 'users',
            actorId: id,
            displayName: u.name,
            participantType: id === 'carol' ? 1 : 3,
            inCall: 0,
            status: u.status
          }))
        )
      }
      return ocs(res, roomForSelf(r))
    }
    if (p === `${SPREED}/v1/chat/subscribed-threads`) {
      const out = []
      for (const list of messages.values()) {
        for (const root of list.filter((x) => x.isThread && x.threadId === x.id)) {
          const replies = list.filter((x) => x.threadId === root.id && x.id !== root.id)
          const involved = [root, ...replies].some((x) => x.actorId === SELF.id)
          const level = threadLevels.get(root.id) ?? (involved ? 0 : undefined)
          if (level === undefined || level === 3) continue
          out.push(threadInfo(root))
        }
      }
      return ocs(
        res,
        out.sort((a, b) => b.thread.lastActivity - a.thread.lastActivity)
      )
    }
    if ((mt = p.match(new RegExp(`^${SPREED}/v1/chat/([\\w-]+)/threads/(\\d+)/notify$`))) && m === 'POST') {
      const root = messages.get(mt[1])?.find((x) => x.id === Number(mt[2]) && x.isThread)
      if (!root) return ocs(res, { error: 'message' }, 404)
      const level = Number((await readBody(req)).level)
      threadLevels.set(root.id, level)
      return ocs(res, { ...threadInfo(root), attendee: { notificationLevel: level } })
    }
    if ((mt = p.match(new RegExp(`^${SPREED}/v1/reaction/([\\w-]+)/(\\d+)$`)))) {
      const msg = messages.get(mt[1])?.find((x) => x.id === Number(mt[2]))
      if (!msg) return ocs(res, null, 404)
      const emoji = m === 'POST' ? (await readBody(req)).reaction : q.get('reaction')
      msg.reactions = Array.isArray(msg.reactions) ? {} : msg.reactions
      msg.reactions[emoji] = (msg.reactions[emoji] ?? 0) + (m === 'POST' ? 1 : -1)
      if (msg.reactions[emoji] <= 0) delete msg.reactions[emoji]
      msg.reactionsSelf =
        m === 'POST' ? [...msg.reactionsSelf, emoji] : msg.reactionsSelf.filter((e) => e !== emoji)
      systemUpdate(mt[1], 'reaction', msg)
      return ocs(res, msg.reactions, m === 'POST' ? 201 : 200)
    }
    if ((mt = p.match(new RegExp(`^${SPREED}/v1/chat/([\\w-]+)(/.*)?$`)))) {
      const token = mt[1]
      const sub = mt[2] || ''
      const list = messages.get(token)
      const r = rooms.get(token)
      if (!list || !r) return ocs(res, null, 404)

      if (sub === '' && m === 'GET') return getMessages(req, res, token, q)
      if (sub === '' && m === 'POST') {
        const body = await readBody(req)
        const msg = addMessage(token, 'alice', body.message, {
          replyTo: body.replyTo,
          threadId: body.threadId,
          threadTitle: body.threadTitle,
          referenceId: body.referenceId
        })
        if (CHATTY && r.type === 1) {
          setTimeout(() => addMessage(token, r.name, `You said: “${body.message.slice(0, 80)}” 🙂`), 2500)
        }
        return ocs(res, msg, 201)
      }
      if (sub === '/read') {
        const list = (messages.get(token) ?? []).filter((x) => !x.systemMessage)
        if (m === 'POST') {
          r.lastReadMessage = (await readBody(req)).lastReadMessage ?? r.lastMessage?.id ?? 0
        } else {
          // Like Talk: the read marker moves to the message before the last one
          r.lastReadMessage = list.at(-2)?.id ?? 0
        }
        // The marker can also move backwards ("mark as unread" from a message)
        const unread = list.filter((x) => x.id > r.lastReadMessage && x.actorId !== SELF.id)
        r.unreadMessages = unread.length
        r.unreadMention = unread.some(
          (x) => /@(alice|all)\b/.test(x.message) || x.message.includes('{mention')
        )
        return ocs(res, roomForSelf(r))
      }
      if (sub === '/mentions') {
        const s = (q.get('search') || '').toLowerCase()
        const out = Object.entries(users)
          .filter(([id, u]) => id.includes(s) || u.name.toLowerCase().includes(s))
          .map(([id, u]) => ({ id, label: u.name, source: 'users', mentionId: id, status: u.status }))
        if ('all'.startsWith(s) || 'everyone'.startsWith(s)) {
          out.unshift({
            id: token,
            label: r.displayName,
            source: 'calls',
            mentionId: 'all',
            details: 'Notify everyone'
          })
        }
        return ocs(res, out)
      }
      const idMatch = sub.match(/^\/(\d+)(\/context)?$/)
      if (idMatch) {
        const idx = list.findIndex((x) => x.id === Number(idMatch[1]))
        if (idx < 0) return ocs(res, null, 404)
        if (idMatch[2]) {
          const limit = Number(q.get('limit') || 50)
          return ocs(res, list.slice(Math.max(0, idx - limit), idx + limit + 1))
        }
        const target = list[idx]
        if (m === 'PUT') {
          const { message, params } = mentionParams((await readBody(req)).message)
          Object.assign(target, {
            message,
            messageParameters: params,
            lastEditTimestamp: now(),
            lastEditActorDisplayName: SELF.displayname
          })
          return ocs(res, systemUpdate(token, 'message_edited', target))
        }
        if (m === 'DELETE') {
          Object.assign(target, {
            message: 'Message deleted by you',
            messageType: 'comment_deleted',
            messageParameters: {}
          })
          return ocs(res, systemUpdate(token, 'message_deleted', target))
        }
      }
    }
    ocs(res, null, 404)
  } catch (err) {
    console.error(err)
    ocs(res, null, 500)
  }
}

function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function getMessages(req, res, token, q) {
  const future = q.get('lookIntoFuture') === '1'
  const lastKnown = Number(q.get('lastKnownMessageId') || 0)
  const limit = Math.min(Number(q.get('limit') || 100), 200)
  const threadId = Number(q.get('threadId') || 0)
  const pick = () => {
    let list = messages.get(token) ?? []
    if (threadId) list = list.filter((x) => x.threadId === threadId)
    if (future) return list.filter((x) => x.id > lastKnown).slice(0, limit)
    const older = lastKnown ? list.filter((x) => x.id < lastKnown) : list
    return older.slice(-limit).reverse()
  }
  let result = pick()
  if (future && !result.length) {
    const timeout = Math.min(Number(q.get('timeout') || 30), 60) * 1000
    await new Promise((resolve) => {
      const w = { resolve }
      waiters.set(token, [...(waiters.get(token) ?? []), w])
      const t = setTimeout(resolve, timeout)
      req.on('close', () => {
        clearTimeout(t)
        resolve()
      })
    })
    result = pick()
  }
  if (!result.length) return void res.writeHead(304).end()
  const lastGiven = future ? result.at(-1).id : result.at(-1).id
  ocs(res, result, 200, { 'X-Chat-Last-Given': String(lastGiven) })
}

const server = TLS ? createTlsServer(TLS, handler) : createServer(handler)
server.listen(PORT, () => {
  console.log(`Mock Nextcloud Talk server "${NAME}" on ${BASE}`)
  console.log('Sign in with login "alice" and any app password, or use the browser flow.')
})
