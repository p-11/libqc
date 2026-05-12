# @project-eleven/libqc

`@project-eleven/libqc` is the core library used to interact with quantum-safe wallets.

## Usage

To use `@project-eleven/libqc` in your project, install it via npm:

```bash
npm install @project-eleven/libqc
```

Import `@project-eleven/libqc` in your TypeScript code to access its functionality.

```typescript
import { foo } from '@project-eleven/libqc';

foo();
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to contribute to this project.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Getting Started with Development

To build the library:

```bash
pnpm install
pnpm run build
```

### Configuration

libqc requires chain specifications to be provided by the client during initialization. The client controls:

- Which chains to support
- RPC URLs for each chain
- Other chain-specific configuration

#### Example Initialization

```typescript
import {
  LibQC,
  WebStorage,
  toChain,
  ChainId,
  type BundlerConfigProvider,
  type ChainSpecification
} from '@project-eleven/libqc';

// 1. Create storage instance
const storage = new WebStorage();

// 2. Define the chains your application supports
const chains: ChainSpecification[] = [
  {
    id: 1,
    chainId: new ChainId({ namespace: 'eip155', reference: '1' }),
    name: 'Ethereum',
    network: 'ethereum',
    iconUrl: 'https://your-cdn.com/ethereum-icon.png',
    nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
    testnet: false,
    rpcUrls: ['https://your-ethereum-rpc.com']
  },
  {
    id: 8453,
    chainId: new ChainId({ namespace: 'eip155', reference: '8453' }),
    name: 'Base',
    network: 'base',
    iconUrl: 'https://your-cdn.com/base-icon.png',
    nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
    testnet: false,
    rpcUrls: ['https://your-base-rpc.com']
  }
];

// 3. Define bundler configuration provider
// NOTE: Different chains require different bundler endpoints
const bundlerConfigProvider: BundlerConfigProvider = chainId => {
  const chain = chains.find(c => c.chainId.toString() === chainId.toString());
  if (!chain) {
    throw new Error(`Chain ${chainId.toString()} not supported`);
  }

  // Select bundler URL based on chain
  let bundlerUrl: string;
  let apiKey: string;

  if (chainId.toString() === 'eip155:1') {
    // Ethereum mainnet
    bundlerUrl = 'ETH_BUNDLER_ENV_VAR';
    apiKey = 'ETH_BUNDLER_API_KEY_ENV_VAR';
  } else if (chainId.toString() === 'eip155:8453') {
    // Base
    bundlerUrl = 'BASE_BUNDLER_ENV_VAR';
    apiKey = 'BASE_BUNDLER_API_KEY_ENV_VAR';
  } else {
    throw new Error(`No bundler configured for chain ${chainId.toString()}`);
  }

  return {
    chain: toChain(chain),
    urls: [bundlerUrl],
    headers: {
      // P11TODO: remove once we no longer need to pass an API key
      Authorization: `Bearer ${apiKey}`
    }
  };
};

// 4. Initialize LibQC with all constructor parameters
const vault = new LibQC(storage, chains, bundlerConfigProvider);

// 5. Create accounts on different chains
const ethereumAccount = await vault.createAccount(
  new ChainId({ namespace: 'eip155', reference: '1' })
);

const baseAccount = await vault.createAccount(
  new ChainId({ namespace: 'eip155', reference: '8453' })
);
```

### Multi-Chain Support

libqc supports multiple EVM-compatible chains through a unified API. Key features:

#### Supported Chains

libqc currently supports:

- **Ethereum Mainnet** (`eip155:1`)
- **Base** (`eip155:8453`)
- **Bitcoin** (`bip122:000000000019d6689c085ae165831e93`, mainnet and testnet)

#### Testing Environment

For tests, configure the following environment variables in `__tests__/.env`:

**Chain RPC URLs** (REQUIRED):

- `TEST_ETH_L1_RPC_URL`: Ethereum testnet RPC URL (e.g., Tenderly virtual testnet)
- `TEST_BASE_RPC_URL`: Base testnet RPC URL (e.g., Tenderly virtual testnet)

**Bundler Configuration** (REQUIRED):

- `TEST_ETH_BUNDLER_RPC_URL`: ERC-4337 bundler RPC URL for Ethereum (e.g., Pimlico, Alchemy)
- `TEST_ETH_BUNDLER_API_KEY`: API key for Ethereum bundler
- `TEST_BASE_BUNDLER_RPC_URL`: ERC-4337 bundler RPC URL for Base (e.g., Pimlico, Alchemy)
- `TEST_BASE_BUNDLER_API_KEY`: API key for Base bundler

## Testing

To run all tests:

```bash
pnpm run test
```

To run the property-based/fuzz tests for `cryptography.ts`:

```bash
pnpm run test:property
```

For coverage scope and failure replay details, see
[`__tests__/property/README.md`](__tests__/property/README.md).

## Linting and Formatting

Can be run with:

```bash
pnpm run lint:check
pnpm run lint:fix
pnpm run prettier:check
pnpm run prettier:fix
```

## Emergency Private Key Export

libqc derives keys via BIP-85 with a custom application namespace, which no
third-party wallet implements. A libqc 24-word mnemonic typed directly into
MetaMask, Sparrow, or Ledger will not produce the same addresses.

`scripts/exportPrivateKeys.mjs` is a standalone, offline recovery script that
reproduces libqc's derivation and prints, per address index:

- the Bitcoin address, private key, and WIF
- the EVM Kernel V3.3 smart-account address (the address shown in libqc and
  the address that holds funds)
- the EVM owner EOA address and private key (the AA owner key)

```bash
# Read mnemonic from a file (preferred):
node scripts/exportPrivateKeys.mjs --mnemonic-file mnemonic.txt

# Or pipe via stdin:
cat mnemonic.txt | node scripts/exportPrivateKeys.mjs
```

Common options:

- `--start <n>` / `--count <n>` — index window to derive (default: 0..19)
- `--indices <a,b,c>` — explicit index list (overrides `--start`/`--count`)
- `--testnet` — emit Bitcoin testnet (`tb1q...`) addresses and testnet WIF
- `--json` — machine-readable JSON output instead of the default table

Run `node scripts/exportPrivateKeys.mjs --help` for the full option list.

### Recovery Semantics (read this before moving funds)

Recovery semantics differ between chains because libqc's EVM accounts are
ERC-4337 smart contract accounts, while its Bitcoin accounts are plain p2wpkh:

- **Bitcoin** — import the WIF into Sparrow, Bluewallet, or Ledger as a
  non-HD account. Funds are immediately spendable.
- **EVM** — the smart-account address is what libqc displays and what holds
  funds. The private key emitted is the **AA owner key**: importing it into
  MetaMask grants access only to the (empty) owner EOA. To move funds out of
  the smart account, sign a UserOperation with the owner key and submit it
  to any ERC-4337 bundler.

### Safety

- The mnemonic is never accepted via argv (visible to other processes via
  `ps`); use `--mnemonic-file` or stdin only.
- Run on an offline / air-gapped machine where possible.
- The output **is** the private key — anyone who sees it can spend BTC funds
  directly, and EVM funds via a bundler. Shred the mnemonic file after use
  (`shred -u mnemonic.txt` on Linux, `rm -P mnemonic.txt` on macOS).
