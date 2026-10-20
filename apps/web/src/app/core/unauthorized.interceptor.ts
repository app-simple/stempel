import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { SessionStore } from './session.store';

/** Abgelaufene Sitzung: zurück zur Anmeldung. Anmelde-Endpunkte behandeln 401 selbst. */
export const unauthorizedInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(SessionStore);
  const router = inject(Router);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.url.startsWith('/api/auth/')
      ) {
        store.clear();
        void router.navigateByUrl('/anmelden');
      }
      return throwError(() => error);
    }),
  );
};
