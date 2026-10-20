import { Injectable, signal } from '@angular/core';

/** Adresse zwischen den beiden Anmeldeschritten; nur im Speicher, nie in URL oder Storage. */
@Injectable({ providedIn: 'root' })
export class LoginFlow {
  readonly email = signal<string | null>(null);
}
