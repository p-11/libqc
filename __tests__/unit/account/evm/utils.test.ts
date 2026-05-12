import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { toBytes } from 'viem';
import { createPrivateKeyAccount } from '../../../../src/account/evm/utils';

const TEST_PRIVATE_KEY =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as const;

function createAccounts() {
  const pkBytes = toBytes(TEST_PRIVATE_KEY);
  return {
    viemAccount: privateKeyToAccount(TEST_PRIVATE_KEY),
    libqcAccount: createPrivateKeyAccount(new Uint8Array(pkBytes))
  };
}

describe('createPrivateKeyAccount', () => {
  it('matches viem privateKeyToAccount signatures for signMessage (Ethereum digest)', async () => {
    const { viemAccount, libqcAccount } = createAccounts();

    expect(libqcAccount.address).toBe(viemAccount.address);

    const message = 'hello world';
    const [sigViem, sigLibqc] = await Promise.all([
      viemAccount.signMessage({ message }),
      libqcAccount.signMessage({ message })
    ]);

    expect(sigLibqc).toBe(sigViem);
  });

  it('matches viem privateKeyToAccount signatures for sign(hash)', async () => {
    const { viemAccount, libqcAccount } = createAccounts();
    const hash = `0x${'11'.repeat(32)}` as const;

    const [sigViem, sigLibqc] = await Promise.all([
      viemAccount.sign({ hash }),
      libqcAccount.sign({ hash })
    ]);

    expect(sigLibqc).toBe(sigViem);
  });

  it('matches viem privateKeyToAccount signatures for signTransaction', async () => {
    const { viemAccount, libqcAccount } = createAccounts();
    const transaction = {
      type: 'eip1559' as const,
      chainId: 1,
      nonce: 0,
      maxFeePerGas: 1_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      gas: 21_000n,
      to: '0x000000000000000000000000000000000000dEaD',
      value: 1n,
      data: '0x'
    } as const;

    const [sigViem, sigLibqc] = await Promise.all([
      viemAccount.signTransaction(transaction),
      libqcAccount.signTransaction(transaction)
    ]);

    expect(sigLibqc).toBe(sigViem);
  });

  it('matches viem privateKeyToAccount signatures for signTypedData', async () => {
    const { viemAccount, libqcAccount } = createAccounts();
    const typedData = {
      domain: {
        name: 'Ether Mail',
        version: '1',
        chainId: 1,
        verifyingContract: '0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC'
      },
      types: {
        Person: [
          { name: 'name', type: 'string' },
          { name: 'wallet', type: 'address' }
        ],
        Mail: [
          { name: 'from', type: 'Person' },
          { name: 'to', type: 'Person' },
          { name: 'contents', type: 'string' }
        ]
      },
      primaryType: 'Mail' as const,
      message: {
        from: {
          name: 'Cow',
          wallet: '0xCD2a3d9F938E13CD947Ec05AbC7FE734Df8DD826'
        },
        to: {
          name: 'Bob',
          wallet: '0xbBbBBBBbbBBBbbbBbbBbbbbBBbBbbbbBbBbbBBbB'
        },
        contents: 'Hello, Bob!'
      }
    } as const;

    const [sigViem, sigLibqc] = await Promise.all([
      viemAccount.signTypedData(typedData),
      libqcAccount.signTypedData(typedData)
    ]);

    expect(sigLibqc).toBe(sigViem);
  });

  it('matches viem privateKeyToAccount signatures for signAuthorization', async () => {
    const { viemAccount, libqcAccount } = createAccounts();
    const authorization = {
      chainId: 1,
      nonce: 0,
      address: '0x000000000000000000000000000000000000dEaD'
    } as const;

    const [sigViem, sigLibqc] = await Promise.all([
      viemAccount.signAuthorization(authorization),
      libqcAccount.signAuthorization(authorization)
    ]);

    expect(sigLibqc).toEqual(sigViem);
  });
});
