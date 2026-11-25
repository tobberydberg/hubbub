import { useEffect, useState } from 'react'
import { CalendarOff, ChevronDown, ChevronUp } from 'lucide-react'
import type { CurrentAbsence } from '@renderer/api/talk'
import { openDirectMessage } from '@renderer/sync/actions'
import { absenceOf, absenceUntil } from '@renderer/sync/absence'
import { openProfileCard } from '../common/ProfileCard'

// Above the message box of a direct message with someone who is out of office, as in Talk on the
// web: until when, their message, and who to contact instead.

export function AbsenceBanner({
  accountId,
  userId,
  name
}: {
  accountId: string
  userId: string
  name: string
}) {
  const [absence, setAbsence] = useState<CurrentAbsence | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let current = true
    setAbsence(null)
    void absenceOf(accountId, userId).then((a) => current && setAbsence(a))
    return () => {
      current = false
    }
  }, [accountId, userId])

  if (!absence) return null
  return (
    <div className="absence-banner">
      <CalendarOff size={18} />
      <div className="absence-body">
        <div className="absence-title">
          <b>{name}</b> is out of office {absenceUntil(absence.endDate)}
          {absence.shortMessage ? ` · ${absence.shortMessage}` : ''}
        </div>
        {open && absence.message && <p className="absence-message">{absence.message}</p>}
        {absence.replacementUserId && (
          <div className="absence-replacement">
            Contact instead:{' '}
            <button
              className="link-btn"
              onClick={(e) =>
                openProfileCard(
                  accountId,
                  absence.replacementUserId!,
                  absence.replacementUserDisplayName ?? absence.replacementUserId!,
                  e.currentTarget
                )
              }
            >
              {absence.replacementUserDisplayName ?? absence.replacementUserId}
            </button>
            {' · '}
            <button
              className="link-btn"
              onClick={() => void openDirectMessage(accountId, absence.replacementUserId!)}
            >
              Message them
            </button>
          </div>
        )}
      </div>
      {absence.message && (
        <button
          className="icon-btn small"
          title={open ? 'Hide the message' : 'Show the message'}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
      )}
    </div>
  )
}
