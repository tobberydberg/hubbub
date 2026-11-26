import type { ReactNode } from 'react'
import { AtSign } from 'lucide-react'
import type { CalendarEvent } from '@renderer/lib/caldav'
import { useApp } from '@renderer/store/app'
import { calendarAddresses, mailOnlyAddresses, myAddresses } from '@renderer/sync/calendar'
import { AddAddress } from './AddAddress'

// An address of yours that your Nextcloud account doesn't have. A Nextcloud Mail alias is yours in
// Hubbub, but Nextcloud only emails answers and meeting changes from your account's addresses. An
// organizer that looks like you (same name before the @, or your name) may be one too. Adding it to
// the account fixes both.

const local = (email: string): string => email.split('@')[0].toLowerCase()

export function AliasHint({ accountId, event }: { accountId: string; event: CalendarEvent }) {
  const name = useApp((s) => s.accounts[accountId]?.user?.displayname ?? '')
  const organizer = event.organizer
  const mailOnly = mailOnlyAddresses(accountId)
  const isMailOnly = (email?: string): boolean => !!email && mailOnly.includes(email.toLowerCase())

  // Organizing from a Mail alias: your changes aren't sent to the invitees
  if (organizer?.isMe && isMailOnly(organizer.email) && event.attendees.some((a) => !a.isMe)) {
    return (
      <Hint accountId={accountId} email={organizer.email!}>
        You organize this from <b>{organizer.email}</b>, your alias in Nextcloud Mail. Nextcloud only emails
        meeting changes from your account’s addresses, so the invitees don’t get your changes until you add
        it.
      </Hint>
    )
  }

  // Invited at a Mail alias, with no other address of yours to answer from
  if (organizer && !organizer.isMe) {
    const known = calendarAddresses(accountId)
    const mine = event.attendees.filter((a) => a.isMe)
    const alias = mine.find((a) => isMailOnly(a.email))
    if (alias && !mine.some((a) => a.email && known.includes(a.email.toLowerCase()))) {
      return (
        <Hint accountId={accountId} email={alias.email!}>
          You’re invited at <b>{alias.email}</b>, your alias in Nextcloud Mail. Nextcloud only emails answers
          from your account’s addresses, so {organizer.name || organizer.email} doesn’t get your answer until
          you add it.
        </Hint>
      )
    }
  }

  if (!organizer?.email || organizer.isMe) return null
  const looksLikeMe =
    myAddresses(accountId).some((m) => local(m) === local(organizer.email!)) ||
    (!!name && organizer.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (!looksLikeMe) return null
  return (
    <Hint accountId={accountId} email={organizer.email}>
      Is <b>{organizer.email}</b> you? Your Nextcloud doesn’t know it as one of your addresses. Add it, and
      you can edit the meetings you organize from it, with your changes sent to the invitees.
    </Hint>
  )
}

function Hint({ accountId, email, children }: { accountId: string; email: string; children: ReactNode }) {
  return (
    <div className="alias-hint">
      <AtSign size={16} />
      <div>
        <p>{children}</p>
        <AddAddress accountId={accountId} email={email} label="Add to my Nextcloud account" />
      </div>
    </div>
  )
}
