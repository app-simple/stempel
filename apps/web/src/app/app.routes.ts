import type { Route } from '@angular/router';
import { approvalsGuard, roleGuard, signedInGuard, signedOutGuard } from './core/guards';
import { Shell } from './shell/shell';

const title = (page: string): string => `${page} · Zeit & Urlaub`;

export const appRoutes: Route[] = [
  {
    path: 'anmelden',
    canActivate: [signedOutGuard],
    title: title('Anmelden'),
    loadComponent: () => import('./pages/login/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'anmelden/code',
    canActivate: [signedOutGuard],
    title: title('Code eingeben'),
    loadComponent: () => import('./pages/login/code-page').then((m) => m.CodePage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [signedInGuard],
    children: [
      {
        path: '',
        title: title('Start'),
        loadComponent: () => import('./pages/home/home-page').then((m) => m.HomePage),
      },
      {
        path: 'profil',
        title: title('Profil'),
        loadComponent: () => import('./pages/profile/profile-page').then((m) => m.ProfilePage),
      },
      {
        path: 'zeiten',
        title: title('Zeiten'),
        loadComponent: () => import('./pages/times/times-page').then((m) => m.TimesPage),
      },
      {
        path: 'freigaben',
        title: title('Freigaben'),
        canActivate: [approvalsGuard],
        loadComponent: () =>
          import('./pages/approvals/approvals-page').then((m) => m.ApprovalsPage),
      },
      {
        path: 'urlaub',
        title: title('Mein Urlaub'),
        loadComponent: () => import('./pages/leave/leave-page').then((m) => m.LeavePage),
      },
      {
        path: 'urlaubsuebersicht',
        title: title('Urlaubsübersicht'),
        loadComponent: () =>
          import('./pages/leave-overview/leave-overview-page').then((m) => m.LeaveOverviewPage),
      },
      {
        path: 'pruefungen',
        title: title('Prüfungen'),
        canActivate: [roleGuard('LEAD', 'ADMIN')],
        loadComponent: () => import('./pages/checks/checks-page').then((m) => m.ChecksPage),
      },
      {
        path: 'feiertage',
        title: title('Feiertage'),
        loadComponent: () => import('./pages/holidays/holidays-page').then((m) => m.HolidaysPage),
      },
      {
        path: 'mitarbeiter',
        canActivate: [roleGuard('ADMIN')],
        loadChildren: () =>
          import('./pages/employees/employees.routes').then((m) => m.employeesRoutes),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
