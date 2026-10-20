import { isPushServiceEndpoint } from './push-endpoint';

describe('isPushServiceEndpoint (Schutz vor SSRF)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QJ3abc',
    'https://wns2-db5p.notify.windows.com/w/?token=abc',
  ])('nimmt %s an', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com.example/x',
    'https://localhost/x',
    'https://127.0.0.1/x',
    'https://[::1]/x',
    'https://169.254.169.254/latest/meta-data',
    'kein-url',
    `https://fcm.googleapis.com/${'a'.repeat(1000)}`,
    42,
  ])('lehnt %s ab', (endpoint) => {
    expect(isPushServiceEndpoint(endpoint)).toBe(false);
  });
});
