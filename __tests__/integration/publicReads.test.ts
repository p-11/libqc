import { AccountId, ChainId } from 'caip';
import { describe, expect, test } from 'vitest';

// Main entry point exports
import { type EvmAddress } from '../../src';

// Internal imports (not exported from main entry point)
import {
  getErc20TokenBalanceByChain,
  getErc20TokenDetails,
  getNativeBalance
} from '../../src/publicReads';
import { createTestClients } from '../testUtils';

/**
 * Integration tests for getErc20TokenDetails
 *
 * These tests call a Tenderly Ethereum mainnet fork to verify token details
 * are read correctly from actual deployed ERC-20 contracts.
 *
 * Tests use well-known tokens on Ethereum mainnet (chainId 1).
 */
describe('getErc20TokenDetails - Integration Tests (Ethereum Mainnet Fork)', () => {
  /**
   * USDC on Ethereum Mainnet
   * Contract: 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
   */
  describe('USDC on Ethereum', () => {
    test('reads correct token details for USDC', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdcAddress
      );

      expect(tokenDetails.name).toBe('USD Coin');
      expect(tokenDetails.symbol).toBe('USDC');
      expect(tokenDetails.decimals).toBe(6);
      expect(tokenDetails.totalSupply).toBeGreaterThan(0n);
    });

    test('USDC total supply is a reasonable value', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdcAddress
      );

      // USDC on Ethereum should have a substantial total supply
      // With 6 decimals, 1 USDC = 1_000_000
      expect(tokenDetails.totalSupply).toBeGreaterThan(1_000_000n); // > 1 USDC
    });
  });

  /**
   * WETH on Ethereum Mainnet
   * Contract: 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
   */
  describe('WETH on Ethereum', () => {
    test('reads correct token details for WETH', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const wethAddress =
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        wethAddress
      );

      expect(tokenDetails.name).toBe('Wrapped Ether');
      expect(tokenDetails.symbol).toBe('WETH');
      expect(tokenDetails.decimals).toBe(18);
      expect(tokenDetails.totalSupply).toBeGreaterThan(0n);
    });
  });

  /**
   * DAI on Ethereum Mainnet
   * Contract: 0x6B175474E89094C44Da98b954EedeAC495271d0F
   */
  describe('DAI on Ethereum', () => {
    test('reads correct token details for DAI', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const daiAddress =
        '0x6B175474E89094C44Da98b954EedeAC495271d0F' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        daiAddress
      );

      expect(tokenDetails.name).toBe('Dai Stablecoin');
      expect(tokenDetails.symbol).toBe('DAI');
      expect(tokenDetails.decimals).toBe(18);
      expect(tokenDetails.totalSupply).toBeGreaterThan(0n);
    });
  });

  /**
   * USDT on Ethereum Mainnet
   * Contract: 0xdAC17F958D2ee523a2206206994597C13D831ec7
   */
  describe('USDT on Ethereum', () => {
    test('reads correct token details for USDT', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdtAddress =
        '0xdAC17F958D2ee523a2206206994597C13D831ec7' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdtAddress
      );

      expect(tokenDetails.name).toBe('Tether USD');
      expect(tokenDetails.symbol).toBe('USDT');
      expect(tokenDetails.decimals).toBe(6);
      expect(tokenDetails.totalSupply).toBeGreaterThan(0n);
    });
  });

  /**
   * Edge case: Address case sensitivity
   * EVM addresses should be case-insensitive
   */
  describe('Address normalization', () => {
    test('accepts lowercase addresses', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdcAddress =
        '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as EvmAddress; // lowercase

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdcAddress
      );

      expect(tokenDetails.symbol).toBe('USDC');
      expect(tokenDetails.decimals).toBe(6);
      expect(tokenDetails.name).toBe('USD Coin');
    });

    test('accepts mixed case checksum addresses', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress; // checksum

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdcAddress
      );

      expect(tokenDetails.symbol).toBe('USDC');
      expect(tokenDetails.decimals).toBe(6);
      expect(tokenDetails.name).toBe('USD Coin');
    });
  });

  /**
   * Different decimal precisions
   * Verifies the function correctly handles tokens with different decimals
   */
  describe('Different decimal precisions', () => {
    test('handles 6 decimal tokens (USDC)', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdcAddress
      );

      expect(tokenDetails.decimals).toBe(6);
    });

    test('handles 8 decimal tokens (WBTC)', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const wbtcAddress =
        '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        wbtcAddress
      );

      expect(tokenDetails.decimals).toBe(8);
    });

    test('handles 18 decimal tokens (DAI)', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const daiAddress =
        '0x6B175474E89094C44Da98b954EedeAC495271d0F' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        daiAddress
      );

      expect(tokenDetails.decimals).toBe(18);
    });
  });

  /**
   * Multiple tokens in parallel
   * Verifies that the function can be called concurrently
   */
  describe('Parallel token reads', () => {
    test('reads multiple tokens concurrently', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const tokens = [
        {
          address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress,
          expectedName: 'USD Coin',
          expectedSymbol: 'USDC',
          expectedDecimals: 6
        },
        {
          address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as EvmAddress,
          expectedName: 'Wrapped Ether',
          expectedSymbol: 'WETH',
          expectedDecimals: 18
        },
        {
          address: '0x6B175474E89094C44Da98b954EedeAC495271d0F' as EvmAddress,
          expectedName: 'Dai Stablecoin',
          expectedSymbol: 'DAI',
          expectedDecimals: 18
        },
        {
          address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as EvmAddress,
          expectedName: 'Wrapped BTC',
          expectedSymbol: 'WBTC',
          expectedDecimals: 8
        }
      ];

      const results = await Promise.all(
        tokens.map(token =>
          getErc20TokenDetails(
            clients.getByChainId(ethereumChainId),
            token.address
          )
        )
      );

      tokens.forEach((token, index) => {
        expect(results[index].name).toBe(token.expectedName);
        expect(results[index].symbol).toBe(token.expectedSymbol);
        expect(results[index].decimals).toBe(token.expectedDecimals);
        expect(results[index].totalSupply).toBeGreaterThan(0n);
      });
    });

    test('parallel reads return independent results', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;
      const daiAddress =
        '0x6B175474E89094C44Da98b954EedeAC495271d0F' as EvmAddress;

      const [usdc, dai] = await Promise.all([
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          usdcAddress
        ),
        getErc20TokenDetails(clients.getByChainId(ethereumChainId), daiAddress)
      ]);

      // Verify they're different tokens
      expect(usdc.symbol).not.toBe(dai.symbol);
      expect(usdc.decimals).not.toBe(dai.decimals);
      expect(usdc.totalSupply).not.toBe(dai.totalSupply);

      // Verify expected values
      expect(usdc.symbol).toBe('USDC');
      expect(usdc.decimals).toBe(6);
      expect(dai.symbol).toBe('DAI');
      expect(dai.decimals).toBe(18);
    });
  });

  /**
   * All fields populated
   * Verifies that all TokenDetails fields are present and valid
   */
  describe('Complete token details', () => {
    test('returns all required fields for USDC', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });
      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      const tokenDetails = await getErc20TokenDetails(
        clients.getByChainId(ethereumChainId),
        usdcAddress
      );

      // All fields should be defined
      expect(tokenDetails.name).toBeDefined();
      expect(tokenDetails.symbol).toBeDefined();
      expect(tokenDetails.decimals).toBeDefined();
      expect(tokenDetails.totalSupply).toBeDefined();

      // Fields should have correct types
      expect(typeof tokenDetails.name).toBe('string');
      expect(typeof tokenDetails.symbol).toBe('string');
      expect(typeof tokenDetails.decimals).toBe('number');
      expect(typeof tokenDetails.totalSupply).toBe('bigint');

      // Fields should not be empty/zero
      expect(tokenDetails.name.length).toBeGreaterThan(0);
      expect(tokenDetails.symbol.length).toBeGreaterThan(0);
      expect(tokenDetails.decimals).toBeGreaterThan(0);
      expect(tokenDetails.totalSupply).toBeGreaterThan(0n);
    });
  });
});

/**
 * Integration tests for getNativeBalance
 *
 * These tests call a Tenderly Ethereum mainnet fork to verify native balance
 * reads work correctly.
 */
describe('getNativeBalance - Integration Tests (Ethereum Mainnet Fork)', () => {
  describe('Valid accounts', () => {
    test('reads native balance for a known address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Vitalik's address - known to have ETH balance
      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      });

      const balance = await getNativeBalance(
        clients.getByChainId(ethereumChainId),
        accountId
      );

      expect(balance.balance).toBeDefined();
      expect(typeof balance.balance).toBe('bigint');
      expect(balance.decimals).toBe(18);
      expect(balance.symbol).toBe('ETH');
    });

    test('returns correct native currency for chain', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0x0000000000000000000000000000000000000000'
      });

      const balance = await getNativeBalance(
        clients.getByChainId(ethereumChainId),
        accountId
      );

      // Should return ETH details even for zero balance
      expect(balance.decimals).toBe(18);
      expect(balance.symbol).toBe('ETH');
      expect(balance.balance).toBeDefined();
    });
  });

  describe('Error handling', () => {
    test('throws on invalid address format', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xInvalidAddress'
      });

      await expect(
        getNativeBalance(clients.getByChainId(ethereumChainId), accountId)
      ).rejects.toThrow();
    });

    test('throws on empty address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: ''
      });

      await expect(
        getNativeBalance(clients.getByChainId(ethereumChainId), accountId)
      ).rejects.toThrow();
    });
  });
});

/**
 * Integration tests for getErc20TokenBalanceByChain
 *
 * These tests call a Tenderly Ethereum mainnet fork to verify token balance
 * reads work correctly.
 */
describe('getErc20TokenBalanceByChain - Integration Tests (Ethereum Mainnet Fork)', () => {
  describe('Valid token balances', () => {
    test('reads USDC balance for an address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Binance hot wallet - known to hold USDC
      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0x47ac0Fb4F2D84898e4D9E7b4DaB3C24507a6D503'
      });

      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      const balance = await getErc20TokenBalanceByChain(
        clients.getByChainId(ethereumChainId),
        accountId,
        usdcAddress
      );

      expect(balance.balance).toBeDefined();
      expect(typeof balance.balance).toBe('bigint');
      expect(balance.decimals).toBe(6);
      expect(balance.symbol).toBe('USDC');
    });

    test('reads WETH balance', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Use any address
      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      });

      const wethAddress =
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as EvmAddress;

      const balance = await getErc20TokenBalanceByChain(
        clients.getByChainId(ethereumChainId),
        accountId,
        wethAddress
      );

      expect(balance.balance).toBeDefined();
      expect(typeof balance.balance).toBe('bigint');
      expect(balance.decimals).toBe(18);
      expect(balance.symbol).toBe('WETH');
    });

    test('handles addresses with any balance (including zero)', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Use a random address - balance doesn't matter, just testing it works
      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0x0000000000000000000000000000000000000001'
      });

      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      const balance = await getErc20TokenBalanceByChain(
        clients.getByChainId(ethereumChainId),
        accountId,
        usdcAddress
      );

      // Just verify the function returns valid data
      expect(balance.balance).toBeDefined();
      expect(typeof balance.balance).toBe('bigint');
      expect(balance.balance).toBeGreaterThanOrEqual(0n);
      expect(balance.decimals).toBe(6);
      expect(balance.symbol).toBe('USDC');
    });
  });

  describe('Error handling', () => {
    test('throws on invalid token address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      });

      const invalidTokenAddress = '0xInvalidToken' as EvmAddress;

      await expect(
        getErc20TokenBalanceByChain(
          clients.getByChainId(ethereumChainId),
          accountId,
          invalidTokenAddress
        )
      ).rejects.toThrow();
    });

    test('throws on invalid account address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xInvalidAddress'
      });

      const usdcAddress =
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as EvmAddress;

      await expect(
        getErc20TokenBalanceByChain(
          clients.getByChainId(ethereumChainId),
          accountId,
          usdcAddress
        )
      ).rejects.toThrow();
    });

    test('throws when token address is an EOA', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      });

      // Vitalik's address as token (EOA, not a contract)
      const eoaTokenAddress =
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as EvmAddress;

      await expect(
        getErc20TokenBalanceByChain(
          clients.getByChainId(ethereumChainId),
          accountId,
          eoaTokenAddress
        )
      ).rejects.toThrow();
    });

    test('throws when token address is not an ERC-20 contract', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      const accountId = new AccountId({
        chainId: ethereumChainId,
        address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
      });

      // ENS Registry - not an ERC-20
      const nonErc20Address =
        '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as EvmAddress;

      await expect(
        getErc20TokenBalanceByChain(
          clients.getByChainId(ethereumChainId),
          accountId,
          nonErc20Address
        )
      ).rejects.toThrow();
    });
  });
});

/**
 * Error handling and failure scenarios
 *
 * These tests verify that the function handles error cases correctly:
 * - Invalid addresses
 * - Non-contract addresses (EOAs)
 * - Contracts that don't implement ERC-20
 * - Network failures
 */
describe('getErc20TokenDetails - Error Handling (Ethereum Mainnet Fork)', () => {
  /**
   * Invalid addresses
   * Should throw when given malformed addresses
   */
  describe('Invalid addresses', () => {
    test('throws on invalid address format', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Invalid hex string
      const invalidAddress = '0xInvalidAddress' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          invalidAddress
        )
      ).rejects.toThrow();
    });

    test('throws on empty address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Empty string
      const emptyAddress = '' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          emptyAddress
        )
      ).rejects.toThrow();
    });

    test('throws on address with wrong length', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Too short
      const shortAddress = '0x1234' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          shortAddress
        )
      ).rejects.toThrow();
    });
  });

  /**
   * Non-contract addresses (EOAs)
   * Should fail when trying to call contract methods on an EOA
   */
  describe('Externally Owned Accounts (EOAs)', () => {
    test('throws when address is an EOA, not a contract', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Vitalik's address - a well-known EOA
      const eoaAddress =
        '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' as EvmAddress;

      await expect(
        getErc20TokenDetails(clients.getByChainId(ethereumChainId), eoaAddress)
      ).rejects.toThrow();
    });

    test('throws when address is the zero address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Zero address
      const zeroAddress =
        '0x0000000000000000000000000000000000000000' as EvmAddress;

      await expect(
        getErc20TokenDetails(clients.getByChainId(ethereumChainId), zeroAddress)
      ).rejects.toThrow();
    });
  });

  /**
   * Non-ERC-20 contracts
   * Should fail when the contract doesn't implement ERC-20 interface
   */
  describe('Non-ERC-20 contracts', () => {
    test('throws when contract does not implement ERC-20 (ENS Registry)', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // ENS Registry contract - does NOT implement ERC-20
      const ensRegistryAddress =
        '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          ensRegistryAddress
        )
      ).rejects.toThrow();
    });

    test('throws when contract does not implement ERC-20 (WETH9 Deposit)', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Uniswap V2 Router - has some similar functions but is NOT an ERC-20
      const uniswapRouter =
        '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          uniswapRouter
        )
      ).rejects.toThrow();
    });
  });

  /**
   * Non-existent contract
   * Should fail when the address has no deployed contract
   */
  describe('Non-existent contracts', () => {
    test('throws when contract does not exist at address', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Random address with no deployed contract
      // Using a valid format but non-existent contract
      const nonExistentAddress =
        '0x0000000000000000000000000000000000000001' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          nonExistentAddress
        )
      ).rejects.toThrow();
    });

    test('throws when using a CREATE2 address with no deployment', async () => {
      const clients = createTestClients();
      const ethereumChainId = new ChainId({
        namespace: 'eip155',
        reference: '1'
      });

      // Valid looking address but no contract deployed there
      const undeployedAddress =
        '0xDeaDbeefdEAdbeefdEadbEEFdeadbeEFdEaDbeeF' as EvmAddress;

      await expect(
        getErc20TokenDetails(
          clients.getByChainId(ethereumChainId),
          undeployedAddress
        )
      ).rejects.toThrow();
    });
  });
});
