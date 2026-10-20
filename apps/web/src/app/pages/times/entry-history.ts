import { Component, inject, input, resource } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { berlinTimestamp, snapshotLabel } from './time-display';

@Component({
  selector: 'app-entry-history',
  template: `
    <h3 class="my-2 font-semibold">Verlauf</h3>
    @if (history.hasValue()) {
      @for (revision of history.value(); track revision.id) {
        <div class="mb-3 border-l-2 border-line pl-3">
          <p class="m-0">
            <span class="font-mono">{{ timestamp(revision.changedAt) }}</span> ·
            {{ revision.changedByName ?? 'Unbekannte Person' }}
          </p>
          <p class="my-1">{{ revision.reason }}</p>
          <p class="m-0 font-mono text-sm">Vorher: {{ snapshot(revision.before) }}</p>
          <p class="m-0 font-mono text-sm">Nachher: {{ snapshot(revision.after) }}</p>
        </div>
      } @empty {
        <p class="text-muted">Noch keine Änderungen.</p>
      }
    } @else if (history.error()) {
      <p class="err" role="alert">Der Verlauf konnte nicht geladen werden.</p>
      <button class="btn btn-sm" type="button" (click)="history.reload()">
        Verlauf erneut laden
      </button>
    } @else {
      <p role="status">Verlauf wird geladen …</p>
    }
  `,
})
export class EntryHistory {
  private readonly api = inject(ApiService);
  readonly entryId = input.required<string>();
  protected readonly history = resource({
    params: () => this.entryId(),
    loader: ({ params }) => this.api.revisions(params),
  });
  protected readonly timestamp = berlinTimestamp;
  protected readonly snapshot = snapshotLabel;
}
