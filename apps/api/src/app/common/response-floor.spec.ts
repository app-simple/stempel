import { performance } from 'node:perf_hooks';
import { waitForFloor } from './response-floor';

describe('waitForFloor', () => {
  it('wartet mindestens die Untergrenze', async () => {
    const start = performance.now();
    await waitForFloor(start, 60, 0);
    expect(performance.now() - start).toBeGreaterThanOrEqual(60);
  });

  it('wartet nicht, wenn die Untergrenze schon erreicht ist oder 0 ist', async () => {
    const start = performance.now() - 1000;
    const before = performance.now();
    await waitForFloor(start, 60, 0);
    await waitForFloor(performance.now(), 0);
    expect(performance.now() - before).toBeLessThan(30);
  });
});
