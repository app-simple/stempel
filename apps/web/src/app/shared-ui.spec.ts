import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExpandableRows, firstVisible, RowToggle } from './shared-ui';

@Component({
  imports: [RowToggle],
  template: `
    <table>
      <tbody>
        <tr (click)="rows.onRowClick('a', $event)">
          <td>A</td>
          <td><button type="button" (click)="acted = acted + 1">Aktion</button></td>
          <td>
            <app-row-toggle
              [open]="rows.isOpen('a')"
              label="Details zu A"
              (toggled)="rows.toggle('a')"
            />
          </td>
        </tr>
        @if (rows.isOpen('a')) {
          <tr class="row-details">
            <td>Details</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
class Host {
  readonly rows = new ExpandableRows();
  acted = 0;
}

describe('ExpandableRows und RowToggle', () => {
  function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('klappt per Tipp auf die Zeile auf und wieder zu', () => {
    const { fixture, el } = render();
    el.querySelector<HTMLTableCellElement>('td')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.row-details')).not.toBeNull();
    expect(el.querySelector('app-row-toggle button')!.getAttribute('aria-expanded')).toBe('true');
    el.querySelector<HTMLTableCellElement>('td')!.click();
    fixture.detectChanges();
    expect(el.querySelector('.row-details')).toBeNull();
  });

  it('klappt über den Knopf genau einmal um (kein doppeltes Umschalten durch die Zeile)', () => {
    const { fixture, el } = render();
    const toggle = el.querySelector<HTMLButtonElement>('app-row-toggle button')!;
    expect(toggle.getAttribute('aria-label')).toBe('Details zu A');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    fixture.detectChanges();
    expect(el.querySelector('.row-details')).not.toBeNull();
  });

  it('führt Aktionen in der Zeile aus, ohne aufzuklappen (Review Focus 4)', () => {
    const { fixture, el } = render();
    [...el.querySelectorAll('button')].find((b) => b.textContent === 'Aktion')!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.acted).toBe(1);
    expect(el.querySelector('.row-details')).toBeNull();
  });
});

describe('firstVisible (Review Design, Befund 4)', () => {
  function el(visible: boolean): HTMLElement {
    const node = document.createElement('button');
    node.getClientRects = () => (visible ? [{}] : []) as unknown as DOMRectList;
    return node;
  }
  it('wählt das erste sichtbare Element, nicht das erste im DOM', () => {
    const hidden = el(false);
    const shown = el(true);
    expect(firstVisible([hidden, shown])).toBe(shown);
  });
  it('fällt ohne Layout (z. B. jsdom) auf das erste Element zurück', () => {
    const a = el(false);
    expect(firstVisible([a, el(false)])).toBe(a);
    expect(firstVisible([])).toBeUndefined();
  });
});
