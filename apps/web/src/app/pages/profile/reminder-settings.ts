import { ExpandableRows, RowToggle } from '../../shared-ui';
import { NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  Component,
  ElementRef,
  inject,
  Injector,
  input,
  linkedSignal,
  resource,
  signal,
} from '@angular/core';
import { formatLocalDate, localDateInBerlin, type PushDeviceView } from '@as/shared';
import { ApiError, ApiService } from '../../core/api.service';
import { PushDevice } from '../../core/push-device';
import { ToastService } from '../../core/toast.service';

@Component({
  selector: 'app-reminder-settings',
  imports: [RowToggle, NgTemplateOutlet],
  template: `
    <ng-template #deviceAction let-device>
      <button
        class="btn btn-sm"
        type="button"
        [disabled]="busy()"
        [attr.aria-label]="'Gerät ' + device.deviceName + ' entfernen'"
        (click)="remove(device)"
      >
        Entfernen
      </button>
    </ng-template>
    <section class="card">
      <h2>Erinnerungen</h2>
      <h3 id="reminder-device-state" tabindex="-1">Benachrichtigungen auf diesem Gerät</h3>
      @if (deviceStatus.hasValue()) {
        @switch (push.state()) {
          @case ('unsupported') {
            <p class="m-0 text-sm">
              Dieser Browser kann keine Benachrichtigungen empfangen. Auf iPhone und iPad zuerst
              „Zum Home-Bildschirm“ hinzufügen und die App von dort öffnen.
            </p>
          }
          @case ('disabled') {
            <p class="m-0 text-sm">
              Benachrichtigungen sind auf dem Server nicht eingerichtet. Du bekommst Erinnerungen
              per E-Mail.
            </p>
          }
          @case ('denied') {
            <p class="m-0 text-sm">
              Benachrichtigungen sind blockiert. Ändere die Erlaubnis in den Browsereinstellungen
              und lade die Seite neu.
            </p>
          }
          @case ('off') {
            <div>
              <button
                class="btn"
                type="button"
                data-device-action
                [disabled]="busy()"
                (click)="enable()"
              >
                Benachrichtigungen einschalten
              </button>
            </div>
          }
          @case ('on') {
            <p class="m-0">Eingeschaltet</p>
            <div class="flex flex-wrap gap-2">
              <button
                class="btn"
                type="button"
                data-device-action
                [disabled]="busy()"
                (click)="test()"
              >
                Testnachricht senden
              </button>
              <button class="btn" type="button" [disabled]="busy()" (click)="disable()">
                Auf diesem Gerät ausschalten
              </button>
            </div>
          }
        }
      } @else if (deviceStatus.error()) {
        <p class="err m-0" role="alert">Der Benachrichtigungsstatus konnte nicht geladen werden.</p>
        <div>
          <button class="btn" type="button" (click)="deviceStatus.reload()">
            Benachrichtigungsstatus erneut laden
          </button>
        </div>
      } @else {
        <p class="m-0" role="status">Benachrichtigungsstatus wird geladen …</p>
      }
      <h3 id="reminder-devices" tabindex="-1">Deine Geräte</h3>
      @if (devices.hasValue()) {
        <div class="overflow-x-auto">
          <table class="data-table">
            <thead>
              <tr>
                <th>Gerät</th>
                <th class="col-opt">Angemeldet am</th>
                <th class="col-opt">Zuletzt erreicht</th>
                <th class="col-opt">Aktion</th>
                <th class="col-narrow"><span class="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              @for (device of devices.value(); track device.id) {
                <tr (click)="rows.onRowClick(device.id, $event)">
                  <td>
                    {{ device.deviceName }}
                    @if (device.endpointHash === currentHash()) {
                      <span class="text-muted">(dieses Gerät)</span>
                    }
                  </td>
                  <td class="col-opt">{{ timestamp(device.createdAt) }}</td>
                  <td class="col-opt">
                    {{
                      device.lastSuccessAt ? timestamp(device.lastSuccessAt) : 'Noch nicht erreicht'
                    }}
                  </td>
                  <td class="col-opt">
                    <ng-container
                      [ngTemplateOutlet]="deviceAction"
                      [ngTemplateOutletContext]="{ $implicit: device }"
                    />
                  </td>
                  <td class="col-narrow">
                    <app-row-toggle
                      [open]="rows.isOpen(device.id)"
                      [label]="'Details zu ' + device.deviceName"
                      (toggled)="rows.toggle(device.id)"
                    />
                  </td>
                </tr>
                @if (rows.isOpen(device.id)) {
                  <tr class="row-details">
                    <td colspan="5">
                      <dl class="details">
                        <dt>Angemeldet am</dt>
                        <dd>{{ timestamp(device.createdAt) }}</dd>
                        <dt>Zuletzt erreicht</dt>
                        <dd>
                          {{
                            device.lastSuccessAt
                              ? timestamp(device.lastSuccessAt)
                              : 'Noch nicht erreicht'
                          }}
                        </dd>
                        <dt>Aktion</dt>
                        <dd>
                          <ng-container
                            [ngTemplateOutlet]="deviceAction"
                            [ngTemplateOutletContext]="{ $implicit: device }"
                          />
                        </dd>
                      </dl>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="5">Keine Geräte angemeldet.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      } @else if (devices.error()) {
        <p class="err m-0" role="alert">Deine Geräte konnten nicht geladen werden.</p>
        <div>
          <button class="btn" type="button" (click)="devices.reload()">Geräte erneut laden</button>
        </div>
      } @else {
        <p class="m-0" role="status">Deine Geräte werden geladen …</p>
      }
      <label for="reminder-email">
        <input
          id="reminder-email"
          type="checkbox"
          [checked]="email()"
          [disabled]="busy()"
          (change)="saveEmail($event)"
        />
        Erinnerung per E-Mail, wenn kein Gerät angemeldet ist
      </label>
      <div id="reminder-error" tabindex="-1">
        @if (error()) {
          <p class="err m-0" role="alert">{{ error() }}</p>
        }
      </div>
      <h3>Was das System auswertet</h3>
      <p class="m-0 text-sm text-muted">
        Der übliche Beginn wird je Wochentag aus deinen eigenen Stempelzeiten der letzten acht
        Wochen gelernt (Median, Nachträge zählen nicht, unter drei Werten gilt die Standardzeit).
        Erinnerungen gehen nur an dich, nie an Vorgesetzte; gestempelt wird nie automatisch.
        Nachträge werden gezählt: Anzahl, Anteil und durchschnittlicher Verzug in den letzten
        Wochen; ab den eingestellten Schwellen gilt das als auffällig. Du siehst deine eigene Quote
        unter „Zeiten“; Vorgesetzte sehen die Werte ihres Teams, der Admin alle. Rechtliche Details
        stehen in den Datenschutzhinweisen des Betriebs.
      </p>
    </section>
  `,
})
export class ReminderSettings {
  protected readonly rows = new ExpandableRows();
  readonly emailFallback = input.required<boolean>();
  private readonly api = inject(ApiService);
  protected readonly push = inject(PushDevice);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  protected readonly currentHash = signal<string | null>(null);
  protected readonly deviceStatus = resource({ loader: () => this.loadDeviceStatus() });
  protected readonly devices = resource({ loader: () => this.api.pushDevices() });
  protected readonly email = linkedSignal(() => this.emailFallback());
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected timestamp(iso: string): string {
    return formatLocalDate(localDateInBerlin(new Date(iso)));
  }
  private async loadDeviceStatus() {
    const state = await this.push.refresh();
    this.currentHash.set(await this.push.currentEndpointHash());
    return state;
  }
  protected async enable(): Promise<void> {
    await this.run(async () => {
      this.deviceStatus.set(await this.push.enable());
      this.currentHash.set(await this.push.currentEndpointHash());
      this.devices.reload();
    });
  }
  protected async disable(): Promise<void> {
    await this.run(async () => {
      this.deviceStatus.set(await this.push.disable());
      this.currentHash.set(null);
      this.devices.reload();
    });
  }
  protected async test(): Promise<void> {
    await this.run(async () => {
      const result = await this.api.testPush();
      this.toast.show(`Testnachricht an ${result.delivered} Geräte zugestellt.`);
    });
  }
  protected async remove(device: PushDeviceView): Promise<void> {
    await this.run(async () => {
      // Das eigene Gerät auch im Browser abmelden, sonst stünde dort weiter „Eingeschaltet“.
      if (device.endpointHash === this.currentHash()) {
        this.deviceStatus.set(await this.push.disable());
        this.currentHash.set(null);
      } else {
        await this.api.removePushDevice(device.id);
      }
      if (this.devices.hasValue())
        this.devices.set(this.devices.value().filter((d) => d.id !== device.id));
      this.toast.show(`Gerät „${device.deviceName}“ entfernt.`);
    }, '#reminder-devices');
  }
  protected async saveEmail(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const next = input.checked;
    input.checked = this.email();
    await this.run(async () => {
      const result = await this.api.setReminderEmailFallback(next);
      this.email.set(result.emailFallback);
      this.toast.show('E-Mail-Erinnerung gespeichert.');
    }, '#reminder-email');
  }
  private async run(action: () => Promise<void>, target = '[data-device-action]'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
      this.focus(target);
    } catch (error) {
      this.error.set(
        error instanceof ApiError
          ? error.message
          : 'Die Erinnerungseinstellung konnte nicht geändert werden.',
      );
      this.focus('#reminder-error');
    } finally {
      this.busy.set(false);
    }
  }
  private focus(selector: string): void {
    afterNextRender(
      () => {
        const target =
          this.host.nativeElement.querySelector<HTMLElement>(selector) ??
          this.host.nativeElement.querySelector<HTMLElement>('#reminder-device-state');
        target?.focus();
      },
      { injector: this.injector },
    );
  }
}
