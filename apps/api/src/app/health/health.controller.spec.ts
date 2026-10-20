import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('meldet ok', () => {
    expect(new HealthController().check()).toEqual({ status: 'ok' });
  });
});
