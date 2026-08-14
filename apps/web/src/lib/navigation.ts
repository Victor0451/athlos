import type { CurrentUser } from './auth'
import {
  CalendarClock,
  ClipboardList,
  LayoutDashboard,
  Receipt,
  Settings,
  ShieldAlert,
  Stamp,
  Tags,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

export interface NavigationItem {
  href: string
  label: string
  icon: LucideIcon
  section?: 'Operations'
  roles?: CurrentUser['role'][]
  permission?: keyof CurrentUser['permissions']
}

export const navigation: NavigationItem[] = [
  { href: '/dashboard', label: 'Panel de control', icon: LayoutDashboard },
  { href: '/socios', label: 'Socios', icon: Users },
  { href: '/ctacte', label: 'Cuenta corriente', icon: Wallet },
  { href: '/padrones', label: 'Padrones', icon: ClipboardList },
  {
    href: '/admin/scheduler',
    label: 'Tareas programadas',
    icon: CalendarClock,
    section: 'Operations',
    roles: ['ADMIN'],
  },
  {
    href: '/admin/approvals',
    label: 'Aprobaciones',
    icon: Stamp,
    section: 'Operations',
    roles: ['ADMIN'],
  },
  {
    href: '/admin/gastos',
    label: 'Gastos',
    icon: Receipt,
    section: 'Operations',
    roles: ['ADMIN'],
  },
  { href: '/admin/settings', label: 'Configuración', icon: Settings, roles: ['ADMIN'] },
  {
    href: '/admin/socios-evidence-exceptions',
    label: 'Socios: excepciones',
    icon: ShieldAlert,
    permission: 'data_steward',
  },
  {
    href: '/admin/membership-types',
    label: 'Tipos de afiliación',
    icon: Tags,
    permission: 'data_steward',
  },
]

export function visibleNavigation(user: CurrentUser | null) {
  return navigation.filter(
    (item) =>
      (!item.roles || (user && item.roles.includes(user.role))) &&
      (!item.permission || user?.role === 'ADMIN' || user?.permissions[item.permission] === true),
  )
}
