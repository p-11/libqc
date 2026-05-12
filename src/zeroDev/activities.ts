import { KernelV3_3AccountAbi } from '@zerodev/sdk';
import {
  decodeFunctionData,
  erc20Abi,
  getAbiItem,
  GetContractEventsReturnType,
  type PublicClient
} from 'viem';
import {
  type BundlerClient,
  entryPoint07Abi,
  type UserOperation
} from 'viem/account-abstraction';
import {
  type EvmActivity,
  ActivityType,
  type Erc20TransactionActivity,
  NativeTransactionActivity
} from '../activities';
import type {
  EvmAddress,
  BlockNumber,
  Brand,
  TransactionValue
} from '../types';
import { DEFAULT_ENTRY_POINT } from './accounts';

/**
 * ZeroDev Kernel.execute execution mode
 * @see {@link https://github.com/zerodevapp/kernel/blob/6a098bc8f9a7001fe7ae801368e96a5ee635ddb1/src/Kernel.sol#L330}
 */
type ExecMode = Brand<`0x${string}`, 'ExecMode'>;

/**
 * ZeroDev Kernel.execute execution call data
 * @see {@link https://github.com/zerodevapp/kernel/blob/6a098bc8f9a7001fe7ae801368e96a5ee635ddb1/src/Kernel.sol#L330}
 */
type ExecutionCallData = Brand<`0x${string}`, 'ExecutionCallData'>;

/**
 * Gets activities for the Kernel smart wallet
 *
 * P11TODO: Getting activities this way isn't ideal. This function relies on getting contract events
 * and then iterating over them and calling getUserOperation on each. Bundlers like Ultra Relay have
 * a max-block-range (@see https://github.com/p-11/ultra-relay/blob/p11-main/alto-config.json#L14)
 * that limit history to the last X blocks. It returns null for any beyond that. This is a problem
 * that we likely want to fix by creating a light indexer and relying on that instead of the bundler.
 *
 * @param publicClient A viem PublicClient for the chain
 * @param bundlerClient A viem BundlerClient for the chain
 * @param address The address of the smart wallet
 * @returns An array of activities
 */
export async function getKernelActivities(
  publicClient: PublicClient,
  bundlerClient: BundlerClient,
  address: EvmAddress
): Promise<EvmActivity[]> {
  const userOpLogs = await publicClient.getContractEvents({
    fromBlock: 0n, // P11TODO: Could include some pagination here and potentially set this to a more recent block e.g. when LibQC wallet is released
    toBlock: 'latest',
    address: DEFAULT_ENTRY_POINT.address,
    abi: entryPoint07Abi, // P11TODO: This ABI should come from entrypoint version
    eventName: 'UserOperationEvent',
    args: {
      sender: address
    }
  });

  const receivedEvents = await publicClient.getContractEvents({
    fromBlock: 0n,
    toBlock: 'latest',
    address,
    abi: KernelV3_3AccountAbi, // P11TODO: This should be versioned properly
    eventName: 'Received'
  });

  const activities = [
    ...getActivitiesFromReceivedEvents(receivedEvents),
    ...(await Promise.all(
      userOpLogs.map(async userOpLog => {
        if (!userOpLog.args.userOpHash) return [];

        const txHash = userOpLog.transactionHash;

        try {
          const { userOperation } = await bundlerClient.getUserOperation({
            hash: userOpLog.args.userOpHash
          });

          return getActivitiesFromUserOperation(
            userOpLog.blockNumber as BlockNumber,
            userOperation,
            txHash
          );
        } catch (_error) {
          return [];
        }
      })
    ))
  ];

  return activities.flat();
}

/**
 * Gets incoming ERC-20 transaction activities for the Kernel smart wallet
 *
 * @param publicClient A viem PublicClient for the chain
 * @param address The address of the smart wallet
 * @param token The address of the ERC-20 token
 * @returns An array of transaction activities
 */
export async function getTokenActivities(
  publicClient: PublicClient,
  address: EvmAddress,
  token: EvmAddress
): Promise<Erc20TransactionActivity[]> {
  const tokenLogs = await publicClient.getContractEvents({
    fromBlock: 0n, // P11TODO: Should probably include some pagination here
    toBlock: 'latest',
    address: token,
    abi: erc20Abi,
    eventName: 'Transfer',
    args: {
      to: address
    }
  });

  return tokenLogs.map(tokenLog => ({
    type: ActivityType.Erc20Transaction,
    blockNumber: tokenLog.blockNumber as BlockNumber,
    data: {
      from: tokenLog.args.from?.toLowerCase() as EvmAddress,
      to: tokenLog.args.to?.toLowerCase() as EvmAddress,
      value: tokenLog.args.value as TransactionValue,
      contract: token,
      txHash: tokenLog.transactionHash,
      explorerUrl: null
    }
  }));
}

/**
 * Decodes a user operation into activities
 *
 * @param blockNumber The blocknumber the activity happened on
 * @param operation The executed user operation
 * @param txHash On-chain transaction hash from the UserOperationEvent log
 * @returns An array of activities
 */
function getActivitiesFromUserOperation(
  blockNumber: BlockNumber,
  operation: UserOperation,
  txHash: `0x${string}` | null
): EvmActivity[] {
  try {
    const { functionName, args } = decodeFunctionData({
      abi: KernelV3_3AccountAbi, // P11TODO: This should be variable
      data: operation.callData
    });

    switch (functionName) {
      case 'execute':
        return decodeKernelExecute(
          operation.sender.toLowerCase() as EvmAddress,
          blockNumber,
          args[0] as ExecMode,
          args[1] as ExecutionCallData,
          txHash
        );
      default:
        return [];
    }
  } catch {
    // P11TODO: This can happen due to `decodeFunctionData` throwing an error which usually happens if
    // call data is 0x. It was discovered that this can happen if user operations result in a no-op e.g.
    // sending funds to yourself. For PoC, we're ignoring this case i.e. just not showing the activity.
    return [];
  }
}

/**
 * Gets activities from received events
 *
 * @param events The received events
 * @returns An array of activities
 */
function getActivitiesFromReceivedEvents(
  events: GetContractEventsReturnType<
    typeof KernelV3_3AccountAbi,
    'Received',
    undefined,
    0n,
    'latest'
  >
): NativeTransactionActivity[] {
  return events.map(event => ({
    type: ActivityType.NativeTransaction,
    blockNumber: event.blockNumber as BlockNumber,
    data: {
      from: event.args.sender as EvmAddress,
      to: event.address,
      value: event.args.amount as TransactionValue,
      txHash: event.transactionHash,
      explorerUrl: null
    }
  }));
}

/**
 * Decodes a Kernel.execute call into transaction activity data
 *
 * Since Kernel.execute has two forms, execMode refers to either a single or batch operation
 *
 * @param sender The address of the smart account executing the call
 * @param execMode Single or Batch mode
 * @param executionCallData The call data for the Kernel.execute function
 * @param txHash On-chain transaction hash
 * @returns An array of transaction activity data
 */
function decodeKernelExecute(
  sender: EvmAddress,
  blockNumber: BlockNumber,
  execMode: ExecMode,
  executionCallData: ExecutionCallData,
  txHash: `0x${string}` | null
): EvmActivity[] {
  switch (parseInt(execMode.slice(2, 4), 16)) {
    case 0x00:
      return [
        decodeKernelExecuteSingle(
          sender,
          blockNumber,
          executionCallData,
          txHash
        )
      ].filter(a => a !== undefined);
    case 0x01: // P11TODO: Need to validate what batch mode looks like and how it works
    default:
      return [];
  }
}

/**
 * Decodes a Kernel.execute call in Single mode into transaction activity data
 *
 * Slicing logic here is based on the KernelV3 callData definition {@link https://github.com/zerodevapp/kernel/blob/6a098bc8f9a7001fe7ae801368e96a5ee635ddb1/src/utils/ExecLib.sol#L40}
 *
 * Execution call data should include:
 *
 * 20-byte address
 * 32-byte value
 * remaining bytes are callData to the target
 *
 * @param sender The address of the smart account executing the call
 * @param executionCallData The call data for the Kernel.execute function
 * @param txHash On-chain transaction hash
 * @returns Transaction activity data
 */
function decodeKernelExecuteSingle(
  sender: EvmAddress,
  blockNumber: BlockNumber,
  executionCallData: ExecutionCallData,
  txHash: `0x${string}` | null
): EvmActivity | undefined {
  const executionBytes = executionCallData.slice(2);
  const to = `0x${executionBytes.slice(0, 40)}`.toLowerCase() as EvmAddress;
  const value = BigInt(
    '0x' + executionBytes.slice(40, 104)
  ) as TransactionValue;

  // If there's no call data, it's a native transaction
  if (executionBytes.length === 104) {
    return {
      type: ActivityType.NativeTransaction,
      blockNumber,
      data: { from: sender, to, value, txHash, explorerUrl: null }
    };
  }

  // Try to decode as ERC-20 transfer
  try {
    const {
      args: [recipient, amount]
    } = decodeFunctionData({
      abi: [getAbiItem({ abi: erc20Abi, name: 'transfer' })],
      data: `0x${executionBytes.slice(104)}`
    });

    return {
      type: ActivityType.Erc20Transaction,
      blockNumber,
      data: {
        from: sender,
        to: recipient.toLowerCase() as EvmAddress,
        value: amount as TransactionValue,
        contract: to,
        txHash,
        explorerUrl: null
      }
    };
  } catch {
    // P11TODO: Perhaps this should handle unknown calls differently. We might not
    // be able to assume that this is a native transaction and maybe the wallet
    // called a function on a different contract
    return {
      type: ActivityType.NativeTransaction,
      blockNumber,
      data: { from: sender, to, value, txHash, explorerUrl: null }
    };
  }
}
