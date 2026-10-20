import { Component, input, output, signal } from '@angular/core';
import { LucideChevronDown } from '@lucide/angular';
import type { ApiMessage } from '@as/shared';

/** Seitenkopf wie im Prototyp. */
@Component({
  selector: 'app-page-head',
  template: `
    <div class="flex min-w-0 flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 flex-1 basis-64">
        <h1>{{ heading() }}</h1>
        @if (lead()) {
          <p class="lead">{{ lead() }}</p>
        }
      </div>
      <ng-content />
    </div>
  `,
})
export class PageHead {
  readonly heading = input.required<string>();
  readonly lead = input<string>();
}

/** Regelmeldungen als Pillen mit Paragraf, wie `flagHtml` im Prototyp. Bringt eine Meldung ihre Stufe mit, gilt diese. */
@Component({
  selector: 'app-rule-messages',
  template: `
    @for (m of messages(); track m.code) {
      <span class="pill" [class]="'lv-' + (m.level ?? level())"
        >{{ m.text }}
        @if (m.paragraph) {
          <span class="par">{{ m.paragraph }}</span>
        }
      </span>
    }
  `,
})
export class RuleMessages {
  readonly messages =
    input.required<readonly (ApiMessage & { level?: 'crit' | 'warn' | 'info' })[]>();
  readonly level = input<'crit' | 'warn' | 'info'>('warn');
}

/** Aufklappbare Detailzeilen für schmale Bildschirme (Spezifikation Design, Abschnitt 4). */
export class ExpandableRows {
  private readonly open = signal<ReadonlySet<string>>(new Set());

  isOpen(id: string): boolean {
    return this.open().has(id);
  }

  toggle(id: string): void {
    this.open.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Tipp auf die Zeile; Bedienelemente in der Zeile behalten ihre eigene Wirkung (Review Focus 4). */
  onRowClick(id: string, event: Event): void {
    const target = event.target as Element | null;
    if (target?.closest('button, a, input, select, textarea, label, summary, dialog')) return;
    this.toggle(id);
  }
}

/** Aufklapper am Zeilenende; nur unter 640 px sichtbar (Klasse `col-narrow` an der Zelle). */
@Component({
  selector: 'app-row-toggle',
  imports: [LucideChevronDown],
  template: `
    <button
      type="button"
      class="row-toggle"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="label()"
      (click)="toggled.emit()"
    >
      <svg
        lucideChevronDown
        [size]="20"
        aria-hidden="true"
        class="transition-transform"
        [class.rotate-180]="open()"
      ></svg>
    </button>
  `,
})
export class RowToggle {
  readonly open = input.required<boolean>();
  readonly label = input.required<string>();
  readonly toggled = output<void>();
}

/**
 * Erstes sichtbares Element (z. B. Knopf in der Detailzeile statt in der ausgeblendeten Zelle).
 * Ohne Layout (Tests) das erste Element.
 */
export function firstVisible<T extends Element>(elements: T[]): T | undefined {
  return elements.find((element) => element.getClientRects().length > 0) ?? elements[0];
}
