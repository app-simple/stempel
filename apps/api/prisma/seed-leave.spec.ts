import type { Prisma } from '../src/generated/prisma/client';
import { seedEmployees } from './seed-data';
import { seedLeaveRequests } from './seed-leave';

type Request = Prisma.LeaveRequestUncheckedCreateInput;
const employeeIds = new Map(seedEmployees.map((employee) => [employee.id, `db-${employee.id}`]));

async function generate(ids: ReadonlyMap<string, string> = employeeIds): Promise<Request[]> {
  const requests: Request[] = [];
  await seedLeaveRequests(
    {
      leaveRequest: {
        create: async ({ data }: { data: Request }) => {
          requests.push(data);
        },
      },
    },
    ids,
  );
  return requests;
}

describe('Seed-Urlaubsanträge ohne Datenbank', () => {
  afterEach(() => jest.restoreAllMocks());

  it('übernimmt alle 20 Zeiträume und Status aus dem Prototyp mit den gezählten halben Tagen', async () => {
    const requests = await generate();
    expect(
      requests.map((request) => [
        request.employeeId,
        (request.from as Date).toISOString().slice(0, 10),
        (request.to as Date).toISOString().slice(0, 10),
        request.status,
        request.halfDays,
      ]),
    ).toEqual([
      ['db-e1', '2026-08-10', '2026-08-21', 'APPROVED', 20],
      ['db-e1', '2026-12-23', '2026-12-31', 'APPROVED', 12],
      ['db-e2', '2026-07-27', '2026-08-07', 'APPROVED', 20],
      ['db-e2', '2026-11-02', '2026-11-06', 'APPROVED', 10],
      ['db-e3', '2026-06-08', '2026-06-19', 'APPROVED', 20],
      ['db-e3', '2026-10-26', '2026-10-30', 'PENDING', 10],
      ['db-e4', '2026-08-03', '2026-08-14', 'APPROVED', 20],
      ['db-e4', '2026-10-19', '2026-10-23', 'APPROVED', 10],
      ['db-e4', '2026-12-21', '2026-12-31', 'PENDING', 16],
      ['db-e5', '2026-05-18', '2026-05-29', 'APPROVED', 18],
      ['db-e5', '2026-09-07', '2026-09-11', 'APPROVED', 10],
      ['db-e5', '2026-11-02', '2026-11-06', 'PENDING', 10],
      ['db-e6', '2026-08-17', '2026-08-26', 'APPROVED', 12],
      ['db-e6', '2026-10-12', '2026-10-14', 'APPROVED', 6],
      ['db-e7', '2026-07-06', '2026-07-17', 'APPROVED', 20],
      ['db-e7', '2026-10-28', '2026-10-30', 'REJECTED', 6],
      ['db-e8', '2026-04-07', '2026-04-10', 'APPROVED', 8],
      ['db-e8', '2026-10-26', '2026-10-30', 'APPROVED', 10],
      ['db-m1', '2026-08-04', '2026-08-13', 'APPROVED', 8],
      ['db-m3', '2026-12-21', '2026-12-30', 'PENDING', 8],
    ]);
    expect(requests.filter((request) => request.status === 'APPROVED')).toHaveLength(15);
    expect(requests.filter((request) => request.status === 'REJECTED')).toHaveLength(1);
    expect(
      requests
        .filter((request) => request.status === 'PENDING')
        .map((request) => request.employeeId),
    ).toEqual(['db-e3', 'db-e4', 'db-e5', 'db-m3']);
    for (const request of requests) {
      expect(request).toMatchObject({
        type: 'VACATION',
        startHalf: false,
        endHalf: false,
        requestedById: request.employeeId,
      });
    }
  });

  it('setzt created bzw. 40 Tage vor Beginn auf 09:00 Berliner Zeit, auch im Winter', async () => {
    const requests = await generate();
    expect(requests.map((request) => (request.requestedAt as Date).toISOString())).toEqual(
      [
        '2026-07-01T07:00:00Z',
        '2026-11-13T08:00:00Z',
        '2026-06-17T07:00:00Z',
        '2026-09-23T07:00:00Z',
        '2026-04-29T07:00:00Z',
        '2026-10-08T07:00:00Z',
        '2026-06-24T07:00:00Z',
        '2026-09-09T07:00:00Z',
        '2026-10-09T07:00:00Z',
        '2026-04-08T07:00:00Z',
        '2026-07-29T07:00:00Z',
        '2026-10-05T07:00:00Z',
        '2026-07-08T07:00:00Z',
        '2026-09-02T07:00:00Z',
        '2026-05-27T07:00:00Z',
        '2026-10-01T07:00:00Z',
        '2026-02-26T08:00:00Z',
        '2026-09-16T07:00:00Z',
        '2026-06-25T07:00:00Z',
        '2026-10-10T07:00:00Z',
      ].map((instant) => new Date(instant).toISOString()),
    );
  });

  it('lässt offene Anträge unentschieden und ordnet Entscheidungen den Vorgesetzten zu', async () => {
    const requests = await generate();
    const deciders: Record<string, string> = {
      'db-e1': 'db-e1',
      'db-e2': 'db-e1',
      'db-e3': 'db-e1',
      'db-e4': 'db-e2',
      'db-e5': 'db-e2',
      'db-e6': 'db-e2',
      'db-e7': 'db-e3',
      'db-e8': 'db-e3',
      'db-m1': 'db-e3',
      'db-m3': 'db-e1',
    };
    for (const request of requests) {
      if (request.status === 'PENDING') {
        expect(request.decidedById).toBeNull();
        expect(request.decidedAt).toBeNull();
      } else {
        expect(request.decidedById).toBe(deciders[request.employeeId]);
        expect(
          (request.decidedAt as Date).getTime() - (request.requestedAt as Date).getTime(),
        ).toBe(2 * 86_400_000);
      }
    }
  });

  it('übernimmt die Notizen und die Ablehnungsbegründung unverändert', async () => {
    const requests = await generate();
    expect(
      requests
        .filter((request) => request.note)
        .map((request) => [request.employeeId, request.note]),
    ).toEqual([
      ['db-e3', 'Herbstferien'],
      ['db-e4', 'Zwischen den Jahren'],
      ['db-e5', 'Familienbesuch'],
    ]);
    expect(requests.filter((request) => request.decisionReason)).toEqual([
      expect.objectContaining({
        employeeId: 'db-e7',
        status: 'REJECTED',
        decisionReason:
          'In dieser Woche fehlt bereits ein Kollege im Support, die Erreichbarkeit wäre nicht gesichert.',
      }),
    ]);
  });

  it('erzeugt keine sich überschneidenden Zeiträume je Person', async () => {
    const requests = await generate();
    for (const [index, request] of requests.entries()) {
      for (const other of requests.slice(index + 1)) {
        if (request.employeeId !== other.employeeId) continue;
        expect(
          (request.to as Date) < (other.from as Date) ||
            (other.to as Date) < (request.from as Date),
        ).toBe(true);
      }
    }
  });

  it('liest die Arbeitstage aus dem Vertragsstand statt eine Fünftagewoche anzunehmen', async () => {
    const employee = seedEmployees.find((candidate) => candidate.id === 'e1');
    if (!employee) throw new Error('Seed-Testdaten fehlen.');
    jest.replaceProperty(employee.terms, 'workDays', [3]);
    const requests = await generate();
    expect(
      requests
        .filter((request) => request.employeeId === 'db-e1')
        .map((request) => request.halfDays),
    ).toEqual([4, 4]);
  });

  it('bricht bei fehlender Mitarbeiterreferenz ab', async () => {
    await expect(generate(new Map())).rejects.toThrow('Mitarbeiterreferenz fehlt');
  });
});
