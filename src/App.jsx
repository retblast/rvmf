import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Home,
  Bell,
  Compass,
  Bookmark,
  Search,
  Users,
  List,
  MessageCircle,
  Plus,
  RotateCw,
  ArrowUpToLine,
  LogOut,
  Settings,
  Trash2,
} from 'lucide-react'
import { useMitraSession } from './useMitraSession'
import { useAppSettings } from './useAppSettings'
import { useNotifications, NOTIF_FILTERS } from './useNotifications'
import { useTimeline } from './useTimeline'
import { useThreadPanel } from './useThreadPanel'
import * as mitra from './lib/mitra'
import { AppSettingsContext, PickerContext, GhostContext, useEscapeKey, useLayoutTier, usePullToRefresh, useSwipeBack, useInstanceFavicon } from './hooks'
import { ESCAPE_PRIORITY } from './lib/escapeStack.js'

import LoginView from './LoginView'
import { Avatar, MediaLightbox } from './components/Media.jsx'
import { NotificationRow, PostRow } from './components/Post.jsx'
import { ComposeDialog, EditDialog } from './components/Compose.jsx'
import { ThreadPanel, ThreadPanelContent, ThreadPanelHeader } from './components/ThreadPanel.jsx'
import { ProfileView } from './components/ProfileView.jsx'
import { SearchView } from './components/SearchView.jsx'
import { HashtagFeed } from './components/HashtagFeed.jsx'
import { MutedAccountsView } from './components/MutedAccountsView.jsx'
import InstanceIcon from './components/InstanceIcon.jsx'
import { ScrollTopButton } from './components/ScrollTopButton.jsx'
import { SettingsMenu } from './components/SettingsMenu.jsx'
import { ServerInfoPopover } from './components/ServerInfoPopover.jsx'
import { ToastStack } from './components/ToastStack.jsx'

import { ListsView } from './components/ListsView.jsx'
import { ExploreView } from './components/ExploreView.jsx'
import { BookmarksView } from './components/BookmarksView.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { GroupsView } from './components/GroupsView.jsx'
import { ConversationsView } from './components/ConversationsView.jsx'
import { AccountSettingsView } from './components/AccountSettingsView.jsx'
import { FavouritesView } from './components/FavouritesView.jsx'
import { StatusPage } from './components/StatusPage.jsx'
import { UIContext } from './ui/index.jsx'

export default function App() {
  const { session, beginLogin, signup, logout, authError, completingLogin } = useMitraSession()
  const tier = useLayoutTier()
  const [scrollEl, setScrollEl] = useState(null)
  const refreshRef = useRef(() => {})
  const [view, setView] = useState('home')
  const [composing, setComposing] = useState(false)
  const [quoteStatus, setQuoteStatus] = useState(null)
  // Group the open composer is addressing, when "Post to this group" was
  // used — cleared with the dialog.
  const [composerGroup, setComposerGroup] = useState(null)
  // Post being replied to in the main composer (context preview + target)
  const [replyContext, setReplyContext] = useState(null)
  const [editing, setEditing] = useState(null)
  const [openPickerId, setOpenPickerId] = useState(null)
  const [profileAccountId, setProfileAccountId] = useState(null)
  const [hashtagTag, setHashtagTag] = useState(null)
  const [lightboxAttachment, setLightboxAttachment] = useState(null)
  const [exploreRefreshTick, setExploreRefreshTick] = useState(0)
  const [bookmarksRefreshTick, setBookmarksRefreshTick] = useState(0)
  // Last edit saved via the global EditDialog — handed to extracted list
  // views so they can merge it into their own rows.
  const [editedStatus, setEditedStatus] = useState(null)
  const [messagesRefreshTick, setMessagesRefreshTick] = useState(0)
  const [favouritesRefreshTick, setFavouritesRefreshTick] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [serverInfoOpen, setServerInfoOpen] = useState(false)
  // Where the settings panel was opened from (null = centered)
  const [settingsAnchor, setSettingsAnchor] = useState(null)

  // Notifications domain hook — must be declared before useAppSettings,
  // whose client_config sync reads notifExcluded.
  const notifs = useNotifications(session, { view, tier })


  // Home timeline hook — owns the list, pagination, sentinel, and poll.
  const tl = useTimeline(session, { view, tier })

  // Side-panel thread engine — reply trees, ghost anchor, focused reply,
  // the 5s silent refresh, and panel-scoped compose routing.
  const threadPanel = useThreadPanel(session, {
    openComposerForReply: (status) => {
      setQuoteStatus(null)
      setReplyContext(status)
      setComposing(true)
    },
  })
  const { sidePanel, ghostStatusId, focusedReplyId } = threadPanel
  // Build an id→status map so PostRow can look up parent statuses for
  // "in reply to" links within notifications.
  const notifStatusById = useMemo(() => {
    const m = new Map()
    for (const n of notifs.notifications) {
      if (n.status) { m.set(n.status.id, n.status); if (n.status.reblog) m.set(n.status.reblog.id, n.status.reblog) }
    }
    return m
  }, [notifs.notifications])

  function openSettingsFrom(e) {
    const rect = e?.currentTarget?.getBoundingClientRect()
    setSettingsAnchor(rect ? { top: rect.top, bottom: rect.bottom, left: rect.left } : null)
    setSettingsOpen(true)
  }

  const narrowThreadRef = useRef(null)

  // All user settings (appearance/content/GIF/translation/account) live in
  // this hook, bundled with the client_config server sync. notif-excluded
  // is owned by the notifications hook above but rides the same sync.
  const appSettings = useAppSettings(session, {
    onClientNameChange: logout,
    extraSynced: { 'notif-excluded': [notifs.notifExcluded, notifs.setNotifExcluded] },
  })

  useInstanceFavicon(session, notifs.notifUnread, appSettings.privacyMode, appSettings.skin)

  const [online, setOnline] = useState(() => navigator.onLine)

  // Global keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (!(e.ctrlKey || e.metaKey)) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return
      if (e.key.toLowerCase() === 'n' && session) {
        e.preventDefault()
        setComposing(true)
      } else if (e.key === ',') {
        e.preventDefault()
        setSettingsAnchor(null) // no trigger element — centered
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [session])

  // Flaky-connection awareness: while the browser reports itself offline,
  // all polling pauses and an amber banner explains why; coming back
  // online refreshes the current view and notifications immediately.
  useEffect(() => {
    function goOffline() { setOnline(false) }
    function goOnline() {
      setOnline(true)
      if (!session) return
      refreshRef.current()
      if (notifs.notificationsVisible) notifs.loadNotifications()
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)
    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
    }
  }, [session, notifs.notificationsVisible, notifs.loadNotifications])

  // Wide tier shows notifications as a permanent column, not a tab — if
  // the window shrinks below wide while "Notifications" is the active
  // tab-view, there'd be nothing in the main content area. Fall back to
  // Home.
  useEffect(() => {
    if (tier === 'wide' && view === 'notifications') {
      setView('home')
    }
  }, [tier, view])

  async function handleDeleteStatus(statusId) {
    try {
      await mitra.deleteStatus(session.instanceUrl, session.token, statusId)
      tl.removeStatus(statusId)
      if (sidePanel?.status?.id === statusId) threadPanel.setSidePanel(null)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleMuteAccount(accountId) {
    try {
      await mitra.muteAccount(session.instanceUrl, session.token, accountId)
    } catch (err) {
      console.error(err)
    }
  }

  async function handleBlockAccount(accountId) {
    try {
      await mitra.blockAccount(session.instanceUrl, session.token, accountId)
    } catch (err) {
      console.error(err)
    }
  }

  function handleRefresh() {
    // Refreshing means "show me the newest" — jump to the top instantly
    // (not smooth: prepended items would fight an animated scroll).
    scrollEl?.scrollTo({ top: 0 })
    if (view === 'notifications') {
      notifs.loadNotifications()
    } else if (view === 'explore') {
      // ExploreView owns its data; bumping the tick makes it reload the
      // current feed.
      setExploreRefreshTick((t) => t + 1)
    } else if (view === 'bookmarks') {
      // Same pattern: BookmarksView reloads when this changes.
      setBookmarksRefreshTick((t) => t + 1)
    } else if (view === 'messages') {
      // ConversationsView owns its data; bumping the key remounts it.
      setMessagesRefreshTick((t) => t + 1)
    } else if (view === 'favourites') {
      // Same pattern as messages: FavouritesView owns its data.
      setFavouritesRefreshTick((t) => t + 1)
    } else {
      tl.loadTimeline()
    }
  }
  refreshRef.current = handleRefresh

  // Scroll-down-to-refresh on whichever timeline is showing
  const { pull, refreshing } = usePullToRefresh(scrollEl, () => refreshRef.current())
  const showPullIndicator = refreshing || pull > 10

  // Escape closes the topmost surface. Each app-level surface registers
  // into the central escape stack (lib/escapeStack.js) with an explicit
  // priority — media > confirms > menus > dialogs > inline compose >
  // panels — so close order follows intent instead of listener
  // registration order. Per-row dropdowns, the emoji picker and the
  // lightbox register their own handlers; the thread panel's inline
  // reply composer registers from ThreadPanelHeader; presses already
  // consumed (emoji autocomplete inside a textarea) never reach the
  // stack.
  useEscapeKey(() => {
    setComposing(false)
    setQuoteStatus(null)
    setReplyContext(null)
  }, composing, ESCAPE_PRIORITY.dialog)
  useEscapeKey(() => setEditing(null), editing, ESCAPE_PRIORITY.dialog)
  useEscapeKey(() => setOpenPickerId(null), openPickerId, ESCAPE_PRIORITY.menu)
  // While the translation confirm dialog is up, its own 'confirm'
  // registration outranks this one and owns Escape (cancel keeps the
  // settings menu open) — no special case needed here.
  useEscapeKey(() => setSettingsOpen(false), settingsOpen, ESCAPE_PRIORITY.menu)
  useEscapeKey(() => setServerInfoOpen(false), serverInfoOpen, ESCAPE_PRIORITY.menu)
  useEscapeKey(() => threadPanel.closeSidePanel(), sidePanel, ESCAPE_PRIORITY.panel)

  function handleEditStatus(status) {
    setEditing(status)
  }

  // After an edit saves, sweep the updated status through every surface
  // it might appear on — the helpers no-op when the id isn't found.
  // Extracted lists (explore/bookmarks) receive it as a prop and merge it
  // themselves; the rest update in place here.
  function handleEditSaved(updated) {
    setEditing(null)
    setEditedStatus(updated)
    tl.updatePost(updated)
    notifs.updateNotificationStatus(updated)
    if (sidePanel?.status) threadPanel.updateReplyInPanel(updated)
  }


  // Opens the profile view for an account.
  function handleOpenProfile(account) {
    if (!account?.id) return
    threadPanel.setSidePanel(null)
    setHashtagTag(null)
    setProfileAccountId(account.id)
    setView('home')
  }

  // Opens a hashtag's public feed. Hashtag links inside post text reach
  // here via document-level click delegation (see the effect below).
  function handleOpenHashtag(tag) {
    if (!tag) return
    threadPanel.setSidePanel(null)
    setProfileAccountId(null)
    setHashtagTag(tag)
    setView('home')
  }

  // Delegated handler for links rendered deep inside post content
  // (hashtags, @mentions), where passing callbacks down would mean
  // threading yet another prop through every row. Mentions resolve to a
  // local profile: by account id when the mention carries one, otherwise
  // by acct lookup — falling back to the external URL only if that fails.
  useEffect(() => {
    function onClick(e) {
      const mentionEl = e.target.closest?.('.mention-link')
      if (mentionEl) {
        e.preventDefault()
        e.stopPropagation()
        const accountId = mentionEl.dataset.accountId
        const acct = mentionEl.dataset.acct || (mentionEl.textContent || '').replace(/^@/, '')
        const openExternal = () => {
          const href = mentionEl.getAttribute('href')
          if (href) window.open(href, '_blank', 'noopener')
        }
        if (accountId) {
          handleOpenProfile({ id: accountId })
        } else if (acct) {
          mitra.lookupAccount(session.instanceUrl, session.token, acct)
            .then((account) => {
              if (account?.id) handleOpenProfile(account)
              else openExternal()
            })
            .catch(() => openExternal())
        } else {
          openExternal()
        }
        return
      }
      const el = e.target.closest?.('.hashtag-link')
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      handleOpenHashtag(el.dataset.hashtag)
    }
    // Capture phase is essential: these buttons' own React handlers call
    // e.stopPropagation(), and since React dispatches from the root
    // container, a bubble-phase document listener never fires — React
    // halts native propagation before it gets there.
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [session])

  function handleQuote(status) {
    setQuoteStatus(status)
    setComposing(true)
  }

  function handlePostToGroup(group) {
    setComposerGroup(group)
    setComposing(true)
  }

  // Swipe-from-left-edge to close thread on narrow tier. This call must
  // stay ABOVE the login early-return below: when the password-grant
  // signup lands a session, App re-renders in place (no page reload),
  // and React throws "rendered more hooks than during the previous
  // render" if the authenticated render suddenly owns extra hooks.
  useSwipeBack(narrowThreadRef, threadPanel.closeSidePanel, { active: tier === 'narrow' && !!sidePanel })

  if (!session) {
    return (
      <LoginView
        onBeginLogin={beginLogin}
        onCreateAccount={signup}
        error={authError}
        completingLogin={completingLogin}
      />
    )
  }

  // Mitra has no exclude_types[] query param, so chip filtering happens
  // here at render time. The unread badge and marker sync above still
  // use the full list — hiding a category doesn't mark it read.
  const visibleNotifications = notifs.visibleNotifications

  const notificationsBody = (
    <>
      <div className="notif-filters" role="group" aria-label="Notification filters">
        {NOTIF_FILTERS.map(([label, types]) => {
          const isOff = types.some((t) => notifs.notifExcluded.includes(t))
          return (
            <button
              key={label}
              type="button"
              className={`notif-filter-chip${isOff ? ' off' : ''}`}
              onClick={() => notifs.toggleNotifFilter(types)}
            >
              {label}
            </button>
          )
        })}
      </div>
      {notifs.notificationsError && (
        <>
          <div className="banner banner-error">{notifs.notificationsError}</div>
          <div className="empty-state">
            <button className="pill-btn suggested" onClick={notifs.loadNotifications}>Retry</button>
          </div>
        </>
      )}
      {notifs.notificationsLoading && notifs.notifications.length === 0 ? (
        <div className="empty-state">Loading…</div>
      ) : notifs.notifications.length === 0 ? (
        <div className="empty-state">Nothing here yet.</div>
      ) : visibleNotifications.length === 0 ? (
        <div className="empty-state">All notifications are filtered out.</div>
      ) : (
        <>
          <div className="timeline-list">
            {notifs.visibleNotifications.map((n) => (
              <NotificationRow
                key={n.id}
                notification={n}
                instanceUrl={session.instanceUrl}
                token={session.token}
                onUpdateStatus={notifs.updateNotificationStatus}
                onOpenThread={threadPanel.handleOpenThread}
                onComposeReply={threadPanel.handleComposeReply}
                onOpenLightbox={setLightboxAttachment}
                onOpenProfile={handleOpenProfile}
                onRespondFollowRequest={notifs.respondFollowRequest}
                pendingFollowIds={notifs.pendingFollowIds}
                statusById={notifStatusById}
                onQuote={handleQuote}
                currentAccountId={session.account?.id}
                onDelete={handleDeleteStatus}
                onEdit={handleEditStatus}
                onMute={handleMuteAccount}
                onBlock={handleBlockAccount}
              />
            ))}
          </div>
          {notifs.notificationsHasMore && <div ref={notifs.notifSentinelRef} className="scroll-sentinel" />}
          {notifs.notificationsLoadingMore && <div className="empty-state">Loading…</div>}
        </>
      )}
    </>
  )

  const timelineContent = hashtagTag ? (
    <HashtagFeed
      hashtag={hashtagTag}
      instanceUrl={session.instanceUrl}
      token={session.token}
      onOpenThread={threadPanel.handleOpenThread}
      onComposeReply={threadPanel.handleComposeReply}
      onOpenLightbox={setLightboxAttachment}
      onOpenProfile={(account) => { setHashtagTag(null); handleOpenProfile(account) }}
      onUpdate={tl.updatePost}
      onQuote={handleQuote}
      currentAccountId={session.account?.id}
      onDelete={handleDeleteStatus}
      onMute={handleMuteAccount}
      onBlock={handleBlockAccount}
      onEdit={handleEditStatus}
      onClose={() => setHashtagTag(null)}
    />
  ) : profileAccountId ? (
    <ProfileView
      accountId={profileAccountId}
      instanceUrl={session.instanceUrl}
      token={session.token}
      onOpenThread={threadPanel.handleOpenThread}
      onComposeReply={threadPanel.handleComposeReply}
      onOpenLightbox={setLightboxAttachment}
      onOpenProfile={handleOpenProfile}
      onUpdate={tl.updatePost}
      onQuote={handleQuote}
      currentAccountId={session.account?.id}
      onDelete={handleDeleteStatus}
      onEdit={handleEditStatus}
      onMute={handleMuteAccount}
      onBlock={handleBlockAccount}
      onClose={() => setProfileAccountId(null)}
    />
  ) : (
    <div className="timeline-wrap">
      {view === 'home' && (
        <>
          {tl.error && (
            <>
              <div className="banner banner-error">{tl.error}</div>
              <div className="empty-state">
                <button className="pill-btn suggested" onClick={tl.loadTimeline}>Retry</button>
              </div>
            </>
          )}
          <div className="section-label">Home timeline</div>
          {tl.loading && tl.timeline.length === 0 ? (
            <div className="empty-state">Loading…</div>
          ) : tl.timeline.length === 0 ? (
            <StatusPage
              icon={Home}
              heading="No posts yet"
              description="Follow someone to see their posts here."
            />
          ) : (
            <div className="timeline-list">
              {tl.timeline.map((post) => (
                <PostRow
                  key={post.id}
                  post={post}
                  instanceUrl={session.instanceUrl}
                  token={session.token}
                  onUpdate={tl.updatePost}
                  onOpenThread={threadPanel.handleOpenThread}
                  onComposeReply={threadPanel.handleComposeReply}
                  onOpenLightbox={setLightboxAttachment}
                  onOpenProfile={handleOpenProfile}
                  onQuote={handleQuote}
                  statusById={tl.statusById}
                  currentAccountId={session.account?.id}
                  onDelete={handleDeleteStatus}
                  onEdit={handleEditStatus}
                  onMute={handleMuteAccount}
                  onBlock={handleBlockAccount}
                />
              ))}
            </div>
          )}
          {tl.loadingMore && <div className="empty-state">Loading…</div>}
          {tl.hasMore && !tl.loadingMore && tl.timeline.length > 0 && (
            <div ref={tl.homeSentinelRef} className="scroll-sentinel" />
          )}
        </>
      )}

      {view === 'explore' && (
        <ExploreView
          session={session}
          refreshTick={exploreRefreshTick}
          editedStatus={editedStatus}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onEdit={handleEditStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
        />
      )}

      {view === 'muted' && (
        <MutedAccountsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenProfile={(account) => { setView('home'); handleOpenProfile(account) }}
        />
      )}

      {view === 'account' && (
        <AccountSettingsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenProfile={(account) => { setView('home'); handleOpenProfile(account) }}
          onDeleted={logout}
        />
      )}

      {view === 'lists' && (
        <ListsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
          onEdit={handleEditStatus}
        />
      )}

      {view === 'groups' && (
        <GroupsView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          onPostToGroup={handlePostToGroup}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
          onEdit={handleEditStatus}
        />
      )}

      {view === 'search' && (
        <SearchView
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onUpdatePost={tl.updatePost}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
          onEdit={handleEditStatus}
          onOpenHashtag={handleOpenHashtag}
        />
      )}

      {view === 'messages' && (
        <ConversationsView
          key={messagesRefreshTick}
          instanceUrl={session.instanceUrl}
          token={session.token}
          currentAccountId={session.account?.id}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onUpdatePost={tl.updatePost}
          onQuote={handleQuote}
          onDelete={handleDeleteStatus}
          onEdit={handleEditStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
        />
      )}

      {view === 'favourites' && (
        <FavouritesView
          key={favouritesRefreshTick}
          instanceUrl={session.instanceUrl}
          token={session.token}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onEdit={handleEditStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
        />
      )}

      {view === 'bookmarks' && (
        <BookmarksView
          session={session}
          refreshTick={bookmarksRefreshTick}
          editedStatus={editedStatus}
          onOpenThread={threadPanel.handleOpenThread}
          onComposeReply={threadPanel.handleComposeReply}
          onOpenLightbox={setLightboxAttachment}
          onOpenProfile={handleOpenProfile}
          onQuote={handleQuote}
          currentAccountId={session.account?.id}
          onDelete={handleDeleteStatus}
          onEdit={handleEditStatus}
          onMute={handleMuteAccount}
          onBlock={handleBlockAccount}
        />
      )}

      {tier !== 'wide' && view === 'notifications' && (
        <>
          <div className="section-label-row">
            <div className="section-label">Notifications</div>
            {notifs.notifications.length > 0 && (
              <button
                className="icon-btn"
                aria-label="Clear all notifications"
                title="Clear all"
                onClick={notifs.clearNotifications}
                disabled={notifs.clearingNotifications}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
          <ErrorBoundary>{notificationsBody}</ErrorBoundary>
        </>
      )}
    </div>
  )

  const threadPanelProps = {
    panel: sidePanel,
    replyStates: threadPanel.replyStates,
    onOpenThread: (status) => threadPanel.handleOpenThread(status, { fromPanel: true }),
    onComposeReply: threadPanel.handleComposeReplyInPanel,
    onOpenLightbox: setLightboxAttachment,
    onOpenProfile: handleOpenProfile,
    onUpdateReply: threadPanel.updateReplyInPanel,
    onClose: threadPanel.closeSidePanel,
    instanceUrl: session.instanceUrl,
    token: session.token,
    onReplyPosted: threadPanel.handleReplyPosted,
    onCancelCompose: threadPanel.handleCancelCompose,
    onRefreshContext: threadPanel.refreshContext,
    onQuote: handleQuote,
    currentAccountId: session.account?.id,
    onDelete: handleDeleteStatus,
    onMute: handleMuteAccount,
    onBlock: handleBlockAccount,
    onEdit: handleEditStatus,
    maxCharacters: session.maxCharacters || 500,
    focusedReplyId,
  }

  // Active skin's structural overrides (Tier 3). Adwaita has none and
  // keeps the inline GNOME header bar below.
  const SkinHeaderBar = appSettings.skin?.components?.HeaderBar || null
  const headerMe = appSettings.mask(session.account)
  const privacyMode = appSettings.privacyMode
  const headerProps = {
    session, tier, view, setView, notifUnread: notifs.notifUnread,
    handleRefresh, setComposing, logout, openSettingsFrom,
  }

  return (
    <UIContext.Provider value={appSettings.skin?.components || {}}>
    <GhostContext.Provider value={{ ghostStatusId, inPanel: false }}>
    <AppSettingsContext.Provider value={appSettings.contextValue}>
    <PickerContext.Provider value={{ openPickerId, setOpenPickerId }}>
      {!online && (
        <div className="banner banner-offline">
          You&apos;re offline — updates paused. Content is from cache.
        </div>
      )}
      <ToastStack />
      {showPullIndicator && (
        <div className={`pull-indicator${refreshing ? ' refreshing' : ''}`} style={pull ? { transform: `translateX(-50%) translateY(${Math.min(pull / 2, 24)}px)` } : undefined}>
          <RotateCw size={14} className={refreshing ? 'spin' : undefined} />
          <span>{refreshing ? 'Refreshing…' : pull >= 80 ? 'Release to refresh' : 'Pull to refresh'}</span>
        </div>
      )}
      <ScrollTopButton scrollEl={scrollEl} tier={tier} />
      {SkinHeaderBar ? (
        <SkinHeaderBar {...headerProps} />
      ) : (
      <header className="headerbar">
        <div className="headerbar-brand-wrap">
          <button
            type="button"
            className="headerbar-brand headerbar-brand-btn"
            aria-label="Server details"
            onClick={() => setServerInfoOpen((v) => !v)}
          >
            <InstanceIcon instanceUrl={privacyMode ? null : session.instanceUrl} />
            <div className="headerbar-brand-text">
              rvmf
              {!privacyMode && (
                <div className="headerbar-subtitle">
                  {session.instanceUrl.replace(/^https?:\/\//, '')}
                </div>
              )}
            </div>
          </button>
          {serverInfoOpen && (
            <ServerInfoPopover
              open={serverInfoOpen}
              onClose={() => setServerInfoOpen(false)}
              instanceUrl={session.instanceUrl}
              token={session.token}
            />
          )}
        </div>

        <div className="view-switcher">
          <button
            className={`view-switcher-btn${view === 'home' ? ' active' : ''}`}
            aria-label="Home"
            onClick={() => setView('home')}
          >
            <Home size={14} />
            <span className="view-label">Home</span>
          </button>
          {tier !== 'wide' && (
            <button
              className={`view-switcher-btn${view === 'notifications' ? ' active' : ''}`}
              aria-label="Notifications"
              onClick={() => setView('notifications')}
            >
              <Bell size={14} />
              <span className="view-label">Notifications</span>
              {notifs.notifUnread > 0 && <span className="notif-badge">{notifs.notifUnread > 99 ? '99+' : notifs.notifUnread}</span>}
            </button>
          )}
          <button
            className={`view-switcher-btn${view === 'explore' ? ' active' : ''}`}
            aria-label="Explore"
            onClick={() => setView('explore')}
          >
            <Compass size={14} />
            <span className="view-label">Explore</span>
          </button>
          <button
            className={`view-switcher-btn${view === 'messages' ? ' active' : ''}`}
            aria-label="Messages"
            onClick={() => setView('messages')}
          >
            <MessageCircle size={14} />
            <span className="view-label">Messages</span>
          </button>
          <button
            className={`view-switcher-btn${view === 'lists' ? ' active' : ''}`}
            aria-label="Lists"
            onClick={() => setView('lists')}
          >
            <List size={14} />
            <span className="view-label">Lists</span>
          </button>
          <button
            className={`view-switcher-btn${view === 'groups' ? ' active' : ''}`}
            aria-label="Groups"
            onClick={() => setView('groups')}
          >
            <Users size={14} />
            <span className="view-label">Groups</span>
          </button>
          <button
            className={`view-switcher-btn${view === 'bookmarks' ? ' active' : ''}`}
            aria-label="Bookmarks"
            onClick={() => setView('bookmarks')}
          >
            <Bookmark size={14} />
            <span className="view-label">Bookmarks</span>
          </button>
          <button
            className={`view-switcher-btn${view === 'search' ? ' active' : ''}`}
            aria-label="Search"
            onClick={() => setView('search')}
          >
            <Search size={14} />
            <span className="view-label">Search</span>
          </button>
        </div>

        <div className="headerbar-actions">
          {tier === 'wide' && (
            <button
              className="icon-btn"
              aria-label="Back to top"
              title="Back to top"
              onClick={() => scrollEl?.scrollTo({
                top: 0,
                behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
              })}
            >
              <ArrowUpToLine size={16} />
            </button>
          )}
          <button className="icon-btn" aria-label="Refresh" title="Refresh" onClick={handleRefresh}>
            <RotateCw size={16} />
          </button>
          <div className="settings-menu-wrap">
            <button
              className="icon-btn"
              aria-label="Settings"
              title="Settings"
              onClick={(e) => {
                if (settingsOpen) { setSettingsOpen(false); return }
                openSettingsFrom(e)
              }}
            >
              <Settings size={16} />
            </button>
          </div>
          <button className="suggested-btn" aria-label="New post" onClick={() => setComposing(true)}>
            <Plus size={15} />
            <span className="view-label">New post</span>
          </button>
          <button className="icon-btn" aria-label="Log out" title="Log out" onClick={logout}>
            <LogOut size={16} />
          </button>
          <div className="headerbar-avatar">
            <Avatar
              name={headerMe.display_name || headerMe.username}
              src={headerMe.avatar}
            />
          </div>
        </div>
      </header>
      )}
      <SettingsMenu
        open={settingsOpen}
        anchor={settingsAnchor}
        settings={appSettings}
        onLogout={logout}
        onClose={() => setSettingsOpen(false)}
        onNavigate={setView}
      />

      {tier === 'wide' ? (
        <div className="app-shell">
          <aside className="notif-column scrollbar-thin">
            <div className="section-label-row">
            <div className="section-label">Notifications</div>
            {notifs.notifications.length > 0 && (
              <button
                className="icon-btn"
                aria-label="Clear all notifications"
                title="Clear all"
                onClick={notifs.clearNotifications}
                disabled={notifs.clearingNotifications}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
            <ErrorBoundary>{notificationsBody}</ErrorBoundary>
          </aside>
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}><ErrorBoundary>{timelineContent}</ErrorBoundary></div>
          <aside className="thread-column">
            {sidePanel ? (
              <>
                <ThreadPanelHeader {...threadPanelProps} />
                <div className="thread-column-scroll scrollbar-thin">
                  <ErrorBoundary><ThreadPanelContent {...threadPanelProps} /></ErrorBoundary>
                </div>
              </>
            ) : (
                <div className="thread-column-empty">
                <StatusPage
                  icon={MessageCircle}
                  heading="No thread open"
                  description="Select a post to view its replies."
                />
              </div>
            )}
          </aside>
        </div>
      ) : tier === 'medium' ? (
        <div className={`main-layout${sidePanel ? ' panel-open' : ''}`}>
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}><ErrorBoundary>{timelineContent}</ErrorBoundary></div>
          <ErrorBoundary><ThreadPanel {...threadPanelProps} /></ErrorBoundary>
        </div>
      ) : (
        <div className={`main-layout${sidePanel ? ' narrow-thread' : ''}`} ref={narrowThreadRef}>
          {sidePanel && <ThreadPanelHeader {...threadPanelProps} backLabel="Back to timeline" />}
          <div className="content-scroll scrollbar-thin" ref={setScrollEl}>
            {sidePanel ? (
              <div className="timeline-wrap">
                <ErrorBoundary><ThreadPanelContent {...threadPanelProps} backLabel="Back to timeline" /></ErrorBoundary>
              </div>
            ) : (
              timelineContent
            )}
          </div>
        </div>
      )}

      <MediaLightbox
        lightboxState={lightboxAttachment ? { ...lightboxAttachment, onNavigate: setLightboxAttachment } : null}
        onClose={() => setLightboxAttachment(null)}
      />

      {composing && (
        <ComposeDialog
          // Remount when the compose context (reply/quote/group target)
          // changes while open: non-draft state (uploads, poll, error,
          // idempotency key) must not leak across targets. Draft text
          // survives via useComposeDraft.
          key={replyContext?.id || quoteStatus?.id || composerGroup?.id || 'new'}
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => { setComposing(false); setQuoteStatus(null); setReplyContext(null); setComposerGroup(null) }}
          onPosted={tl.prependPost}
          quoteStatus={quoteStatus}
          replyToStatus={replyContext}
          maxCharacters={session.maxCharacters || 500}
          groupId={composerGroup?.id || null}
          groupName={composerGroup ? (composerGroup.display_name || composerGroup.acct || composerGroup.username) : null}
          currentAccountId={session.account?.id}
        />
      )}

      {editing && (
        <EditDialog
          status={editing}
          instanceUrl={session.instanceUrl}
          token={session.token}
          onClose={() => setEditing(null)}
          onSaved={handleEditSaved}
        />
      )}
    </PickerContext.Provider>
    </AppSettingsContext.Provider>
    </GhostContext.Provider>
    </UIContext.Provider>
  )
}
