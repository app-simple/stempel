import { employeeScope, scopedEmployee } from './employee-scope';

describe('employeeScope', () => {
  it('lässt den Admin alles sehen', () => {
    expect(employeeScope({ id: 'a', role: 'ADMIN' })).toEqual({});
  });

  it('beschränkt Vorgesetzte auf sich und das direkte Team', () => {
    expect(employeeScope({ id: 'l', role: 'LEAD' })).toEqual({
      OR: [{ id: 'l' }, { leadId: 'l' }],
    });
  });

  it('beschränkt Mitarbeiter auf sich selbst', () => {
    expect(employeeScope({ id: 'e', role: 'EMPLOYEE' })).toEqual({ id: 'e' });
  });

  it('kombiniert Bereich und gesuchte Person', () => {
    expect(scopedEmployee({ id: 'e', role: 'EMPLOYEE' }, 'x')).toEqual({
      AND: [{ id: 'e' }, { id: 'x' }],
    });
  });
});
