import * as secp from '@noble/secp256k1';
import {
  bytesToHex,
  getAddress,
  hashMessage,
  hashTypedData,
  hexToBytes,
  keccak256,
  serializeSignature,
  serializeTransaction,
  type Hex,
  type TransactionSerializable
} from 'viem';
import {
  toAccount,
  type PrivateKeyAccount,
  type SignAuthorizationReturnType
} from 'viem/accounts';
import { hashAuthorization } from 'viem/utils';
import { keccak_256 } from '@noble/hashes/sha3.js';

type EthereumSignature = {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
  v: 27n | 28n;
};

async function signHashWithPrivateKeyBytes(
  privateKey: Uint8Array,
  hash: Hex
): Promise<EthereumSignature> {
  const recoveredSignature = await secp.signAsync(
    hexToBytes(hash),
    privateKey,
    {
      prehash: false,
      lowS: true,
      format: 'recovered'
    }
  );

  const yParity = (recoveredSignature[0] & 1) as 0 | 1;

  return {
    r: bytesToHex(recoveredSignature.subarray(1, 33)),
    s: bytesToHex(recoveredSignature.subarray(33, 65)),
    yParity,
    v: yParity === 0 ? 27n : 28n
  };
}

/**
 * Creates a viem PrivateKeyAccount from a private key in bytes (Uint8Array).
 *
 * @param privateKey - The private key as a 32-byte Uint8Array.
 * @returns A viem PrivateKeyAccount that uses the provided bytes for signing.
 */
export function createPrivateKeyAccount(
  privateKey: Uint8Array
): PrivateKeyAccount {
  const publicKey = secp.getPublicKey(privateKey, false);
  const address = getAddress(
    bytesToHex(keccak_256(publicKey.subarray(1)).slice(-20))
  );

  const account = toAccount({
    address,
    async sign({ hash }) {
      const signature = await signHashWithPrivateKeyBytes(privateKey, hash);
      return serializeSignature(signature);
    },
    async signMessage({ message }) {
      const signature = await signHashWithPrivateKeyBytes(
        privateKey,
        hashMessage(message)
      );
      return serializeSignature(signature);
    },
    async signTransaction(
      transaction: TransactionSerializable,
      { serializer = serializeTransaction } = {}
    ) {
      const signableTransaction =
        transaction.type === 'eip4844'
          ? { ...transaction, sidecars: false as const }
          : transaction;

      const signature = await signHashWithPrivateKeyBytes(
        privateKey,
        keccak256(await serializer(signableTransaction))
      );

      return serializer(transaction, signature);
    },
    async signTypedData(parameters) {
      const signature = await signHashWithPrivateKeyBytes(
        privateKey,
        hashTypedData(parameters as Parameters<typeof hashTypedData>[0])
      );
      return serializeSignature(signature);
    },
    async signAuthorization(parameters) {
      const address = parameters.contractAddress ?? parameters.address;
      const signature = await signHashWithPrivateKeyBytes(
        privateKey,
        hashAuthorization({
          address,
          chainId: parameters.chainId,
          nonce: parameters.nonce
        })
      );

      return {
        address,
        chainId: parameters.chainId,
        nonce: parameters.nonce,
        ...signature
      } as SignAuthorizationReturnType;
    }
  });

  return {
    ...account,
    publicKey: bytesToHex(publicKey),
    source: 'privateKey'
  } as PrivateKeyAccount;
}
