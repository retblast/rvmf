// Notification rows for the notifications column/tab. Split out of
// Post.jsx; depends on ThreadReply for the status preview.
import { memo, useState } from 'react'
import { MessageCircle, Repeat2, Star, AtSign, Bell, UserPlus } from 'lucide-react'
import { useMaskIdentity } from '../hooks'
import { formatRelativeTime, renderEmojiText } from '../lib/render.jsx'
import { Avatar, ProxiedImg } from './Media.jsx'
import { GifVideo } from './GifVideo.jsx'
import { ThreadReply } from './ThreadReply.jsx'
function notificationVerb(type, notification) {
  switch (type) {
    case 'follow':
      return 'followed you'
    case 'follow_request':
      return 'requested to follow you'
    case 'reblog':
      return 'boosted your post'
    case 'favourite':
      return 'favourited your post'
    case 'mention':
      return 'mentioned you'
    case 'poll':
      return "a poll you're in has ended"
    case 'status':
      return 'posted'
    case 'update':
      return 'edited a post'
    case 'quote':
      return 'quoted your post'
    case 'pleroma:emoji_reaction': {
      const emojiUrl = notification?.emoji_url
      const emojiName = notification?.emoji || notification?.reaction?.content || '🧩'
      const emoji = emojiUrl
        ? <GifVideo direct src={emojiUrl} alt={emojiName} className="inline-custom-emoji" fallbackText={String(emojiName).replaceAll(':', '')} />
        : String(emojiName).startsWith(':')
          ? <ProxiedImg direct alt={emojiName} className="inline-custom-emoji" fallbackText={String(emojiName).replaceAll(':', '')} />
          : emojiName
      return <>reacted with {emoji} to your post</>
    }
    default:
      return type.replace(/_/g, ' ')
  }
}

function notificationIcon(type) {
  switch (type) {
    case 'follow':
    case 'follow_request':
      return UserPlus
    case 'reblog':
      return Repeat2
    case 'favourite':
      return Star
    case 'mention':
      return AtSign
    case 'quote':
      return MessageCircle
    default:
      return Bell
  }
}

export const NotificationRow = memo(function NotificationRow({
  notification,
  instanceUrl,
  token,
  onUpdateStatus,
  onOpenThread,
  onComposeReply,
  onOpenLightbox,
  onOpenProfile,
  onRespondFollowRequest,
  pendingFollowIds,
  statusById,
  onQuote,
  currentAccountId,
  onDelete,
  onEdit,
  onMute,
  onBlock,
}) {
  const mask = useMaskIdentity()
  const account = mask(notification.account || {})
  const rawName = account.display_name || account.username || 'Unknown'
  const name = renderEmojiText(rawName, account.emojis)
  const Icon = notificationIcon(notification.type)
  const [responding, setResponding] = useState(false)
  const [responded, setResponded] = useState(null)

  async function respond(action) {
    if (responding) return
    setResponding(true)
    try {
      await onRespondFollowRequest(account.id, action)
      setResponded(action)
    } catch (err) {
      console.error(err)
    } finally {
      setResponding(false)
    }
  }

  return (
    <div className="notif-row" data-type={notification.type}>
      <div className="notif-icon">
        <Icon size={14} />
      </div>
      <div className="notif-body">
        <div className="notif-header">
          <Avatar name={rawName} src={account.avatar} staticSrc={account.avatar_static} size={22} onClick={() => onOpenProfile?.(account)} />
          <span className="notif-text">
            <span className="post-name clickable" onClick={(e) => { e.stopPropagation(); onOpenProfile?.(account) }}>{name}</span> {notificationVerb(notification.type, notification)}
          </span>
          <span className="post-time">{formatRelativeTime(notification.created_at)}</span>
        </div>

        {notification.type === 'follow_request' && !responded && pendingFollowIds != null && !pendingFollowIds.has(account.id) && (
          // Request was already handled elsewhere (or earlier session) —
          // the server keeps the notification around, but there is
          // nothing left to accept or reject.
          <div className="notif-responded">
            {account.display_name || account.username} followed you
          </div>
        )}
        {notification.type === 'follow_request' && !responded && (pendingFollowIds == null || pendingFollowIds.has(account.id)) && (
          <div className="notif-actions">
            <button
              className="pill-btn suggested"
              disabled={responding}
              onClick={() => respond('authorize')}
              type="button"
            >
              Accept
            </button>
            <button
              className="pill-btn"
              disabled={responding}
              onClick={() => respond('reject')}
              type="button"
            >
              Reject
            </button>
          </div>
        )}
        {responded && (
          <div className="notif-responded">
            {responded === 'authorize' ? 'Accepted.' : 'Rejected.'}
          </div>
        )}

        {notification.status && (
          <div className="notif-status-preview">
            <ThreadReply
              node={{ status: notification.status, children: [] }}
              instanceUrl={instanceUrl}
              token={token}
              onUpdate={onUpdateStatus}
              onOpenThread={onOpenThread}
              onComposeReply={onComposeReply}
              onOpenLightbox={onOpenLightbox}
              onOpenProfile={onOpenProfile}
              statusById={statusById}
              onQuote={onQuote}
              compact
              currentAccountId={currentAccountId}
              onDelete={onDelete}
              onMute={onMute}
              onBlock={onBlock}
              onEdit={onEdit}
            />
          </div>
        )}
      </div>
    </div>
  )
})
