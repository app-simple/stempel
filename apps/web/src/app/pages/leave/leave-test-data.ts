import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import {
  addDays,
  localDateInBerlin,
  type EmployeeView,
  type LeaveAccountView,
  type LeaveCalendarView,
  type LeavePreview,
  type LeaveRequestView,
  type Role,
} from '@as/shared';
import { SessionStore } from '../../core/session.store';

export const today = localDateInBerlin(new Date());
export const firstDay = addDays(today, 10);
export const lastDay = addDays(today, 14);
export const year = Number(today.slice(0, 4));
export const account: LeaveAccountView = {
  employeeId: 'self',
  employeeName: 'Testperson',
  year,
  entitlement: 60,
  entitlementBasis: 'STATUTORY_MINIMUM',
  carryOver: 5,
  corrections: 1,
  approved: 20,
  pending: 8,
  rest: 38,
  workDaysPerWeek: 5,
  employmentType: 'FULL_TIME',
};
export const request: LeaveRequestView = {
  id: 'request',
  employeeId: 'self',
  employeeName: 'Testperson',
  jobTitle: null,
  type: 'VACATION',
  from: firstDay,
  to: lastDay,
  startHalf: false,
  endHalf: false,
  halfDays: 10,
  currentHalfDays: 8,
  note: null,
  status: 'PENDING',
  requestedAt: '2026-10-01T08:00:00Z',
  enteredByName: null,
  decidedByName: null,
  decidedAt: null,
  decisionReason: null,
  cancelRequestedAt: null,
  cancelledAt: null,
  cancelledByName: null,
  canDecide: false,
  decision: null,
};
export const preview: LeavePreview = {
  halfDays: 10,
  years: [{ year, halfDays: 10, restBefore: 36, restAfter: 26 }],
  skippedHolidays: [{ date: '2026-11-01', name: 'Allerheiligen' }],
  errors: [],
  warnings: [],
  immediate: false,
  deciderName: 'Testleitung',
};
export const person: EmployeeView = {
  id: 'other',
  name: 'Teamperson',
  role: 'EMPLOYEE',
  jobTitle: null,
  leadId: 'self',
  leadName: 'Testleitung',
  deputyId: null,
  deputyName: null,
  entryDate: '2020-01-01',
  exitDate: null,
  status: 'ACTIVE',
  currentTerms: null,
  carryOver: null,
  warnings: [],
};
export const calendar: LeaveCalendarView = {
  month: today.slice(0, 7),
  days: [
    { date: today, weekday: 2, holidayName: null },
    { date: addDays(today, 1), weekday: 3, holidayName: 'Testfeiertag' },
    { date: addDays(today, 2), weekday: 6, holidayName: null },
  ],
  rows: [
    {
      employeeId: 'self',
      name: 'Testperson',
      cells: [{ status: 'APPROVED', half: false }, null, null],
      offDays: [false, true, false],
    },
  ],
  teamAbsentCounts: [2, 0, 1],
};
export async function setupSession(role: Role = 'EMPLOYEE') {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const http = TestBed.inject(HttpTestingController);
  const session = TestBed.inject(SessionStore).ensureLoaded();
  http
    .expectOne('/api/auth/session')
    .flush({ id: 'self', name: 'Testperson', role, method: 'EMAIL_CODE' });
  await session;
  return http;
}
export function enter(el: HTMLElement, selector: string, value: string, event = 'input') {
  const input = el.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Testfeld fehlt: ${selector}`);
  input.value = value;
  input.dispatchEvent(new Event(event));
}
export function check(el: HTMLElement, selector: string, checked = true) {
  const input = el.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`Testfeld fehlt: ${selector}`);
  input.checked = checked;
  input.dispatchEvent(new Event('change'));
}
export function button(el: HTMLElement, text: string) {
  const found = [...el.querySelectorAll<HTMLButtonElement>('button')].find(
    (b) => b.textContent?.trim() === text,
  );
  if (!found) throw new Error(`Testbutton fehlt: ${text}`);
  return found;
}
