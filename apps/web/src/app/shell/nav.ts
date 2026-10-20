import type { Role } from '@as/shared';
import {
  LucideCalendarHeart,
  LucideCalendarRange,
  LucideCircleCheck,
  LucideClock,
  LucideHouse,
  LucideShieldCheck,
  LucideTreePalm,
  LucideUserRound,
  LucideUsers,
  type LucideIcon,
} from '@lucide/angular';

export interface NavItem {
  path: string;
  label: string;
  /** Symbol in Seitenleiste und Schublade (Spezifikation Design, Abschnitt 3). */
  icon: LucideIcon;
  /** Ohne Angabe: alle Rollen. */
  roles?: Role[];
  /** Zähler am Menüpunkt. */
  badge?: 'approvals';
  /** Nur für Personen, die entscheiden (Vorgesetzte, Admin, aktive Vertretung). */
  decides?: true;
}

/** Navigation nach Rolle. Menüpunkte späterer Phasen kommen mit ihrer Phase. */
export const NAV_ITEMS: NavItem[] = [
  { path: '/', label: 'Heute', icon: LucideHouse },
  { path: '/zeiten', label: 'Zeiten', icon: LucideClock },
  { path: '/urlaub', label: 'Mein Urlaub', icon: LucideTreePalm },
  {
    path: '/freigaben',
    label: 'Freigaben',
    icon: LucideCircleCheck,
    decides: true,
    badge: 'approvals',
  },
  { path: '/urlaubsuebersicht', label: 'Urlaubsübersicht', icon: LucideCalendarRange },
  { path: '/pruefungen', label: 'Prüfungen', icon: LucideShieldCheck, roles: ['LEAD', 'ADMIN'] },
  { path: '/mitarbeiter', label: 'Mitarbeiter', icon: LucideUsers, roles: ['ADMIN'] },
  { path: '/feiertage', label: 'Feiertage', icon: LucideCalendarHeart },
  { path: '/profil', label: 'Profil', icon: LucideUserRound },
];

export function navFor(role: Role | null, decides = false): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter(
    (item) => (!item.roles || item.roles.includes(role)) && (!item.decides || decides),
  );
}

/** Titel der Kopfleiste: Menüpunkt, zu dem die Adresse gehört (Unterseiten eingeschlossen). */
export function pageTitleFor(url: string, items: NavItem[]): string {
  const path = url.split(/[?#]/)[0] || '/';
  const item = items.find((i) =>
    i.path === '/' ? path === '/' : path === i.path || path.startsWith(i.path + '/'),
  );
  return item?.label ?? 'Zeit & Urlaub';
}
