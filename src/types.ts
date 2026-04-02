// ---------------------------------------------------------------------------
// Screen identifiers
// ---------------------------------------------------------------------------

export type Screen =
  | 'network'
  | 'dashboard'
  | 'send'
  | 'mint'
  | 'deploy'
  | 'keys'
  | 'designate'
  | 'logs';

// ---------------------------------------------------------------------------
// Network configuration
// ---------------------------------------------------------------------------

export type NetworkName = 'mainnet' | 'preprod' | 'preview' | 'undeployed';

export interface NetworkConfig {
  name:           NetworkName;
  nodeUrl:        string;
  indexerUrl:     string;
  proofServerUrl: string;
}

export const NETWORK_DEFAULTS: Record<NetworkName, Omit<NetworkConfig, 'name' | 'proofServerUrl'>> = {
  mainnet:    {
    nodeUrl:    'https://rpc.mainnet.midnight.network',
    indexerUrl: 'https://indexer.mainnet.midnight.network/api/v4/graphql',
  },
  preprod:    {
    nodeUrl:    'https://rpc.preprod.midnight.network',
    indexerUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  },
  preview:    {
    nodeUrl:    'https://rpc.preview.midnight.network',
    indexerUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
  },
  undeployed: {
    nodeUrl:    'http://localhost:9944',
    indexerUrl: 'http://localhost:8088/api/v4/graphql',
  },
};

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  name:           'undeployed',
  ...NETWORK_DEFAULTS['undeployed'],
  proofServerUrl: 'http://localhost:6300',
};

// ---------------------------------------------------------------------------
// Token / wallet types
// ---------------------------------------------------------------------------

export type TokenKind = 'DUST' | 'NIGHT' | 'unshielded' | 'shielded';

export interface TokenBalance {
  symbol:   string;
  kind:     TokenKind;
  amount:   bigint;
  decimals: number;
}

export interface WalletEntry {
  name:       string;
  unshielded: string;
  shielded:   string;
  dust:       string;
}

export interface WalletState {
  address:   string;
  balances:  TokenBalance[];
  connected: boolean;
}

// ---------------------------------------------------------------------------
// Node / chain types
// ---------------------------------------------------------------------------

export interface NodeState {
  blockHeight:  number;
  blockHash:    string;
  currentSlot:  number;
  epochIndex:   number;
  msUntilEpoch: number;   // milliseconds until the next epoch boundary
  synced:       boolean;
  peers:        number;
  rpcUrl:       string;
}

// ---------------------------------------------------------------------------
// DUST types
// ---------------------------------------------------------------------------

export interface DustState {
  accrued:        bigint;
  designated:     bigint;   // NIGHT designated for DUST generation
  generationRate: bigint;   // DUST per epoch
  nextEpoch:      number;   // block height of next DUST drop
}

// ---------------------------------------------------------------------------
// Transaction types
// ---------------------------------------------------------------------------

export type TxStatus =
  | { stage: 'idle' }
  | { stage: 'building' }
  | { stage: 'proving' }
  | { stage: 'submitting' }
  | { stage: 'pending';   txHash: string }
  | { stage: 'confirmed'; txHash: string; blockHeight: number }
  | { stage: 'failed';    error:  string };

export interface SendParams {
  recipient: string;
  amount:    string;
  token:     TokenKind;
}

export interface MintParams {
  contractAddress: string;
  recipient:       string;
  amount:          string;
  shielded:        boolean;
}

export interface DeployParams {
  contractPath: string;
  initArgs:     string;
}

export interface DesignateParams {
  nightAmount: string;
}
