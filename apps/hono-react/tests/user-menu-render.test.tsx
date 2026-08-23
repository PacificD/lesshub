import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  INITIAL_USER_MENU_PROPS,
  USER_MENU_IDENTIFIER_PREFIX,
  UserMenu,
  UserMenuSkeleton
} from '../src/components/UserMenuSkeleton.js'
import {
  UserMenuIsland,
  recordRecoverableHydrationError
} from '../src/client/user-menu.js'

describe('user-menu hydration contract', () => {
  it('uses byte-identical server children and client initial component markup', () => {
    const options = { identifierPrefix: USER_MENU_IDENTIFIER_PREFIX }
    const server = renderToString(<UserMenuSkeleton />, options)
    const clientInitial = renderToString(<UserMenuIsland />, options)
    expect(clientInitial).toBe(
      renderToString(<UserMenu {...INITIAL_USER_MENU_PROPS} />, options)
    )
    expect(server).toContain(`data-island="user-menu">${clientInitial}</div>`)
    expect(USER_MENU_IDENTIFIER_PREFIX).toBe('lh-user-menu-')
    expect(server).toContain('lh-user-menu-')
    expect(recordRecoverableHydrationError).toBeTypeOf('function')
    expect(server).not.toContain('Ada Chen')
    expect(server).not.toContain('points')
  })
})
