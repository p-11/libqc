import { AccountId } from 'caip';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InsufficientNativeBalanceForGasError,
  InvalidDestinationAddressError,
  NoWithdrawableAssetsError,
  type Symbol
} from '../../../src';
import { EvmAccountClient } from '../../../src/account/evm';
import { getAssetBySymbol, getNativeAsset } from '../../../src/assets';
import { createTypedChain } from '../../testUtils';
import * as withdrawalsModule from '../../../src/withdrawals';

const chain = createTypedChain({
  chainId: 1,
  name: 'Ethereum',
  network: 'mainnet',
  iconUrl: 'https://example.com/eth.png',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  testnet: false,
  rpcUrls: ['https://eth.example.org']
});
const accountId = new AccountId({
  chainId: chain.chainId,
  address: '0xBFe6012Fc6d41172002599e6fF7447756a6d5D0f'
});
const destinationAddress = '0xd3406f0cd5B8E2a78d151dE82d597bB2a63fDa99';
const nativeAsset = getNativeAsset(chain);
const usdcAsset = getAssetBySymbol('USDC' as Symbol);

if (!usdcAsset) {
  throw new Error('USDC test asset not found');
}

describe('EvmAccountClient.emptyVault', () => {
  let accountClient: EvmAccountClient;

  function mockAccountClient(
    overrides: Partial<EvmAccountClient> & Record<string, unknown> = {}
  ): EvmAccountClient {
    return Object.assign(Object.create(EvmAccountClient.prototype), {
      getId: () => accountId,
      ...overrides
    }) as EvmAccountClient;
  }

  beforeEach(() => {
    accountClient = mockAccountClient({});
    // emptyVault persists a WithdrawalRecord (ENG-1791); bypass it here since
    // these tests construct clients without real storage/encryption.
    vi.spyOn(withdrawalsModule, 'recordWithdrawal').mockResolvedValue(
      {} as never
    );
  });

  it('withdraws ERC-20 assets first and native asset last', async () => {
    const erc20TxIdentifier = {
      txHash: '0xabc' as `0x${string}`,
      userOpHash: '0xdef' as `0x${string}`,
      explorerUrl: null
    };
    const nativeTxIdentifier = {
      txHash: '0x123' as `0x${string}`,
      userOpHash: '0x456' as `0x${string}`,
      explorerUrl: null
    };
    const sendTransfer = vi
      .fn()
      .mockResolvedValueOnce({ txIdentifier: erc20TxIdentifier })
      .mockResolvedValueOnce({ txIdentifier: nativeTxIdentifier });
    const getBalances = vi
      .fn()
      // First call: initial snapshot with all assets
      .mockResolvedValueOnce([
        { balance: 5_000_000n, decimals: 6, symbol: usdcAsset.symbol },
        {
          balance: 1_000_000_000_000_000_000n,
          decimals: 18,
          symbol: nativeAsset.symbol
        }
      ])
      // Second call: live native balance after ERC-20 gas consumption
      .mockResolvedValueOnce([
        {
          balance: 999_000_000_000_000_000n,
          decimals: 18,
          symbol: nativeAsset.symbol
        }
      ]);

    accountClient = mockAccountClient({
      listAssets: vi.fn().mockResolvedValue([usdcAsset, nativeAsset]),
      getBalances,
      getTransferGasCostEstimate: vi.fn().mockResolvedValue({
        callGasLimit: 50_000n,
        preVerificationGas: 21_000n,
        verificationGasLimit: 100_000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      }),
      sendTransfer
    });

    const recordSpy = vi.spyOn(withdrawalsModule, 'recordWithdrawal');

    const result = await accountClient.emptyVault(destinationAddress);

    // ENG-1791: a 'sent' lifecycle record is persisted before returning.
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const recordInput = recordSpy.mock.calls[0][2];
    expect(recordInput).toMatchObject({
      accountId,
      initialStatus: 'sent',
      destinationAddress,
      destinationChain: chain.chainId.toString()
    });
    expect(recordInput.txRefs).toEqual(result.txIdentifiers);

    expect(sendTransfer).toHaveBeenCalledTimes(2);
    expect(sendTransfer.mock.calls[0]).toEqual([
      5_000_000n,
      destinationAddress,
      usdcAsset
    ]);
    expect(sendTransfer.mock.calls[1]).toEqual([
      998_999_829_000_000_000n,
      destinationAddress,
      undefined,
      {
        callGasLimit: 50_000n,
        preVerificationGas: 21_000n,
        verificationGasLimit: 100_000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      }
    ]);
    expect(result).toEqual({
      accountId: accountId.toString(),
      destinationAddress,
      destinationChain: accountId.chainId.toString(),
      transferredAssetCount: 2,
      transferredNativeAsset: true,
      status: 'sent',
      txIdentifiers: [
        { chain: 'evm', data: erc20TxIdentifier },
        { chain: 'evm', data: nativeTxIdentifier }
      ]
    });
  });

  it('still returns success when lifecycle persistence fails after transfers', async () => {
    const erc20TxIdentifier = {
      txHash: '0xabc' as `0x${string}`,
      userOpHash: '0xdef' as `0x${string}`,
      explorerUrl: null
    };
    const nativeTxIdentifier = {
      txHash: '0x123' as `0x${string}`,
      userOpHash: '0x456' as `0x${string}`,
      explorerUrl: null
    };
    const sendTransfer = vi
      .fn()
      .mockResolvedValueOnce({ txIdentifier: erc20TxIdentifier })
      .mockResolvedValueOnce({ txIdentifier: nativeTxIdentifier });
    vi.spyOn(withdrawalsModule, 'recordWithdrawal').mockRejectedValue(
      new Error('storage unavailable')
    );

    accountClient = mockAccountClient({
      listAssets: vi.fn().mockResolvedValue([usdcAsset, nativeAsset]),
      getBalances: vi
        .fn()
        .mockResolvedValueOnce([
          { balance: 5_000_000n, decimals: 6, symbol: usdcAsset.symbol },
          {
            balance: 1_000_000_000_000_000_000n,
            decimals: 18,
            symbol: nativeAsset.symbol
          }
        ])
        .mockResolvedValueOnce([
          {
            balance: 999_000_000_000_000_000n,
            decimals: 18,
            symbol: nativeAsset.symbol
          }
        ]),
      getTransferGasCostEstimate: vi.fn().mockResolvedValue({
        callGasLimit: 50_000n,
        preVerificationGas: 21_000n,
        verificationGasLimit: 100_000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      }),
      sendTransfer
    });

    const result = await accountClient.emptyVault(destinationAddress);

    expect(sendTransfer).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('sent');
    expect(result.txIdentifiers).toHaveLength(2);
  });

  it('throws a clear error for an invalid destination address', async () => {
    await expect(
      accountClient.emptyVault('not-an-address')
    ).rejects.toBeInstanceOf(InvalidDestinationAddressError);
  });

  it('throws a clear error when no withdrawable assets have positive balances', async () => {
    accountClient = mockAccountClient({
      listAssets: vi.fn().mockResolvedValue([nativeAsset]),
      getBalances: vi
        .fn()
        .mockResolvedValue([
          { balance: 0n, decimals: 18, symbol: nativeAsset.symbol }
        ])
    });

    await expect(
      accountClient.emptyVault(destinationAddress)
    ).rejects.toBeInstanceOf(NoWithdrawableAssetsError);
  });

  it('throws NoWithdrawableAssetsError when snapshot balance was positive but live balance dropped to zero', async () => {
    // Snapshot shows native balance > 0 (passes hasWithdrawableBalance check),
    // but live balance is 0 by the time we re-fetch — no transfers fire and
    // txIdentifiers ends up empty.
    accountClient = mockAccountClient({
      listAssets: vi.fn().mockResolvedValue([nativeAsset]),
      getBalances: vi
        .fn()
        .mockResolvedValueOnce([
          {
            balance: 1_000_000_000_000_000_000n,
            decimals: 18,
            symbol: nativeAsset.symbol
          }
        ])
        .mockResolvedValueOnce([
          { balance: 0n, decimals: 18, symbol: nativeAsset.symbol }
        ])
    });

    await expect(
      accountClient.emptyVault(destinationAddress)
    ).rejects.toBeInstanceOf(NoWithdrawableAssetsError);
  });

  it('throws when native balance is too small to cover gas', async () => {
    const sendTransfer = vi.fn().mockResolvedValue({
      txIdentifier: {
        txHash: '0xabc' as `0x${string}`,
        userOpHash: '0xdef' as `0x${string}`,
        explorerUrl: null
      }
    });
    accountClient = mockAccountClient({
      listAssets: vi.fn().mockResolvedValue([nativeAsset]),
      getBalances: vi.fn().mockResolvedValue([
        // Tiny balance — less than the gas cost
        { balance: 100n, decimals: 18, symbol: nativeAsset.symbol }
      ]),
      getTransferGasCostEstimate: vi.fn().mockResolvedValue({
        callGasLimit: 50_000n,
        preVerificationGas: 21_000n,
        verificationGasLimit: 100_000n,
        maxFeePerGas: 1_000_000n,
        maxPriorityFeePerGas: 500_000n
      }),
      sendTransfer
    });

    await expect(
      accountClient.emptyVault(destinationAddress)
    ).rejects.toBeInstanceOf(InsufficientNativeBalanceForGasError);
    expect(sendTransfer).not.toHaveBeenCalled();
  });
});

describe('EvmAccountClient.reconcileWithdrawalRecord', () => {
  function buildSentRecord() {
    return {
      id: 'evm-rec-1',
      accountId: accountId.toString(),
      destinationAddress: destinationAddress as any,
      destinationChain: chain.chainId.toString(),
      status: 'sent' as const,
      txRefs: [
        {
          chain: 'evm' as const,
          data: {
            txHash: '0xabc' as `0x${string}`,
            userOpHash: '0xdef' as `0x${string}`,
            explorerUrl: null
          }
        }
      ],
      initiatedAt: 100,
      sentAt: 200,
      completedAt: null,
      failedAt: null
    };
  }

  function clientWithBalances(
    balances: { balance: bigint; decimals: number; symbol: any }[]
  ): EvmAccountClient {
    return Object.assign(Object.create(EvmAccountClient.prototype), {
      getId: () => accountId,
      listAssets: vi.fn().mockResolvedValue([usdcAsset, nativeAsset]),
      getBalances: vi.fn().mockResolvedValue(balances)
    }) as EvmAccountClient;
  }

  it('advances sent → withdrawn when all balances are zero', async () => {
    const client = clientWithBalances([
      { balance: 0n, decimals: 6, symbol: usdcAsset.symbol },
      { balance: 0n, decimals: 18, symbol: nativeAsset.symbol }
    ]);
    const next = await client.reconcileWithdrawalRecord(buildSentRecord());
    expect(next.status).toBe('withdrawn');
    expect(next.completedAt).toBeTypeOf('number');
  });

  it('keeps sent when residual balance remains on any asset', async () => {
    const client = clientWithBalances([
      { balance: 0n, decimals: 6, symbol: usdcAsset.symbol },
      { balance: 1n, decimals: 18, symbol: nativeAsset.symbol }
    ]);
    const next = await client.reconcileWithdrawalRecord(buildSentRecord());
    expect(next.status).toBe('sent');
    expect(next.completedAt).toBeNull();
  });

  it('returns terminal records unchanged', async () => {
    const client = clientWithBalances([]);
    const withdrawn = { ...buildSentRecord(), status: 'withdrawn' as const };
    const next = await client.reconcileWithdrawalRecord(withdrawn);
    expect(next).toBe(withdrawn);
  });
});
