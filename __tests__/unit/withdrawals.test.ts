import { AccountId, ChainId } from 'caip';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  deriveEncryptionKey,
  generateScryptSalt,
  type VaultEncryptionKeyWithMetadata
} from '../../src/cryptography';
import { getStateSegment } from '../../src/state';
import {
  applyReconciliation,
  listWithdrawalRecords,
  recordWithdrawal,
  replaceWithdrawalRecord
} from '../../src/withdrawals';
import type {
  Address,
  WithdrawalRecord,
  WithdrawalTxIdentifier
} from '../../src/types';
import {
  MockStorage,
  TEST_FAST_SCRYPT_PARAMS,
  getTestPassword
} from '../testUtils';

async function createTestKey(): Promise<VaultEncryptionKeyWithMetadata> {
  return deriveEncryptionKey(
    getTestPassword(),
    generateScryptSalt(),
    TEST_FAST_SCRYPT_PARAMS
  );
}

const evmChainId = new ChainId({ namespace: 'eip155', reference: '1' });
const btcChainId = new ChainId({
  namespace: 'bip122',
  reference: '000000000019d6689c085ae165831e93'
});
const evmAccountId = new AccountId({
  chainId: evmChainId,
  address: '0xBFe6012Fc6d41172002599e6fF7447756a6d5D0f'
});
const btcAccountId = new AccountId({
  chainId: btcChainId,
  address: 'bc1qexamplebitcoinaddress00000000000000abcd'
});

const evmTxRefs: WithdrawalTxIdentifier[] = [
  {
    chain: 'evm',
    data: {
      txHash: '0xaaaa' as `0x${string}`,
      userOpHash: '0xbbbb' as `0x${string}`,
      explorerUrl: null
    }
  }
];

const btcTxRefs: WithdrawalTxIdentifier[] = [
  {
    chain: 'bitcoin',
    data: {
      txid: 'cafef00d'.repeat(8) as never,
      explorerUrl: null
    }
  }
];

describe('applyReconciliation', () => {
  function buildRecord(
    overrides: Partial<WithdrawalRecord> = {}
  ): WithdrawalRecord {
    return {
      id: 'fixed-id',
      accountId: btcAccountId.toString(),
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      status: 'pending',
      txRefs: btcTxRefs,
      initiatedAt: 1_000,
      sentAt: null,
      completedAt: null,
      failedAt: null,
      ...overrides
    };
  }

  test('pending → sent on confirmation', () => {
    const record = buildRecord({ status: 'pending' });
    const next = applyReconciliation(record, {
      confirmed: true,
      sourceBalanceZero: false
    });
    expect(next.status).toBe('sent');
    expect(next.sentAt).toBeTypeOf('number');
    expect(next.completedAt).toBeNull();
    expect(next.failedAt).toBeNull();
  });

  test('pending → withdrawn when confirmed and source balance zero', () => {
    const record = buildRecord({ status: 'pending' });
    const next = applyReconciliation(record, {
      confirmed: true,
      sourceBalanceZero: true
    });
    expect(next.status).toBe('withdrawn');
    expect(next.sentAt).toBeTypeOf('number');
    expect(next.completedAt).toBeTypeOf('number');
  });

  test('sent → withdrawn when source balance zero', () => {
    const record = buildRecord({ status: 'sent', sentAt: 500 });
    const next = applyReconciliation(record, {
      confirmed: true,
      sourceBalanceZero: true
    });
    expect(next.status).toBe('withdrawn');
    expect(next.sentAt).toBe(500); // preserved
    expect(next.completedAt).toBeTypeOf('number');
  });

  test('pending stays pending when not confirmed', () => {
    const record = buildRecord({ status: 'pending' });
    const next = applyReconciliation(record, {
      confirmed: false,
      sourceBalanceZero: false
    });
    expect(next).toBe(record);
  });

  test('sent stays sent when source balance non-zero', () => {
    const record = buildRecord({ status: 'sent', sentAt: 500 });
    const next = applyReconciliation(record, {
      confirmed: true,
      sourceBalanceZero: false
    });
    expect(next).toBe(record);
  });

  test('explicit failure transitions to failed terminally', () => {
    const record = buildRecord({ status: 'sent', sentAt: 500 });
    const next = applyReconciliation(record, {
      confirmed: false,
      sourceBalanceZero: false,
      failed: true
    });
    expect(next.status).toBe('failed');
    expect(next.failedAt).toBeTypeOf('number');
  });

  test('terminal records are returned unchanged', () => {
    const withdrawn = buildRecord({ status: 'withdrawn', completedAt: 999 });
    expect(
      applyReconciliation(withdrawn, {
        confirmed: true,
        sourceBalanceZero: true
      })
    ).toBe(withdrawn);

    const failed = buildRecord({ status: 'failed', failedAt: 999 });
    expect(
      applyReconciliation(failed, { confirmed: true, sourceBalanceZero: true })
    ).toBe(failed);
  });
});

describe('persistence helpers', () => {
  let storage: MockStorage;
  let encryptionKey: VaultEncryptionKeyWithMetadata;

  beforeEach(async () => {
    storage = new MockStorage(new Map());
    encryptionKey = await createTestKey();
  });

  test('recordWithdrawal persists a new record with correct shape', async () => {
    const record = await recordWithdrawal(storage, encryptionKey, {
      accountId: evmAccountId,
      destinationAddress:
        '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99' as Address,
      destinationChain: evmChainId.toString(),
      txRefs: evmTxRefs,
      initialStatus: 'sent'
    });

    expect(record.id).toBeTypeOf('string');
    expect(record.id.length).toBeGreaterThan(0);
    expect(record.status).toBe('sent');
    expect(record.sentAt).toBe(record.initiatedAt);
    expect(record.completedAt).toBeNull();
    expect(record.failedAt).toBeNull();

    const persisted = await getStateSegment(
      storage,
      encryptionKey,
      'withdrawals'
    );
    expect(persisted).toEqual([record]);
  });

  test('recordWithdrawal preserves null sentAt for BTC pending start', async () => {
    const record = await recordWithdrawal(storage, encryptionKey, {
      accountId: btcAccountId,
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      txRefs: btcTxRefs,
      initialStatus: 'pending'
    });

    expect(record.status).toBe('pending');
    expect(record.sentAt).toBeNull();
  });

  test('multiple records append to the segment', async () => {
    const r1 = await recordWithdrawal(storage, encryptionKey, {
      accountId: evmAccountId,
      destinationAddress:
        '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99' as Address,
      destinationChain: evmChainId.toString(),
      txRefs: evmTxRefs,
      initialStatus: 'sent'
    });
    const r2 = await recordWithdrawal(storage, encryptionKey, {
      accountId: btcAccountId,
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      txRefs: btcTxRefs,
      initialStatus: 'pending'
    });

    const all = await listWithdrawalRecords(storage, encryptionKey);
    expect(all).toHaveLength(2);
    expect(all.map(r => r.id)).toEqual(expect.arrayContaining([r1.id, r2.id]));
  });

  test('concurrent appends keep every record', async () => {
    const [r1, r2] = await Promise.all([
      recordWithdrawal(storage, encryptionKey, {
        accountId: evmAccountId,
        destinationAddress:
          '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99' as Address,
        destinationChain: evmChainId.toString(),
        txRefs: evmTxRefs,
        initialStatus: 'sent'
      }),
      recordWithdrawal(storage, encryptionKey, {
        accountId: btcAccountId,
        destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
        destinationChain: btcChainId.toString(),
        txRefs: btcTxRefs,
        initialStatus: 'pending'
      })
    ]);

    const all = await listWithdrawalRecords(storage, encryptionKey);
    expect(all).toHaveLength(2);
    expect(all.map(r => r.id)).toEqual(expect.arrayContaining([r1.id, r2.id]));
  });

  test('listWithdrawalRecords filters by accountId', async () => {
    await recordWithdrawal(storage, encryptionKey, {
      accountId: evmAccountId,
      destinationAddress:
        '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99' as Address,
      destinationChain: evmChainId.toString(),
      txRefs: evmTxRefs,
      initialStatus: 'sent'
    });
    await recordWithdrawal(storage, encryptionKey, {
      accountId: btcAccountId,
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      txRefs: btcTxRefs,
      initialStatus: 'pending'
    });

    const evmRecords = await listWithdrawalRecords(
      storage,
      encryptionKey,
      evmAccountId
    );
    expect(evmRecords).toHaveLength(1);
    expect(evmRecords[0].accountId).toBe(evmAccountId.toString());
  });

  test('listWithdrawalRecords returns newest-first by initiatedAt', async () => {
    const dateNowSpy = vi.spyOn(Date, 'now');
    dateNowSpy.mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);

    const r1 = await recordWithdrawal(storage, encryptionKey, {
      accountId: evmAccountId,
      destinationAddress:
        '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99' as Address,
      destinationChain: evmChainId.toString(),
      txRefs: evmTxRefs,
      initialStatus: 'sent'
    });

    const r2 = await recordWithdrawal(storage, encryptionKey, {
      accountId: evmAccountId,
      destinationAddress:
        '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99' as Address,
      destinationChain: evmChainId.toString(),
      txRefs: evmTxRefs,
      initialStatus: 'sent'
    });
    dateNowSpy.mockRestore();

    const records = await listWithdrawalRecords(
      storage,
      encryptionKey,
      evmAccountId
    );
    expect(records[0].id).toBe(r2.id);
    expect(records[1].id).toBe(r1.id);
  });

  test('replaceWithdrawalRecord updates an existing record', async () => {
    const original = await recordWithdrawal(storage, encryptionKey, {
      accountId: btcAccountId,
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      txRefs: btcTxRefs,
      initialStatus: 'pending'
    });

    const updated: WithdrawalRecord = {
      ...original,
      status: 'withdrawn',
      sentAt: 1_000,
      completedAt: 2_000
    };
    await replaceWithdrawalRecord(storage, encryptionKey, updated);

    const all = await listWithdrawalRecords(storage, encryptionKey);
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(updated);
  });

  test('replaceWithdrawalRecord throws when id not found', async () => {
    const ghost: WithdrawalRecord = {
      id: 'does-not-exist',
      accountId: btcAccountId.toString(),
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      status: 'sent',
      txRefs: btcTxRefs,
      initiatedAt: 0,
      sentAt: null,
      completedAt: null,
      failedAt: null
    };
    await expect(
      replaceWithdrawalRecord(storage, encryptionKey, ghost)
    ).rejects.toThrow(/not found/);
  });

  test('reconstructor fails closed on malformed records', async () => {
    // Seed one valid and multiple malformed entries. The state boundary must
    // reject corrupted withdrawal payloads instead of silently rewriting
    // history by dropping unknown records.
    const goodRecord = await recordWithdrawal(storage, encryptionKey, {
      accountId: btcAccountId,
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      txRefs: btcTxRefs,
      initialStatus: 'pending'
    });

    const malformed = [
      { id: 'no-status' }, // missing status / accountId / etc.
      { ...goodRecord, status: 'bogus' }, // unknown lifecycle status
      { ...goodRecord, txRefs: 'not-an-array' }, // wrong shape
      null,
      'hello'
    ];

    const { setStateSegment } = await import('../../src/state');
    await setStateSegment(storage, encryptionKey, 'withdrawals', [
      goodRecord,
      ...(malformed as unknown as WithdrawalRecord[])
    ]);

    await expect(listWithdrawalRecords(storage, encryptionKey)).rejects.toThrow(
      /withdrawals segment contains invalid record/
    );
  });

  test('records survive a re-derived encryption key (restart/unlock)', async () => {
    const password = getTestPassword();
    const salt = generateScryptSalt();
    const key1 = await deriveEncryptionKey(
      password,
      salt,
      TEST_FAST_SCRYPT_PARAMS
    );

    const record = await recordWithdrawal(storage, key1, {
      accountId: btcAccountId,
      destinationAddress: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' as Address,
      destinationChain: btcChainId.toString(),
      txRefs: btcTxRefs,
      initialStatus: 'pending'
    });

    // Simulate lock/unlock: re-derive the same key from the same password+salt
    const key2 = await deriveEncryptionKey(
      password,
      salt,
      TEST_FAST_SCRYPT_PARAMS
    );

    const recovered = await listWithdrawalRecords(storage, key2);
    expect(recovered).toHaveLength(1);
    expect(recovered[0]).toEqual(record);
  });
});
