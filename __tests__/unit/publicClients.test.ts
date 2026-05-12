import { ChainId } from 'caip';

// Main entry point exports
import { type ChainNetwork, type ChainSpecification, IconUrl } from '../../src';

// Internal imports (not exported from main entry point)
import { createEvmReadOnlyChainClients } from '../../src/publicClients';
import { createTypedChain } from '../testUtils';

describe('@project-eleven/libqc core publicClients.ts', () => {
  it('creates a registry with multiple public clients', () => {
    const chains: ChainSpecification[] = [
      createTypedChain({
        chainId: 1,
        name: 'Ethereum',
        network: 'mainnet',
        iconUrl: 'https://example.com/eth.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://eth.example.org']
      }),
      createTypedChain({
        chainId: 8453,
        name: 'Base',
        network: 'base',
        iconUrl: 'https://example.com/base.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://base.example.org']
      })
    ] as const;

    const registry = createEvmReadOnlyChainClients(chains);
    const all = registry.all();

    expect(all.size).toBe(2);
    const chainId1 = new ChainId({ namespace: 'eip155', reference: '1' });
    const chainId8453 = new ChainId({ namespace: 'eip155', reference: '8453' });
    expect(all.get(chainId1.toString())).toBeDefined();
    expect(all.get(chainId8453.toString())).toBeDefined();
  });

  it('get() returns the correct client by chainId', () => {
    const chains = [
      createTypedChain({
        chainId: 1,
        name: 'Ethereum',
        network: 'mainnet',
        iconUrl: 'https://example.com/eth.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://eth.example.org']
      })
    ];

    const registry = createEvmReadOnlyChainClients(chains);
    const chainId = new ChainId({ namespace: 'eip155', reference: '1' });
    const client = registry.getByChainId(chainId);

    expect(client).toBeDefined();
    expect(client.chain).toBeDefined();
    if (client.chain) {
      expect(client.chain.id).toBe(1);
      expect(client.chain.name).toBe('Ethereum');
    }
  });

  it('getByNetwork() returns the correct client by network name', () => {
    const chains = [
      createTypedChain({
        chainId: 8453,
        name: 'Base',
        network: 'base',
        iconUrl: 'https://example.com/base.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://base.example.org']
      })
    ];

    const registry = createEvmReadOnlyChainClients(chains);
    const client = registry.getByChainNetwork('base' as ChainNetwork);

    expect(client).toBeDefined();
    expect(client.chain).toBeDefined();
    if (client.chain) {
      expect(client.chain.id).toBe(8453);
      expect(client.chain.name).toBe('Base');
    }
  });

  it('throws an error for unknown chainId', () => {
    const chains = [
      createTypedChain({
        chainId: 1,
        name: 'Ethereum',
        network: 'mainnet',
        iconUrl: 'https://example.com/eth.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://eth.example.org']
      })
    ];

    const registry = createEvmReadOnlyChainClients(chains);
    const unknownChainId = new ChainId({
      namespace: 'eip155',
      reference: '999'
    });
    expect(() => registry.getByChainId(unknownChainId)).toThrowError(
      'Unknown chainId eip155:999'
    );
  });

  it('throws an error for unknown network name', () => {
    const chains = [
      createTypedChain({
        chainId: 8453,
        name: 'Base',
        network: 'base',
        iconUrl: 'https://example.com/base.png' as IconUrl,
        nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
        testnet: false,
        rpcUrls: ['https://base.example.org']
      })
    ];

    const registry = createEvmReadOnlyChainClients(chains);
    expect(() =>
      registry.getByChainNetwork('unknown' as ChainNetwork)
    ).toThrowError('Unknown network unknown');
  });

  it('throws an error when called with an empty chain list', () => {
    expect(() => createEvmReadOnlyChainClients([])).toThrowError(
      'No chains provided'
    );
  });
});
