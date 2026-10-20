import type { Route } from '@angular/router';

export const employeesRoutes: Route[] = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Mitarbeiter · Zeit & Urlaub',
    loadComponent: () => import('./employees-list-page').then((m) => m.EmployeesListPage),
  },
  {
    path: 'neu',
    title: 'Mitarbeiter anlegen · Zeit & Urlaub',
    loadComponent: () => import('./employee-page').then((m) => m.EmployeePage),
  },
  {
    path: ':id',
    title: 'Mitarbeiter bearbeiten · Zeit & Urlaub',
    loadComponent: () => import('./employee-page').then((m) => m.EmployeePage),
  },
];
