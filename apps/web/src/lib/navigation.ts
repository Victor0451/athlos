import type { CurrentUser } from './auth'

export interface NavigationItem {
  href: string
  label: string
  section?: 'Operations'
  roles?: CurrentUser['role'][]
  permission?: keyof CurrentUser['permissions']
}

export const navigation: NavigationItem[] = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/socios', label: 'Socios' },
  { href: '/ctacte', label: 'Ctacte' },
  { href: '/padrones', label: 'Padrones' },
  { href: '/admin/scheduler', label: 'Scheduler', section: 'Operations', roles: ['ADMIN'] },
  { href: '/admin/approvals', label: 'Approvals', section: 'Operations', roles: ['ADMIN'] },
  { href: '/admin/gastos', label: 'Gastos', section: 'Operations', roles: ['ADMIN'] },
  { href: '/admin/settings', label: 'Settings', roles: ['ADMIN'] },
  {
    href: '/admin/socios-evidence-exceptions',
    label: 'Socios: excepciones',
    permission: 'data_steward',
  },
  { href: '/admin/membership-types', label: 'Tipos de afiliación', permission: 'data_steward' },
]

export function visibleNavigation(user: CurrentUser | null) {
  return navigation.filter(
    (item) =>
      (!item.roles || (user && item.roles.includes(user.role))) &&
      (!item.permission || user?.role === 'ADMIN' || user?.permissions[item.permission] === true),
  )
}
