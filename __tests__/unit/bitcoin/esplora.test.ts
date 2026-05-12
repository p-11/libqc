import { afterEach, describe, expect, test, vi } from 'vitest';
import { EsploraBitcoinApi } from '../../../src/account/bitcoin/esplora';

describe('EsploraBitcoinApi.getTxStatus', () => {
  const api = new EsploraBitcoinApi('https://blockstream.info/api');

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('maps 404 to unconfirmed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 404,
        ok: false,
        statusText: 'Not Found'
      })
    );

    await expect(
      api.getTxStatus('a'.repeat(64) as never)
    ).resolves.toStrictEqual({ confirmed: false });
  });

  test('maps confirmed boolean from successful payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue({ confirmed: true })
      })
    );

    await expect(
      api.getTxStatus('b'.repeat(64) as never)
    ).resolves.toStrictEqual({ confirmed: true });
  });

  test('throws on non-404 HTTP errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 500,
        ok: false,
        statusText: 'Internal Server Error'
      })
    );

    await expect(api.getTxStatus('c'.repeat(64) as never)).rejects.toThrow(
      /Bitcoin API error: 500/
    );
  });
});
