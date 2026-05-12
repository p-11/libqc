import { ChainId } from 'caip';
import {
  createPublicClient,
  getAddress,
  http,
  parseEther,
  parseUnits
} from 'viem';
import { describe, expect, it } from 'vitest';
import { toChain, type Symbol } from '../../src';
import type { EvmAccountClient } from '../../src/account';
import { getEntityByChainId } from '../../src/assets';
import {
  captureGeneratedMnemonic,
  MockStorage,
  TEST_TIMING,
  createTestChains,
  createTestLibQC,
  fundAccount,
  fundAccountWithErc20
} from '../testUtils';

const ETH_CHAIN_ID = new ChainId({ namespace: 'eip155', reference: '1' });
const SWEEP_COUNT = 3;
// Tenderly gas prices are near-zero, residual observed ~200_000 wei, ~5x safety margin
const SWEPT_ACCOUNT_DUST_THRESHOLD = 1_000_000n;

describe('emptyVault integration', () => {
  it(
    'sweeps ETH and ERC-20 across fresh addresses, each swept address ends empty',
    async () => {
      const storage = new MockStorage(new Map());
      const chains = createTestChains().filter(
        c => c.chainId.toString() === ETH_CHAIN_ID.toString()
      );
      const { vault } = await createTestLibQC(storage, chains);
      await captureGeneratedMnemonic(vault);

      const usdcAsset = await vault.addToken('USDC' as Symbol);
      const usdcEntity = getEntityByChainId(usdcAsset, ETH_CHAIN_ID);
      if (!usdcEntity) throw new Error('USDC entity not found for Ethereum');
      const usdcAddress = usdcEntity.assetType.assetName.reference;
      const usdcAmount = parseUnits('100', usdcEntity.decimals);

      const firstAccount = (await vault.createAccount(
        ETH_CHAIN_ID
      )) as EvmAccountClient;
      await fundAccount(firstAccount.getId(), 1);
      await fundAccountWithErc20(usdcAddress, firstAccount.getId(), usdcAmount);

      const publicClient = createPublicClient({
        chain: toChain(chains[0]),
        transport: http(chains[0].rpcUrls[0])
      });

      // Create all destination accounts up front so addresses are known before sweeping
      const allClients: EvmAccountClient[] = [firstAccount];
      for (const _ of Array.from({ length: SWEEP_COUNT })) {
        allClients.push(
          (await vault.createAccount(ETH_CHAIN_ID)) as EvmAccountClient
        );
      }

      // Sweep chain: account[i] -> account[i+1], ETH and USDC flow forward each hop
      const pairs = allClients
        .slice(0, -1)
        .map((from, i) => [from, allClients[i + 1]] as const);
      for (const [from, to] of pairs) {
        const result = await from.emptyVault(getAddress(to.getId().address));
        expect(result.status).toBe('sent');
        expect(result.transferredNativeAsset).toBe(true);
        expect(result.transferredAssetCount).toBe(2);
      }

      // All swept accounts must have ETH dust only and zero USDC
      for (const client of allClients.slice(0, -1)) {
        const ethBalance = await publicClient.getBalance({
          address: getAddress(client.getId().address)
        });
        expect(ethBalance).toBeLessThan(SWEPT_ACCOUNT_DUST_THRESHOLD);

        const usdcBalance = await client.getBalance(usdcAsset);
        expect(usdcBalance.balance).toBe(0n);
      }

      // Last address: ETH slightly under 1 due to gas, USDC intact
      const lastClient = allClients[SWEEP_COUNT];
      const lastEthBalance = await publicClient.getBalance({
        address: getAddress(lastClient.getId().address)
      });
      expect(lastEthBalance).toBeGreaterThan(parseEther('0.9'));
      expect(lastEthBalance).toBeLessThan(parseEther('1'));

      const lastUsdcBalance = await lastClient.getBalance(usdcAsset);
      expect(lastUsdcBalance.balance).toBe(usdcAmount);
    },
    TEST_TIMING.NETWORK_TEST_TIMEOUT_MS
  );
});
