import { useId } from 'react'
import type { User } from '@lesshub/commerce-contracts'

export type UserMenuStatus = 'loading' | 'anonymous' | 'ready' | 'unavailable'
export interface UserMenuProps {
  status: UserMenuStatus
  user?: User | undefined
  open?: boolean
  controlsId?: string
  onToggle?: () => void
}

export const INITIAL_USER_MENU_PROPS: UserMenuProps = Object.freeze({
  status: 'loading' as const,
  open: false,
  controlsId: 'lh-user-menu-panel'
})
export const USER_MENU_IDENTIFIER_PREFIX = 'lh-user-menu-'

export function UserMenu({
  status,
  user,
  open = false,
  controlsId = 'lh-user-menu-panel',
  onToggle
}: UserMenuProps) {
  const statusId = useId()
  const label =
    status === 'ready' && user
      ? user.displayName
      : status === 'anonymous'
        ? 'Guest ledger'
        : status === 'unavailable'
          ? 'Member unavailable'
          : 'Member ledger'
  return (
    <div className='user-menu' data-state={status}>
      <button
        className='user-menu__trigger'
        type='button'
        disabled={status === 'loading'}
        aria-expanded={open}
        aria-controls={controlsId}
        aria-describedby={statusId}
        onClick={onToggle}
      >
        <span className='user-menu__mark' aria-hidden='true' />
        <span id={statusId}>{label}</span>
        <span className='user-menu__chevron' aria-hidden='true'>
          ⌄
        </span>
      </button>
      <div
        className='user-menu__reveal'
        data-open={open ? 'true' : 'false'}
        id={controlsId}
        aria-hidden={!open}
      >
        <div className='user-menu__panel'>
          {status === 'ready' && user ? (
            <>
              <p className='user-menu__tier'>{user.membershipTier} member</p>
              <strong>{user.points.toLocaleString()} points</strong>
              <a href='/account' tabIndex={open ? 0 : -1}>
                Personal center
              </a>
            </>
          ) : (
            <p>
              {status === 'unavailable'
                ? 'Member data is temporarily unavailable.'
                : 'Sign in with the demo session to view account details.'}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export function UserMenuSkeleton() {
  return (
    <div data-island='user-menu'>
      <UserMenu {...INITIAL_USER_MENU_PROPS} />
    </div>
  )
}
