import { Component, computed, input } from '@angular/core';
import { ApiError } from '../../core/api.service';
import { RuleMessages } from '../../shared-ui';

@Component({
  selector: 'app-employee-errors',
  imports: [RuleMessages],
  template: `
    @if (error()) {
      <div class="err" role="alert">
        <p class="m-0">{{ message() }}</p>
        @if (details().length) {
          <ul>
            @for (item of details(); track item.code) {
              <li>{{ item.text }}</li>
            }
          </ul>
        }
        <app-rule-messages [messages]="warnings()" level="warn" />
      </div>
    }
  `,
})
export class EmployeeErrors {
  readonly error = input<unknown>(null);
  protected readonly message = computed(() => {
    const e = this.error();
    return e instanceof ApiError
      ? e.message
      : 'Die Anfrage ist fehlgeschlagen. Bitte versuche es erneut.';
  });
  protected readonly details = computed(() => {
    const e = this.error();
    return e instanceof ApiError ? e.errors : [];
  });
  protected readonly warnings = computed(() => {
    const e = this.error();
    return e instanceof ApiError ? e.warnings : [];
  });
}
