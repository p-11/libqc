export type { AccountClientInterface } from './client';
export { BitcoinAccountClient } from './bitcoin';
export {
  EvmAccountClient,
  type AccountConfig,
  ValidatorType,
  type ValidatorConfig,
  getAccountConfig,
  getAuthorizedAccount,
  getReadOnlyAccount,
  detectValidatorType,
  getDefaultValidatorConfigForVersion,
  createValidatorConfig
} from './evm';
export type {
  AuthorizedAccount,
  ReadOnlyAccount,
  SetValidatorConfig
} from './evm';

/** @deprecated Use named export EvmAccountClient. Default export for backward compatibility. */
export { EvmAccountClient as default } from './evm';
