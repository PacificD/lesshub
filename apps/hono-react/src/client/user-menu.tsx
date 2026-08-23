import { useEffect, useState } from 'react'
import { hydrateRoot } from 'react-dom/client'
import type { User } from '@lesshub/commerce-contracts'
import {
  INITIAL_USER_MENU_PROPS,
  USER_MENU_IDENTIFIER_PREFIX,
  UserMenu,
  type UserMenuStatus
} from '../components/UserMenuSkeleton.js'

export function recordRecoverableHydrationError(error: unknown): void {
  console.error('[user-menu-hydration-recoverable]', error)
  window.dispatchEvent(
    new CustomEvent('lesshub:hydration-error', { detail: String(error) })
  )
}

export function UserMenuIsland() {
  const [status, setStatus] = useState<UserMenuStatus>('loading')
  const [user, setUser] = useState<User | undefined>()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    void fetch('/api/me', { credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('member request failed')
        return (await response.json()) as { user: User | null }
      })
      .then(result => {
        setUser(result.user ?? undefined)
        setStatus(result.user ? 'ready' : 'anonymous')
        performance.mark('lesshub:user-menu-ready')
      })
      .catch(error => {
        if ((error as Error).name !== 'AbortError') {
          setStatus('unavailable')
          performance.mark('lesshub:user-menu-ready')
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!open) return
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        container?.querySelector('button')?.focus()
      }
    }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [open])

  return (
    <UserMenu
      status={status}
      user={user}
      open={open}
      controlsId='lh-user-menu-panel'
      onToggle={() => setOpen(value => !value)}
    />
  )
}

const container =
  typeof document === 'undefined'
    ? null
    : document.querySelector<HTMLElement>('[data-island="user-menu"]')
if (container) {
  hydrateRoot(container, <UserMenuIsland />, {
    identifierPrefix: USER_MENU_IDENTIFIER_PREFIX,
    onRecoverableError: recordRecoverableHydrationError
  })
}

export { INITIAL_USER_MENU_PROPS }
