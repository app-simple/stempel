import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function host(res: { status: jest.Mock; json: jest.Mock; headersSent: boolean }): ArgumentsHost {
  return {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({}) }),
    getType: () => 'http',
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  it('protokolliert unerwartete Fehler ohne Meldung und damit ohne Nutzdaten', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), headersSent: false };
    const prismaLike = Object.assign(
      new Error('Unique constraint failed on loginEmail: erika@example.org'),
      {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
      },
    );
    new AllExceptionsFilter().catch(prismaLike, host(res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(error).toHaveBeenCalledWith('Unerwarteter Fehler: PrismaClientKnownRequestError P2002');
    expect(JSON.stringify(error.mock.calls)).not.toContain('erika@example.org');
    expect(JSON.stringify(res.json.mock.calls)).not.toContain('erika@example.org');
    error.mockRestore();
  });

  it('reicht HTTP-Fehler an Nest weiter', () => {
    const filter = new AllExceptionsFilter();
    const superCatch = jest
      .spyOn(Object.getPrototypeOf(AllExceptionsFilter.prototype), 'catch')
      .mockImplementation(() => undefined);
    filter.catch(
      new BadRequestException('x'),
      host({ status: jest.fn(), json: jest.fn(), headersSent: false }),
    );
    expect(superCatch).toHaveBeenCalled();
    superCatch.mockRestore();
  });
});
