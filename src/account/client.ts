import { AccountId } from 'caip';
import type {
  Activity,
  Asset,
  BalanceResult,
  GetActivityFilters
} from '../types';

export type AccountStatus = 'safe' | 'vulnerable';

/**
 * Interface for account clients supporting both EVM and Bitcoin chains
 */
export interface AccountClientInterface {
  getId(): AccountId;
  getBalance(asset: Asset): Promise<BalanceResult>;
  getBalances(assets: Asset[]): Promise<BalanceResult[]>;
  getActivities(filters?: GetActivityFilters): Promise<Activity[]>;
  listAssets(): Promise<Asset[]>;
  isPubKeyExposed(): Promise<boolean>;
  getStatus(): Promise<AccountStatus>;
}
