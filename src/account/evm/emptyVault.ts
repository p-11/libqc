import type { GasCostEstimate } from '../../types';

/**
 * Calculates the amount of native gas to reserve for a sweep transfer.
 *
 * Multiplies the total gas units (call + verification + paymaster) by the
 * pinned maxFeePerGas to get the exact worst-case prefund cost in wei.
 *
 * @param estimate - Gas cost estimate from getTransferGasCostEstimate
 * @returns Gas cost in wei to deduct from the native balance before sweeping
 */
export function calcNativeGasCost(estimate: GasCostEstimate): bigint {
  const paymasterGas =
    (estimate.paymasterVerificationGasLimit ?? 0n) +
    (estimate.paymasterPostOpGasLimit ?? 0n);

  const reservedUnits =
    estimate.callGasLimit +
    estimate.preVerificationGas +
    estimate.verificationGasLimit +
    paymasterGas;

  return estimate.maxFeePerGas * reservedUnits;
}
