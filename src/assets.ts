import { AssetType, ChainId } from 'caip';
import { Chain } from 'viem';
import assets from './assets.json';
import { InvalidAssetDecimalsError, InvalidAssetMetadataError } from './errors';
import {
  Asset,
  AssetEntity,
  AssetId,
  AssetName,
  BalanceBigInt,
  Decimals,
  IconUrl,
  Symbol
} from './types';

/**
 * Parses a CAIP-19 asset type string into an AssetType instance
 *
 * This function is necessary due to a bug in the `caip` package that doesn't support
 * parsing valid CAIP-19 types.
 *
 * Format: chainNamespace:chainReference/assetNamespace:assetReference
 * Examples:
 *   - "eip155:1/slip44:60" (native ETH on Ethereum)
 *   - "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48" (USDC on Ethereum)
 *
 * @param assetTypeString - The CAIP-19 asset type string
 * @returns An AssetType instance
 * @throws Error if the string format is invalid
 */
function parseAssetType(assetTypeString: string): AssetType {
  const [chainIdPart, assetPart] = assetTypeString.split('/');
  if (!chainIdPart || !assetPart) {
    throw new Error(`Invalid assetType format: ${assetTypeString}`);
  }

  const [chainNamespace, chainReference] = chainIdPart.split(':');
  const [assetNamespace, assetReference] = assetPart.split(':');

  if (
    !chainNamespace ||
    !chainReference ||
    !assetNamespace ||
    !assetReference
  ) {
    throw new Error(`Invalid assetType format: ${assetTypeString}`);
  }

  // Normalize ERC-20 addresses to lowercase for consistency
  const normalizedReference =
    assetNamespace === 'erc20' ? assetReference.toLowerCase() : assetReference;

  return new AssetType({
    chainId: {
      namespace: chainNamespace,
      reference: chainReference
    },
    assetName: {
      namespace: assetNamespace,
      reference: normalizedReference
    }
  });
}

function cloneAssetType(assetType: AssetType): AssetType {
  return new AssetType({
    chainId: {
      namespace: assetType.chainId.namespace,
      reference: assetType.chainId.reference
    },
    assetName: {
      namespace: assetType.assetName.namespace,
      reference: assetType.assetName.reference
    }
  });
}

/** Clone an asset so callers cannot mutate the cached registry. */
function cloneAsset(asset: Asset): Asset {
  return {
    ...asset,
    entities: asset.entities.map(entity => ({
      ...entity,
      assetType: cloneAssetType(entity.assetType)
    }))
  };
}

/**
 * Gets all supported assets
 *
 * Assets are aggregated by their id, which is a CAIP-19 identifier for the asset.
 * Each asset can have multiple aggregated entities, which are the different ways the asset can be represented on different chains.
 * Each aggregated entity has a CAIP-19 identifier for the asset type, which is a combination of the chainId and the asset type.
 * The asset type is a combination of the namespace and the reference.
 * The namespace is the type of asset, e.g. 'erc20' for ERC-20 tokens, 'slip44' for native assets.
 * The reference is the identifier for the asset, e.g. the contract address for ERC-20 tokens, the coin type for native assets.
 *
 * @returns All supported assets
 */
export function getSupportedAssets(): Asset[] {
  return parsedAssets.map(cloneAsset);
}

// Parse and validate once at module load — assets.json is static.
// Invalid data will throw at import time; this is intentional so that
// misconfigurations surface immediately rather than at first use.
const parsedAssets: Asset[] = assets.map(asset => {
  const parsed: Asset = {
    id: asset.id as AssetId,
    symbol: asset.symbol as Symbol,
    name: asset.name as AssetName,
    decimals: asset.decimals as Decimals,
    iconUrl: asset.iconUrl as IconUrl,
    entities: asset.entities.map(entity => ({
      assetType: parseAssetType(entity.assetType),
      decimals: entity.decimals as Decimals,
      name: entity.name as AssetName,
      symbol: entity.symbol as Symbol
    }))
  };
  validateAssetMetadata(parsed);
  return parsed;
});

/**
 * Gets an asset by its id
 *
 * @param id - The id of the asset
 * @returns The asset or undefined if not found
 */
export function getAssetByid(id: AssetId): Asset | undefined {
  const asset = parsedAssets.find(a => a.id === id);
  return asset ? cloneAsset(asset) : undefined;
}

/**
 * Gets an asset by its assetType
 *
 * @param assetType - The assetType of the asset
 * @returns The asset or undefined if not found
 */
export function getAssetByAssetType(assetType: AssetType): Asset | undefined {
  const asset = parsedAssets.find(a =>
    a.entities.some(
      entity => entity.assetType.toString() === assetType.toString()
    )
  );
  return asset ? cloneAsset(asset) : undefined;
}

/**
 * Gets an asset by its symbol
 *
 * @param symbol - The symbol of the asset (case-insensitive)
 * @returns The asset or undefined if not found
 */
export function getAssetBySymbol(symbol: Symbol): Asset | undefined {
  const asset = parsedAssets.find(
    a => a.symbol.toLowerCase() === symbol.toLowerCase()
  );
  return asset ? cloneAsset(asset) : undefined;
}

/** Minimal chain/spec shape required for native asset lookup */
type ChainLike = { nativeCurrency: { symbol: Symbol } };

/**
 * Gets a native asset for a chain or chain specification
 *
 * Accepts either a viem Chain or ChainSpecification (e.g. for Bitcoin chains
 * that don't have a viem Chain).
 *
 * @param chainOrSpec - Chain or spec with nativeCurrency.symbol
 * @returns Asset - Native asset
 */
export function getNativeAsset(chainOrSpec: Chain | ChainLike): Asset {
  const asset = getAssetBySymbol(chainOrSpec.nativeCurrency.symbol as Symbol);
  if (!asset) {
    throw new Error(
      `Native asset not found for symbol: ${chainOrSpec.nativeCurrency.symbol}`
    );
  }
  return asset;
}

/**
 * Gets an entity by chainId
 *
 * @param asset - The asset
 * @param chainId - The chainId
 * @returns The entity or undefined if not found
 */
export function getEntityByChainId(
  asset: Asset,
  chainId: ChainId
): AssetEntity | undefined {
  return asset.entities.find(
    entity => entity.assetType.chainId.toString() === chainId.toString()
  );
}

/**
 * Checks if an asset is an ERC-20 token
 *
 * @param asset - The asset
 * @param chainId - The chain we're checking on
 * @returns Whether the asset is an ERC-20 token
 */
export function isErc20Token(asset: Asset, chainId: ChainId): boolean {
  return asset.entities.some(
    entity =>
      entity.assetType.assetName.namespace === 'erc20' &&
      entity.assetType.chainId.toString() === chainId.toString()
  );
}

/**
 * Checks if an asset is a native asset (uses slip44 namespace)
 *
 * Native assets are identified by the 'slip44' namespace in their asset type.
 * Examples include ETH, MATIC, and other native blockchain currencies.
 *
 * @param asset - The asset to check
 * @param chainId - The chain we're checking on
 * @returns Whether the asset is a native asset
 */
export function isNativeAsset(asset: Asset, chainId: ChainId): boolean {
  return asset.entities.some(
    entity =>
      entity.assetType.assetName.namespace === 'slip44' &&
      entity.assetType.chainId.toString() === chainId.toString()
  );
}

function assertValidDecimals(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new InvalidAssetDecimalsError(
      `${label} must be a non-negative integer, got ${value}`
    );
  }
}

/**
 * Validates an asset's decimal configuration
 *
 * Checks that the parent decimals and every entity's decimals are
 * non-negative integers.
 *
 * @param asset - The asset to validate
 * @throws {InvalidAssetDecimalsError} If any decimals value is invalid
 */
export function validateAssetDecimals(asset: Asset): void {
  assertValidDecimals(asset.decimals, `Parent decimals for asset ${asset.id}`);
  if (!Array.isArray(asset.entities)) {
    throw new InvalidAssetMetadataError(
      `Asset ${asset.id} has invalid entities metadata`
    );
  }
  for (const entity of asset.entities) {
    // Defensive: assets.json is untrusted input at module-load time,
    // so fields may be absent despite the TS type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    const entityLabel = entity.assetType
      ? entity.assetType.toString()
      : `unknown entity of asset ${asset.id}`;
    assertValidDecimals(
      entity.decimals,
      `Entity decimals for ${entityLabel} of asset ${asset.id}`
    );
  }
}

/**
 * Validates that an asset and its entities have complete metadata.
 *
 * Checks:
 * - Parent-level id, symbol, name are present and non-empty
 * - At least one entity exists
 * - All decimal values (parent + every entity) are valid
 * - Every entity has a non-empty symbol and name
 *
 * Per-entity values are allowed to differ from the parent (the data
 * model supports chain-specific naming), but they must be present.
 *
 * @param asset - The asset to validate
 * @throws {InvalidAssetDecimalsError} If any decimals value is invalid
 * @throws {InvalidAssetMetadataError} If required metadata fields are missing
 */
export function validateAssetMetadata(asset: Asset): void {
  if (!asset.id) {
    throw new InvalidAssetMetadataError('Asset is missing an id');
  }
  if (!asset.symbol) {
    throw new InvalidAssetMetadataError(
      `Asset ${asset.id} is missing a symbol`
    );
  }
  if (!asset.name) {
    throw new InvalidAssetMetadataError(`Asset ${asset.id} is missing a name`);
  }
  if (!Array.isArray(asset.entities)) {
    throw new InvalidAssetMetadataError(
      `Asset ${asset.id} has invalid entities metadata`
    );
  }
  if (asset.entities.length === 0) {
    throw new InvalidAssetMetadataError(`Asset ${asset.id} has no entities`);
  }

  validateAssetDecimals(asset);

  const seenChains = new Set<string>();
  for (const entity of asset.entities) {
    // Defensive runtime check — assets.json is untrusted input at
    // module-load time so the field may be absent despite the TS type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (!entity.assetType) {
      throw new InvalidAssetMetadataError(
        `Asset ${asset.id} has an entity with missing assetType`
      );
    }
    const chainKey = entity.assetType.chainId.toString();
    if (seenChains.has(chainKey)) {
      throw new InvalidAssetMetadataError(
        `Asset ${asset.id} has multiple entities for chain ${chainKey}`
      );
    }
    seenChains.add(chainKey);

    if (!entity.symbol) {
      throw new InvalidAssetMetadataError(
        `Entity ${entity.assetType.toString()} of asset ${asset.id} is missing a symbol`
      );
    }
    if (!entity.name) {
      throw new InvalidAssetMetadataError(
        `Entity ${entity.assetType.toString()} of asset ${asset.id} is missing a name`
      );
    }
  }
}

/**
 * Normalises a raw balance from one decimal basis to another
 *
 * Converts a BigInt amount expressed in `sourceDecimals` precision to
 * the equivalent amount in `targetDecimals` precision.
 *
 * - When target > source the value is scaled up (lossless).
 * - When target < source the value is scaled down via integer
 *   division (deterministic truncation toward zero).
 * - When target === source the value is returned unchanged.
 *
 * @param amount - Raw balance in source decimal precision
 * @param sourceDecimals - Decimal places of the input amount
 * @param targetDecimals - Decimal places of the desired output
 * @returns The normalised balance
 * @throws {InvalidAssetDecimalsError} If either decimal value is invalid
 */
export function normaliseBalance(
  amount: BalanceBigInt,
  sourceDecimals: Decimals,
  targetDecimals: Decimals
): BalanceBigInt {
  assertValidDecimals(sourceDecimals, 'sourceDecimals');
  assertValidDecimals(targetDecimals, 'targetDecimals');

  if (sourceDecimals === targetDecimals) {
    return amount;
  }

  if (targetDecimals > sourceDecimals) {
    return (amount *
      10n ** BigInt(targetDecimals - sourceDecimals)) as BalanceBigInt;
  }

  return (amount /
    10n ** BigInt(sourceDecimals - targetDecimals)) as BalanceBigInt;
}
