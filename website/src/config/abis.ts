export const ETIMMainABI = [
  // Public state variables
  { name: 'totalUsers', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalDeposited', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalActiveNodes', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalActiveS2PlusPlayers', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'totalActiveS6Players', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'ethPriceInUsd', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'growthPoolReleased', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'participationAmountMin', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'participationAmountMax', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'NODE_QUOTA', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
  // Read functions
  {
    name: 'users',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [
      { name: 'participationTime', type: 'uint256' },
      { name: 'investedEthAmount', type: 'uint256' },
      { name: 'investedValueInUsd', type: 'uint256' },
      { name: 'claimedValueInUsd', type: 'uint256' },
      { name: 'lastClaimTime', type: 'uint256' },
      { name: 'directReferralCount', type: 'uint256' },
      { name: 'teamTokenBalance', type: 'uint256' },
      { name: 'level', type: 'uint8' },
      { name: 'syncedNodeCount', type: 'uint256' },
      { name: 'nodeRewardDebt', type: 'uint256' },
      { name: 'pendingNodeRewards', type: 'uint256' },
      { name: 's2PlusActive', type: 'bool' },
      { name: 's3PlusActive', type: 'bool' },
      { name: 's6Active', type: 'bool' },
    ],
  },
  {
    name: 'referrerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getUserLevel',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'getClaimableAmount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getClaimableAmountOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getClaimableNodeRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'userAddr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getClaimableS2PlusRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'userAddr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getClaimableS3PlusRewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'userAddr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getClaimableS6Rewards',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'userAddr', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'remainingGrowthPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'isGrowthPoolDepleted',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 's2PlusPendingEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 's3PlusPendingEth',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'levelConditions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'level', type: 'uint8' }],
    outputs: [
      { name: 'minDirectReferrals', type: 'uint256' },
      { name: 'minPersonalTokens', type: 'uint256' },
      { name: 'minTeamTokens', type: 'uint256' },
      { name: 'accelerationRate', type: 'uint256' },
    ],
  },
  // Write functions
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimNodeRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimS2PlusRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimS3PlusRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimS6Rewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'syncLevel',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'syncNodes',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'syncTeamBalance',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

export const ETIMTokenABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export const ETIMNodeABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

// ERC20 ABI for token approvals and transfers
export const ERC20ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
] as const;

// Uniswap V4 Quoter ABI for getting swap quotes
export const QuoterABI = [
  {
    name: 'quoteExactInputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          {
            name: 'poolKey',
            type: 'tuple',
            components: [
              { name: 'currency0', type: 'address' },
              { name: 'currency1', type: 'address' },
              { name: 'fee', type: 'uint24' },
              { name: 'tickSpacing', type: 'int24' },
              { name: 'hooks', type: 'address' },
            ],
          },
          { name: 'zeroForOne', type: 'bool' },
          { name: 'exactAmount', type: 'uint128' },
          { name: 'hookData', type: 'bytes' },
        ],
      },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const;

// Uniswap V4 Universal Router ABI
export const UniversalRouterABI = [
  {
    name: 'execute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// UniversalRouter V4 Parameters encoding
// V4_SWAP = 0x10 (command byte)
// Input: abi.encode(V4SwapStruct)
// V4SwapStruct = {
//   address recipient,
//   PoolKey poolKey,  // (currency0, currency1, fee, tickSpacing, hooks)
//   SwapParams params, // (zeroForOne, amountSpecified, sqrtPriceLimitX96)
//   bool takeClaims,
//   bool settleUsingBurn,
//   bytes hookData
// }

// Permit2 ABI for token approvals
export const Permit2ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
  {
    name: 'transferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint160' },
    ],
    outputs: [],
  },
  // Permit transfer from (single permit)
  {
    name: 'permitTransferFrom',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'permit',
        type: 'tuple',
        components: [
          { name: 'permitted', type: 'tuple', components: [
            { name: 'token', type: 'address' },
            { name: 'amount', type: 'uint256' },
          ]},
          { name: 'nonce', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
          { name: 'v', type: 'uint8' },
          { name: 'r', type: 'bytes32' },
          { name: 's', type: 'bytes32' },
        ],
      },
      {
        name: 'transferDetails',
        type: 'tuple',
        components: [
          { name: 'to', type: 'address' },
          { name: 'requestedAmount', type: 'uint256' },
        ],
      },
      { name: 'owner', type: 'address' },
    ],
    outputs: [],
  },
] as const;

// StateView ABI for getting pool state (sqrtPriceX96, etc.)
export const StateViewABI = [
  {
    name: 'getSlot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'protocolFee', type: 'uint24' },
      { name: 'swapFee', type: 'uint24' },
    ],
  },
  {
    name: 'getLiquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      {
        name: 'key',
        type: 'tuple',
        components: [
          { name: 'currency0', type: 'address' },
          { name: 'currency1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickSpacing', type: 'int24' },
          { name: 'hooks', type: 'address' },
        ],
      },
    ],
    outputs: [{ name: 'liquidity', type: 'uint128' }],
  },
] as const;
