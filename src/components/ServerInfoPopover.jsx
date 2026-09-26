import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import * as mitra from '../lib/mitra'

// Server-side notification policy rules (GET /v2/notifications/policy).
// Values are 'accept' | 'drop' and can't be changed from the API — the
// instance decides them.
const NOTIF_POLICY_RULES = [
  ['for_not_following', "From people you don't follow"],
  ['for_not_followers', 'From people not following you'],
  ['for_new_accounts', 'From brand-new accounts'],
  ['for_private_mentions', 'From direct mentions'],
]

// Collapsible blocked-domain list (the one server list that grows
// without limit). Grid-rows 0fr->1fr animates the height without JS
// measurement; inner box scrolls past ~180px.
function DomainsAccordion({ domains }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="accordion-header" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <ChevronRight size={13} className={`accordion-chevron${open ? ' open' : ''}`} />
        <span className="settings-menu-heading">Blocked Domains</span>
        <span className="notif-policy-badge">{domains.length}</span>
      </button>
      <div className={`accordion-body${open ? ' open' : ''}`}>
        <div className="accordion-inner scrollbar-thin">
          {domains.map((block) => (
            <div key={block.digest} className="settings-menu-row settings-menu-subrow">
              <span>{block.domain}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// Server details popover behind the headerbar brand button: notification
// filtering policy + blocked domains, fetched lazily on first open and
// kept for the session.
export function ServerInfoPopover({ open, onClose, instanceUrl, token }) {
  const [notifPolicy, setNotifPolicy] = useState(null)
  const [domainBlocks, setDomainBlocks] = useState(null)

  useEffect(() => {
    if (!open) return
    if (!notifPolicy) {
      mitra.fetchNotificationPolicy(instanceUrl, token)
        .then(setNotifPolicy)
        .catch(() => {})
    }
    if (!domainBlocks) {
      mitra.fetchDomainBlocks(instanceUrl, token)
        .then(setDomainBlocks)
        .catch(() => {})
    }
  }, [open, notifPolicy, domainBlocks, instanceUrl, token])

  if (!open) return null

  return (
    <>
      <div className="settings-menu-backdrop" onClick={onClose} />
      <div className="server-popover">
        <span className="settings-menu-heading">{instanceUrl.replace(/^https?:\/\//, '')}</span>
        {notifPolicy ? (
          <div className="settings-menu-section">
            <span className="settings-menu-heading">Notification Filters</span>
            {/* Mitra's policy values are 'accept' | 'drop' — which
                notifications the instance filters before you ever
                see them. Server-decided, so display-only. */}
            {NOTIF_POLICY_RULES.map(([key, label]) => {
              const value = notifPolicy[key]
              if (!value) return null
              return (
                <div key={key} className="settings-menu-row settings-menu-subrow">
                  <span>{label}</span>
                  <span className={`notif-policy-badge${value === 'drop' ? ' drop' : ''}`}>
                    {value}
                  </span>
                </div>
              )
            })}
          </div>
        ) : (
          <span className="poll-meta">Loading filters…</span>
        )}
        {domainBlocks && (
          <div className="settings-menu-section">
            {domainBlocks.length === 0 ? (
              <>
                <span className="settings-menu-heading">Blocked Domains</span>
                <span className="poll-meta">None.</span>
              </>
            ) : (
              <DomainsAccordion domains={domainBlocks} />
            )}
          </div>
        )}
      </div>
    </>
  )
}
