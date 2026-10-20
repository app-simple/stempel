import type { EmploymentType, IsoWeekday, LegalParameterKey, LocalDate, Role } from '@as/shared';
import type { EmploymentTermsInput } from '@as/time-rules';

export interface SeedEmployee {
  /** Referenz aus dem Prototyp, keine Datenbank-ID. */
  id: string;
  name: string;
  jobTitle: string;
  role: Role;
  leadId: string | null;
  loginEmail: string;
  entryDate: LocalDate;
  terms: EmploymentTermsInput & { validFrom: LocalDate };
  carryOver: { year: number; days: number } | null;
}

interface PrototypeEmployee {
  id: string;
  name: string;
  func: string;
  role: 'admin' | 'lead' | 'ma';
  leadId: string | null;
  type: 'vollzeit' | 'teilzeit' | 'minijob';
  weekHours: number;
  days: readonly IsoWeekday[];
  vac: number;
  carry: number;
  wage: number | null;
  entry: LocalDate;
}

// Ausschließlich Beispieldaten aus prototype/index.html (Array employees).
const prototypeEmployees: readonly PrototypeEmployee[] = [
  {
    id: 'e1',
    name: 'Katharina Brandl',
    func: 'Geschäftsführung',
    role: 'admin',
    leadId: null,
    type: 'vollzeit',
    weekHours: 40,
    days: [1, 2, 3, 4, 5],
    vac: 30,
    carry: 0,
    wage: null,
    entry: '2015-03-01',
  },
  {
    id: 'e2',
    name: 'Tobias Lechner',
    func: 'Teamleitung Entwicklung',
    role: 'lead',
    leadId: 'e1',
    type: 'vollzeit',
    weekHours: 40,
    days: [1, 2, 3, 4, 5],
    vac: 30,
    carry: 0,
    wage: null,
    entry: '2017-09-01',
  },
  {
    id: 'e3',
    name: 'Miriam Stadler',
    func: 'Teamleitung Service',
    role: 'lead',
    leadId: 'e1',
    type: 'vollzeit',
    weekHours: 40,
    days: [1, 2, 3, 4, 5],
    vac: 30,
    carry: 0,
    wage: null,
    entry: '2018-01-15',
  },
  {
    id: 'e4',
    name: 'Jonas Reitberger',
    func: 'Entwicklung',
    role: 'ma',
    leadId: 'e2',
    type: 'vollzeit',
    weekHours: 40,
    days: [1, 2, 3, 4, 5],
    vac: 30,
    carry: 2,
    wage: null,
    entry: '2020-04-01',
  },
  {
    id: 'e5',
    name: 'Elif Aydin',
    func: 'Entwicklung',
    role: 'ma',
    leadId: 'e2',
    type: 'vollzeit',
    weekHours: 40,
    days: [1, 2, 3, 4, 5],
    vac: 30,
    carry: 0,
    wage: null,
    entry: '2021-10-01',
  },
  {
    id: 'e6',
    name: 'Sebastian Wolf',
    func: 'Entwicklung',
    role: 'ma',
    leadId: 'e2',
    type: 'teilzeit',
    weekHours: 24,
    days: [1, 2, 3],
    vac: 18,
    carry: 0,
    wage: null,
    entry: '2022-02-01',
  },
  {
    id: 'e7',
    name: 'Lena Hofbauer',
    func: 'Support',
    role: 'ma',
    leadId: 'e3',
    type: 'vollzeit',
    weekHours: 38.5,
    days: [1, 2, 3, 4, 5],
    vac: 30,
    carry: 0,
    wage: null,
    entry: '2019-06-01',
  },
  {
    id: 'e8',
    name: 'Marco Pichler',
    func: 'Support',
    role: 'ma',
    leadId: 'e3',
    type: 'teilzeit',
    weekHours: 30,
    days: [1, 2, 3, 4, 5],
    vac: 28,
    carry: 0,
    wage: null,
    entry: '2023-03-01',
  },
  {
    id: 'm1',
    name: 'Anna Kroiß',
    func: 'Büro',
    role: 'ma',
    leadId: 'e3',
    type: 'minijob',
    weekHours: 8,
    days: [2, 4],
    vac: 8,
    carry: 0,
    wage: 13.9,
    entry: '2024-05-01',
  },
  {
    id: 'm2',
    name: 'Paul Zellner',
    func: 'Softwaretests',
    role: 'ma',
    leadId: 'e2',
    type: 'minijob',
    weekHours: 5,
    days: [3],
    vac: 4,
    carry: 0,
    wage: 15,
    entry: '2025-10-01',
  },
  // Abweichung: 9 statt 10,5 Std.; 10,5 × 13/3 × 14 € = 637 € überschreiten 603 €.
  {
    id: 'm3',
    name: 'Hannelore Fuchs',
    func: 'Reinigung',
    role: 'ma',
    leadId: 'e1',
    type: 'minijob',
    weekHours: 9,
    days: [1, 3, 5],
    vac: 12,
    carry: 0,
    wage: 14,
    entry: '2022-11-01',
  },
];

const roles: Record<PrototypeEmployee['role'], Role> = {
  admin: 'ADMIN',
  lead: 'LEAD',
  ma: 'EMPLOYEE',
};
const employmentTypes: Record<PrototypeEmployee['type'], EmploymentType> = {
  vollzeit: 'FULL_TIME',
  teilzeit: 'PART_TIME',
  minijob: 'MINIJOB',
};

export const seedEmployees: readonly SeedEmployee[] = prototypeEmployees.map((employee) => {
  const localPart = employee.name
    .toLowerCase()
    .replaceAll('ä', 'ae')
    .replaceAll('ö', 'oe')
    .replaceAll('ü', 'ue')
    .replaceAll('ß', 'ss')
    .replaceAll(' ', '.');
  return {
    id: employee.id,
    name: employee.name,
    jobTitle: employee.func,
    role: roles[employee.role],
    leadId: employee.leadId,
    loginEmail: `${localPart}@example.${employee.type === 'minijob' ? 'org' : 'com'}`,
    entryDate: employee.entry,
    terms: {
      validFrom: employee.entry > '2026-01-01' ? employee.entry : '2026-01-01',
      type: employmentTypes[employee.type],
      weeklyMinutes: employee.weekHours * 60,
      workDays: employee.days,
      annualLeaveDays: employee.vac,
      extraLeaveDays: 0,
      hourlyWageCents:
        employee.type === 'minijob' && employee.wage !== null
          ? Math.round(employee.wage * 100)
          : null,
    },
    carryOver: employee.carry > 0 ? { year: 2026, days: employee.carry } : null,
  };
});

export const seedLegalParameters: readonly {
  key: LegalParameterKey;
  value: number;
  validFrom: LocalDate;
  source: string;
}[] = [
  {
    key: 'MIN_WAGE_HOURLY_CENTS',
    value: 1390,
    validFrom: '2026-01-01',
    source: 'MiLoG, Mindestlohnanpassungsverordnung',
  },
  {
    key: 'MIN_WAGE_HOURLY_CENTS',
    value: 1460,
    validFrom: '2027-01-01',
    source: 'MiLoG, Mindestlohnanpassungsverordnung',
  },
  {
    key: 'MINIJOB_MONTHLY_LIMIT_CENTS',
    value: 60300,
    validFrom: '2026-01-01',
    source: '§ 8 Abs. 1a SGB IV',
  },
  {
    key: 'MINIJOB_MONTHLY_LIMIT_CENTS',
    value: 63300,
    validFrom: '2027-01-01',
    source: '§ 8 Abs. 1a SGB IV',
  },
];
