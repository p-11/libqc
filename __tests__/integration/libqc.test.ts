import { AccountId, ChainId } from 'caip';
import { parseEther, parseUnits } from 'viem';
import { describe, expect, test, vi } from 'vitest';

// Main entry point exports
import { toChain, type ForceNewAddress, type Symbol } from '../../src';

// Internal imports (not exported from main entry point)
import { EvmAccountClient, ValidatorType } from '../../src/account';
import {
  getAssetBySymbol,
  getEntityByChainId,
  getNativeAsset
} from '../../src/assets';
import { SECP256K1_VALIDATOR_ADDRESS } from '../../src/config';
import { getLibQCState } from '../../src/state';
import {
  createTestChains,
  createTestLibQC,
  fundAccount,
  fundAccountWithErc20,
  MockStorage,
  TEST_TIMING
} from '../testUtils';

describe('LibQC', () => {
  describe('createAccount', () => {
    test('throws error if mnemonic has not been generated', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await expect(vault.createAccount(chainId)).rejects.toThrow(
        'Seed not found in storage'
      );
    });

    test('creates an account with valid CAIP-10 account ID', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      const account = await vault.createAccount(chainId);

      expect(account).toBeDefined();
      // CAIP-10 format: eip155:8453:0x...
      const accountId = account.getId();
      expect(accountId).toBeInstanceOf(AccountId);
      expect(accountId.toString()).toMatch(/^eip155:8453:0x[0-9a-fA-F]{40}$/);
    });

    test('stores account in LibQC state', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      const account = await vault.createAccount(chainId);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(1);
      expect(accounts[0].id.toString()).toBe(account.getId().toString());
      expect(accounts[0].chainId.toString()).toBe(chainId.toString());
    });

    test('reuses existing address for first account on different chains', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId1 = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '1' });
      const account1 = await vault.createAccount(chainId1);
      const account2 = await vault.createAccount(chainId2);

      // Extract addresses from CAIP-10 IDs (format: eip155:chainId:address)
      const address1 = account1.getId().address;
      const address2 = account2.getId().address;

      // Same address should be used for both chains
      expect(address1).toBe(address2);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(2);
      // Both accounts should have the same address
      expect(accounts[0].address).toBe(accounts[1].address);
    });

    test('creates new address when forceNewAddress is true', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      const account1 = await vault.createAccount(chainId);
      const account2 = await vault.createAccount(
        chainId,
        true as ForceNewAddress
      );

      // Extract addresses from CAIP-10 IDs
      const address1 = account1.getId().address;
      const address2 = account2.getId().address;

      // Different addresses should be used
      expect(address1).not.toBe(address2);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(2);
      // Accounts should have different addresses
      expect(accounts[0].address).not.toBe(accounts[1].address);
    });

    test('creates multiple accounts on same chain with different addresses', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);
      await vault.createAccount(chainId);
      await vault.createAccount(chainId);

      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(3);

      // Each account should have a different address
      const addresses = accounts.map(a => a.address);
      expect(new Set(addresses).size).toBe(3);
    });

    test('account has correct chainId', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);

      const accounts = await vault.listAccounts();
      expect(accounts[0].chainId.toString()).toBe(chainId.toString());
    });

    test('address contains secp256k1 private key in state', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      await vault.createAccount(chainId);

      // Check that the address in state has the private key
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses[0].secp256k1PrivateKey).toBeDefined();
      expect(state.addresses[0].secp256k1PrivateKey).toBeInstanceOf(Uint8Array);
      expect(state.addresses[0].secp256k1PrivateKey).toHaveLength(32);
    });

    test('creates accounts with incrementing address indices per chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId1 = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '1' });
      await vault.createAccount(chainId1);
      await vault.createAccount(chainId1);
      await vault.createAccount(chainId2);
      await vault.createAccount(chainId1);

      const accounts = await vault.listAccounts();

      // Filter by chain 8453
      const chain8453Accounts = accounts.filter(
        a => a.chainId.toString() === chainId1.toString()
      );

      expect(chain8453Accounts).toHaveLength(3);

      // Check that addresses are stored with incrementing indices in state
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses[0].index).toBe(0);
      expect(state.addresses[1].index).toBe(1);
      expect(state.addresses[2].index).toBe(2);
    });

    test('listAccounts returns empty array initially', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);

      const accounts = await vault.listAccounts();
      expect(accounts).toEqual([]);
    });

    test('getAccount returns AccountClient with correct ID', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });
      const createdAccount = await vault.createAccount(chainId);
      const retrievedAccount = await vault.getAccount(createdAccount.getId());

      expect(retrievedAccount).toBeDefined();
      expect(retrievedAccount.getId().toString()).toBe(
        createdAccount.getId().toString()
      );
    });

    test('accounts persist in storage after creation', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId1 = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '1' });
      await vault.createAccount(chainId1);
      await vault.createAccount(chainId2);

      // Check state has the addresses with accounts
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toBeDefined();
      expect(state.addresses).toHaveLength(1); // Same address reused for different chains
      expect(state.addresses[0].accounts).toHaveLength(2);
    });

    test('addresses array grows when new addresses are created', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({ namespace: 'eip155', reference: '8453' });

      await vault.createAccount(chainId);
      let state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(1);

      await vault.createAccount(chainId);
      state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(2);

      // Creating on same chain again should create new address
      await vault.createAccount(chainId);
      state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(3);
    });

    test('creating account on new chain reuses existing address when possible', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId1 = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });
      const chainId2 = new ChainId({ namespace: 'eip155', reference: '1' });

      // Create first account
      await vault.createAccount(chainId1);
      let state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(1);

      // Create account on different chain - should reuse address
      await vault.createAccount(chainId2);
      state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(1); // No new address created

      // Create second account on first chain - should create new address
      await vault.createAccount(chainId1);
      state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(2);
    });

    test('correctly assigns multi-chain accounts to shared addresses', async () => {
      const storage = new MockStorage(new Map());
      const { vault, encryptionKey } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const ethChainId = new ChainId({ namespace: 'eip155', reference: '1' });
      const baseChainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      // Create 3 ETH accounts → generates addresses 0, 1, 2
      const eth0 = await vault.createAccount(ethChainId);
      const eth1 = await vault.createAccount(ethChainId);
      const eth2 = await vault.createAccount(ethChainId);

      // Create 2 Base accounts → should reuse addresses 0 and 1 (not create new ones)
      const base0 = await vault.createAccount(baseChainId);
      const base1 = await vault.createAccount(baseChainId);

      // 5 accounts total (3 ETH + 2 Base)
      const accounts = await vault.listAccounts();
      expect(accounts).toHaveLength(5);

      // Only 3 addresses in state (shared across chains)
      const state = await getLibQCState(storage, encryptionKey);
      expect(state.addresses).toHaveLength(3);

      // Base accounts share addresses with the first two ETH accounts
      expect(base0.getId().address).toBe(eth0.getId().address);
      expect(base1.getId().address).toBe(eth1.getId().address);

      // ETH account 2 has its own address (no Base account on it)
      expect(eth2.getId().address).not.toBe(eth0.getId().address);
      expect(eth2.getId().address).not.toBe(eth1.getId().address);

      // address[0] and address[1] each have 2 accounts (ETH + Base); address[2] has 1 (ETH only)
      const sortedAddresses = [...state.addresses].sort(
        (a, b) => a.index - b.index
      );
      expect(sortedAddresses[0].accounts).toHaveLength(2);
      expect(sortedAddresses[1].accounts).toHaveLength(2);
      expect(sortedAddresses[2].accounts).toHaveLength(1);
    });

    test('throws error for unsupported chain', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const unsupportedChainId = new ChainId({
        namespace: 'eip155',
        reference: '999'
      });
      // getByChainId throws "Unknown chainId" when chain is not found
      await expect(vault.createAccount(unsupportedChainId)).rejects.toThrow(
        'Unknown chainId'
      );
    });
  });

  describe('AccountClient.getConfig', () => {
    test('returns config for newly created account', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      const account = await vault.createAccount(chainId);
      const config = await (account as EvmAccountClient).getConfig();

      expect(config).toBeDefined();
      expect(config.id).toBeDefined();
      expect(config.validatorConfig).toBeDefined();
      expect(config.validatorConfig.type).toBeDefined();
      expect(config.validatorConfig.address).toBeDefined();
    });

    test('returns config for account retrieved via getAccount', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      const createdAccount = await vault.createAccount(chainId);
      const accountId = createdAccount.getId();

      const retrievedAccount = await vault.getAccount(accountId);
      const config = await (retrievedAccount as EvmAccountClient).getConfig();

      expect(config).toBeDefined();
      expect(config.id.toString()).toBe(accountId.toString());
      expect(config.validatorConfig).toBeDefined();
    });

    test('config contains correct CAIP-10 account ID', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      const account = await vault.createAccount(chainId);
      const accountId = account.getId();
      const config = await (account as EvmAccountClient).getConfig();

      expect(config.id).toBe(accountId);
    });

    test('config contains default validator configuration for non-deployed accounts', async () => {
      const storage = new MockStorage(new Map());
      const { vault } = await createTestLibQC(storage);
      await vault.generateMnemonic(() => true);

      const chainId = new ChainId({
        namespace: 'eip155',
        reference: '8453'
      });

      const account = await vault.createAccount(chainId);
      const config = await (account as EvmAccountClient).getConfig();

      // Non-deployed accounts should return the default validator config
      expect(config.validatorConfig.type).toBe(ValidatorType.SECP256k1);
      expect(config.validatorConfig.address).toBe(SECP256K1_VALIDATOR_ADDRESS);
    });
  });

  describe('LibQC.getTotalBalance', () => {
    test(
      'returns zero balance when no accounts exist',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        // Add an ERC-20 token
        const usdcAsset = await vault.addToken('USDC' as Symbol);

        // Get aggregate balance with no accounts
        const aggregateBalance = await vault.getTotalBalance(usdcAsset);

        // Should be zero
        expect(aggregateBalance.balance).toBe(0n);
        expect(aggregateBalance.decimals).toBe(6);
        expect(aggregateBalance.symbol).toBe('USDC');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'sums native balances across multiple accounts on the same chain',
      async () => {
        const storage = new MockStorage(new Map());
        const [testChain] = createTestChains();
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '8453'
        });

        // Create first account
        const account1 = await vault.createAccount(chainId);

        // Create second account
        const account2 = await vault.createAccount(chainId);

        // Fund both accounts with ETH
        await fundAccount(account1.getId(), 1);
        await fundAccount(account2.getId(), 1);

        // Add ETH as an asset
        const ethAsset = getNativeAsset(toChain(testChain));

        // Get balances for each account (they should each have 1 ETH since we funded them)
        // The aggregate should sum both accounts and return 2 ETH
        const aggregateBalance = await vault.getTotalBalance(ethAsset);

        // Should be 2 ETH (i.e. 1 ETH from both accounts)
        expect(aggregateBalance.balance).toBe(parseEther('2'));
        expect(aggregateBalance.decimals).toBe(18);
        expect(aggregateBalance.symbol).toBe('ETH');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'sums ERC-20 balances across multiple accounts on the same chain',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '1'
        });

        // Create first account
        const account1 = await vault.createAccount(chainId);

        // Create second account
        const account2 = await vault.createAccount(chainId);

        const usdc = getAssetBySymbol('USDC' as Symbol)!;
        const usdcEntity = getEntityByChainId(usdc, chainId)!;

        // Fund both accounts with USDC
        await fundAccountWithErc20(
          usdcEntity.assetType.assetName.reference,
          account1.getId(),
          parseUnits('1', usdcEntity.decimals)
        );
        await fundAccountWithErc20(
          usdcEntity.assetType.assetName.reference,
          account2.getId(),
          parseUnits('2', usdcEntity.decimals)
        );

        // Get balance which should aggregate the balances of the two accounts
        const aggregateBalance = await vault.getTotalBalance(usdc);

        // Should be the sum of the balances of the two accounts
        expect(aggregateBalance.balance).toBe(
          parseUnits('3', usdcEntity.decimals)
        );
        expect(aggregateBalance.decimals).toBe(usdcEntity.decimals);
        expect(aggregateBalance.symbol).toBe(usdcEntity.symbol);
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'filters out accounts on chains not supported by the asset',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        // Create account on chain 8453 (Base)
        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '8453'
        });
        const account1 = await vault.createAccount(chainId);

        // Fund account
        await fundAccount(account1.getId(), 1);

        // Add USDC token (which exists on chain 1 and 8453)
        let usdcAsset = await vault.addToken('USDC' as Symbol);

        // Construct an asset that looks like USDC but doesn't exist on Base
        usdcAsset = {
          ...usdcAsset,
          entities: usdcAsset.entities.filter(
            e => e.assetType.chainId.toString() !== chainId.toString()
          )
        };

        // Get aggregate balance - should work and return 0 (no USDC balance)
        const aggregateBalance = await vault.getTotalBalance(usdcAsset);

        expect(aggregateBalance.balance).toBe(0n);
        expect(aggregateBalance.decimals).toBe(usdcAsset.decimals);
        expect(aggregateBalance.symbol).toBe(usdcAsset.symbol);
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'handles accounts on supported chains without balance',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '1'
        });

        // Create multiple accounts
        const account1 = await vault.createAccount(chainId);
        const account2 = await vault.createAccount(chainId);
        const account3 = await vault.createAccount(chainId);

        // Fund accounts with ETH (for gas) but no USDC
        await fundAccount(account1.getId(), 1);
        await fundAccount(account2.getId(), 1);
        await fundAccount(account3.getId(), 1);

        // Add USDC token
        const usdcAsset = await vault.addToken('USDC' as Symbol);

        // Get aggregate balance - all accounts are on supported chain but have no USDC balance
        // Should return 0, not throw an error
        const aggregateBalance = await vault.getTotalBalance(usdcAsset);

        expect(aggregateBalance.balance).toBe(0n);
        expect(aggregateBalance.decimals).toBe(6);
        expect(aggregateBalance.symbol).toBe('USDC');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );
  });

  describe('LibQC.getTotalBalances', () => {
    test(
      'returns empty array when no assets provided',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        // Get balances with empty array
        const balances = await vault.getTotalBalances([]);

        // Should be empty
        expect(balances).toHaveLength(0);
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'returns balances for multiple native assets across accounts',
      async () => {
        const storage = new MockStorage(new Map());
        const [testChain] = createTestChains();
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '8453'
        });

        // Create two accounts
        const account1 = await vault.createAccount(chainId);
        const account2 = await vault.createAccount(chainId);

        // Fund both accounts with ETH
        await fundAccount(account1.getId(), 1);
        await fundAccount(account2.getId(), 2);

        // Get native asset
        const ethAsset = getNativeAsset(toChain(testChain));

        // Get balances for multiple assets (same asset twice to test ordering)
        const balances = await vault.getTotalBalances([ethAsset, ethAsset]);

        // Should return 2 balance results (one for each asset in the array)
        expect(balances).toHaveLength(2);
        // Both should be the same aggregate balance (3 ETH total)
        expect(balances[0].balance).toBe(parseEther('3'));
        expect(balances[1].balance).toBe(parseEther('3'));
        expect(balances[0].decimals).toBe(18);
        expect(balances[1].decimals).toBe(18);
        expect(balances[0].symbol).toBe('ETH');
        expect(balances[1].symbol).toBe('ETH');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'returns balances for multiple ERC-20 tokens across accounts',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '1'
        });

        // Create two accounts
        const account1 = await vault.createAccount(chainId);
        const account2 = await vault.createAccount(chainId);

        // Get assets
        const usdc = getAssetBySymbol('USDC' as Symbol)!;
        const usdt = getAssetBySymbol('USDT' as Symbol)!;
        const usdcEntity = getEntityByChainId(usdc, chainId)!;
        const usdtEntity = getEntityByChainId(usdt, chainId)!;

        // Fund account1 with USDC and USDT
        await fundAccountWithErc20(
          usdcEntity.assetType.assetName.reference,
          account1.getId(),
          parseUnits('10', usdcEntity.decimals)
        );
        await fundAccountWithErc20(
          usdtEntity.assetType.assetName.reference,
          account1.getId(),
          parseUnits('5', usdtEntity.decimals)
        );

        // Fund account2 with USDC and USDT
        await fundAccountWithErc20(
          usdcEntity.assetType.assetName.reference,
          account2.getId(),
          parseUnits('20', usdcEntity.decimals)
        );
        await fundAccountWithErc20(
          usdtEntity.assetType.assetName.reference,
          account2.getId(),
          parseUnits('15', usdtEntity.decimals)
        );

        // Add tokens to vault
        await vault.addToken('USDC' as Symbol);
        await vault.addToken('USDT' as Symbol);

        // Get balances for both tokens
        const balances = await vault.getTotalBalances([usdc, usdt]);

        // Should return 2 balance results
        expect(balances).toHaveLength(2);

        // USDC balance should be 30 (10 + 20)
        expect(balances[0].balance).toBe(parseUnits('30', usdcEntity.decimals));
        expect(balances[0].decimals).toBe(usdcEntity.decimals);
        expect(balances[0].symbol).toBe('USDC');

        // USDT balance should be 20 (5 + 15)
        expect(balances[1].balance).toBe(parseUnits('20', usdtEntity.decimals));
        expect(balances[1].decimals).toBe(usdtEntity.decimals);
        expect(balances[1].symbol).toBe('USDT');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'returns balances for mixed native and ERC-20 assets',
      async () => {
        const storage = new MockStorage(new Map());
        const [, testChain] = createTestChains();
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '1'
        });

        // Create account
        const account = await vault.createAccount(chainId);

        // Fund with ETH
        await fundAccount(account.getId(), 1);

        // Get assets
        const ethAsset = getNativeAsset(toChain(testChain));
        const usdc = getAssetBySymbol('USDC' as Symbol)!;
        const usdcEntity = getEntityByChainId(usdc, chainId)!;

        // Fund with USDC
        await fundAccountWithErc20(
          usdcEntity.assetType.assetName.reference,
          account.getId(),
          parseUnits('100', usdcEntity.decimals)
        );

        // Add USDC token
        await vault.addToken('USDC' as Symbol);

        // Get balances for both native and ERC-20
        const balances = await vault.getTotalBalances([ethAsset, usdc]);

        // Should return 2 balance results
        expect(balances).toHaveLength(2);

        // ETH balance
        expect(balances[0].balance).toBe(parseEther('1'));
        expect(balances[0].decimals).toBe(18);
        expect(balances[0].symbol).toBe('ETH');

        // USDC balance
        expect(balances[1].balance).toBe(
          parseUnits('100', usdcEntity.decimals)
        );
        expect(balances[1].decimals).toBe(usdcEntity.decimals);
        expect(balances[1].symbol).toBe('USDC');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'returns zero balances for assets with no balance',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({
          namespace: 'eip155',
          reference: '1'
        });

        // Create account but don't fund it
        await vault.createAccount(chainId);

        // Get assets
        const usdc = getAssetBySymbol('USDC' as Symbol)!;
        const usdt = getAssetBySymbol('USDT' as Symbol)!;

        // Add tokens
        await vault.addToken('USDC' as Symbol);
        await vault.addToken('USDT' as Symbol);

        // Get balances - should return zero for both
        const balances = await vault.getTotalBalances([usdc, usdt]);

        // Should return 2 balance results, both zero
        expect(balances).toHaveLength(2);
        expect(balances[0].balance).toBe(0n);
        expect(balances[1].balance).toBe(0n);
        expect(balances[0].symbol).toBe('USDC');
        expect(balances[1].symbol).toBe('USDT');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'sums balances across multiple accounts for each asset',
      async () => {
        const storage = new MockStorage(new Map());
        const [testChain] = createTestChains();
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId1 = new ChainId({
          namespace: 'eip155',
          reference: '1'
        });
        const chainId8453 = new ChainId({
          namespace: 'eip155',
          reference: '8453'
        });

        // Create accounts on chain 1
        const account1Chain1 = await vault.createAccount(chainId1);
        const account2Chain1 = await vault.createAccount(chainId1);

        // Create accounts on chain 8453
        const account1Chain8453 = await vault.createAccount(chainId8453);
        const account2Chain8453 = await vault.createAccount(chainId8453);

        // Fund accounts on chain 1 with ETH
        await fundAccount(account1Chain1.getId(), 0.5);
        await fundAccount(account2Chain1.getId(), 1);

        // Fund accounts on chain 8453 with ETH
        await fundAccount(account1Chain8453.getId(), 0.25);
        await fundAccount(account2Chain8453.getId(), 0.75);

        // Get assets
        const ethAsset = getNativeAsset(toChain(testChain));
        const dai = getAssetBySymbol('DAI' as Symbol)!;
        const daiEntityChain1 = getEntityByChainId(dai, chainId1)!;
        const daiEntityChain8453 = getEntityByChainId(dai, chainId8453)!;

        // Fund accounts on chain 1 with DAI
        await fundAccountWithErc20(
          daiEntityChain1.assetType.assetName.reference,
          account1Chain1.getId(),
          parseUnits('10', daiEntityChain1.decimals)
        );
        await fundAccountWithErc20(
          daiEntityChain1.assetType.assetName.reference,
          account2Chain1.getId(),
          parseUnits('20', daiEntityChain1.decimals)
        );

        // Fund accounts on chain 8453 with DAI
        await fundAccountWithErc20(
          daiEntityChain8453.assetType.assetName.reference,
          account1Chain8453.getId(),
          parseUnits('15', daiEntityChain8453.decimals)
        );
        await fundAccountWithErc20(
          daiEntityChain8453.assetType.assetName.reference,
          account2Chain8453.getId(),
          parseUnits('25', daiEntityChain8453.decimals)
        );

        // Add DAI token
        await vault.addToken('DAI' as Symbol);

        // Get balances for both assets - should aggregate across both chains
        const balances = await vault.getTotalBalances([ethAsset, dai]);

        // Should return 2 balance results
        expect(balances).toHaveLength(2);

        // ETH should be sum of all accounts across both chains: 0.5 + 1 + 0.25 + 0.75 = 2.5
        expect(balances[0].balance).toBe(parseEther('2.5'));
        expect(balances[0].decimals).toBe(18);
        expect(balances[0].symbol).toBe('ETH');

        // DAI should be sum of all accounts across both chains: 10 + 20 + 15 + 25 = 70
        expect(balances[1].balance).toBe(
          parseUnits('70', daiEntityChain1.decimals)
        );
        expect(balances[1].decimals).toBe(daiEntityChain1.decimals);
        expect(balances[1].symbol).toBe(daiEntityChain1.symbol);
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'batches native ETH reads across 2 accounts into a single RPC call',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
        const account1 = await vault.createAccount(chainId);
        const account2 = await vault.createAccount(chainId);
        await fundAccount(account1.getId(), 1);
        await fundAccount(account2.getId(), 1);

        const ethAsset = getAssetBySymbol('ETH' as Symbol)!;

        let rpcCallCount = 0;
        const originalFetch = globalThis.fetch;
        vi.spyOn(globalThis, 'fetch').mockImplementation(
          async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes(process.env.TEST_ETH_L1_RPC_URL!)) {
              rpcCallCount++;
            }
            return originalFetch(input, init);
          }
        );

        // 2 accounts × 2 assets = 4 balance reads, batched into 1 HTTP POST
        await vault.getTotalBalances([ethAsset, ethAsset]);

        expect(rpcCallCount).toBe(1);

        vi.restoreAllMocks();
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'batches native + ERC-20 reads across 3 accounts into a single RPC call',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
        const account1 = await vault.createAccount(chainId);
        const account2 = await vault.createAccount(chainId);
        const account3 = await vault.createAccount(chainId);

        const usdc = getAssetBySymbol('USDC' as Symbol)!;
        const usdcEntity = getEntityByChainId(usdc, chainId)!;

        await Promise.all([
          fundAccount(account1.getId(), 1),
          fundAccount(account2.getId(), 2),
          fundAccount(account3.getId(), 3),
          fundAccountWithErc20(
            usdcEntity.assetType.assetName.reference,
            account1.getId(),
            parseUnits('100', usdcEntity.decimals)
          ),
          fundAccountWithErc20(
            usdcEntity.assetType.assetName.reference,
            account2.getId(),
            parseUnits('200', usdcEntity.decimals)
          ),
          fundAccountWithErc20(
            usdcEntity.assetType.assetName.reference,
            account3.getId(),
            parseUnits('300', usdcEntity.decimals)
          )
        ]);

        await vault.addToken('USDC' as Symbol);
        const ethAsset = getAssetBySymbol('ETH' as Symbol)!;
        const usdcAsset = getAssetBySymbol('USDC' as Symbol)!;

        let rpcCallCount = 0;
        const originalFetch = globalThis.fetch;
        vi.spyOn(globalThis, 'fetch').mockImplementation(
          async (input, init) => {
            const url = input instanceof Request ? input.url : String(input);
            if (url.includes(process.env.TEST_ETH_L1_RPC_URL!)) {
              rpcCallCount++;
            }
            return originalFetch(input, init);
          }
        );

        // 3 accounts × 2 assets = 6 balance reads (3 eth_getBalance + 9 readContract)
        // All batched into 1 HTTP POST by transport-level batching
        const balances = await vault.getTotalBalances([ethAsset, usdcAsset]);

        expect(rpcCallCount).toBe(1);

        // Verify correctness: values are not garbled by batching
        expect(balances[0].balance).toBe(parseEther('6')); // 1+2+3 ETH
        expect(balances[1].balance).toBe(
          parseUnits('600', usdcEntity.decimals)
        ); // 100+200+300 USDC

        vi.restoreAllMocks();
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );

    test(
      'filters out accounts on unsupported chains for each asset',
      async () => {
        const storage = new MockStorage(new Map());
        const { vault } = await createTestLibQC(storage);
        await vault.generateMnemonic(() => true);

        // Create account on chain 8453 (Base)
        const baseChainId = new ChainId({
          namespace: 'eip155',
          reference: '8453'
        });
        const account1 = await vault.createAccount(baseChainId);

        // Fund account on Base
        await fundAccount(account1.getId(), 1);

        // Add USDC token (which exists on chain 1 and 8453)
        let usdcAsset = await vault.addToken('USDC' as Symbol);

        // Mock the asset so it is NOT supported on Base for the purposes of this test
        usdcAsset = {
          ...usdcAsset,
          entities: usdcAsset.entities.filter(
            e => e.assetType.chainId.toString() !== baseChainId.toString()
          )
        };

        // Get balances - should return 0 for USDC since account is on unsupported chain
        const balances = await vault.getTotalBalances([usdcAsset]);

        expect(balances).toHaveLength(1);
        expect(balances[0].balance).toBe(0n);
        expect(balances[0].symbol).toBe('USDC');
      },
      TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
    );
  });
});
