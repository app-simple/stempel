import { ForbiddenException, UnsupportedMediaTypeException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { loadAppConfig } from '../config/app-config';
import { OriginMiddleware } from './origin.middleware';

const config = loadAppConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://u:p@localhost/db_test',
  APP_ORIGIN: 'http://localhost:4200',
  WEBAUTHN_RP_ID: 'localhost',
  AUTH_PEPPER: 'x'.repeat(32),
  SMTP_HOST: 'localhost',
  SMTP_PORT: '1025',
});
const middleware = new OriginMiddleware(config);

function request(method: string, headers: Record<string, string>, contentType?: string): Request {
  return {
    method,
    headers,
    is: (type: string) => (contentType === type ? type : false),
  } as unknown as Request;
}

describe('OriginMiddleware', () => {
  const next = jest.fn();
  beforeEach(() => next.mockClear());

  it('lässt lesende Anfragen ohne Origin durch', () => {
    middleware.use(request('GET', {}), {} as Response, next);
    expect(next).toHaveBeenCalled();
  });

  it('verlangt den eigenen Origin für zustandsändernde Anfragen', () => {
    expect(() => middleware.use(request('POST', {}), {} as Response, next)).toThrow(
      ForbiddenException,
    );
    expect(() =>
      middleware.use(request('POST', { origin: 'https://evil.example' }), {} as Response, next),
    ).toThrow(ForbiddenException);
  });

  it('verlangt JSON auch bei Bodies ohne Content-Length', () => {
    const chunked = request(
      'POST',
      { origin: 'http://localhost:4200', 'transfer-encoding': 'chunked' },
      'application/x-www-form-urlencoded',
    );
    expect(() => middleware.use(chunked, {} as Response, next)).toThrow(
      UnsupportedMediaTypeException,
    );
    const json = request(
      'POST',
      { origin: 'http://localhost:4200', 'transfer-encoding': 'chunked' },
      'application/json',
    );
    middleware.use(json, {} as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('erlaubt zustandsändernde Anfragen ohne Body', () => {
    middleware.use(
      request('POST', { origin: 'http://localhost:4200', 'content-length': '0' }),
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalled();
  });
});
