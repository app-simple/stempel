import { Injectable, signal } from '@angular/core';

/** Kurze Rückmeldung unten auf der Seite, wie im Prototyp. */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly message = signal<string | null>(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(message: string): void {
    this.message.set(message);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.message.set(null), 6000);
  }
}
