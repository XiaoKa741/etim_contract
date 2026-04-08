export const LEVEL_NAMES = ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6'] as const;

export const LEVEL_COLORS: Record<number, string> = {
  0: 'from-gray-400 to-gray-500',
  1: 'from-green-400 to-green-600',
  2: 'from-blue-400 to-blue-600',
  3: 'from-purple-400 to-purple-600',
  4: 'from-orange-400 to-orange-600',
  5: 'from-red-400 to-red-600',
  6: 'from-yellow-400 to-amber-500',
};

export const LEVEL_REQUIREMENTS = [
  { level: 'S0', referrals: 0, personal: '0', team: '0', acceleration: '10%' },
  { level: 'S1', referrals: 5, personal: '10,000', team: '100,000', acceleration: '7%' },
  { level: 'S2', referrals: 10, personal: '20,000', team: '200,000', acceleration: '10%' },
  { level: 'S3', referrals: 15, personal: '30,000', team: '400,000', acceleration: '12%' },
  { level: 'S4', referrals: 20, personal: '40,000', team: '500,000', acceleration: '15%' },
  { level: 'S5', referrals: 25, personal: '50,000', team: '600,000', acceleration: '18%' },
  { level: 'S6', referrals: 30, personal: '60,000', team: '700,000', acceleration: '21%' },
];

export const TOKENOMICS = [
  { name: 'Growth Pool', amount: '87,900,000', percent: 87.9, color: 'bg-blue-500' },
  { name: 'Airdrop', amount: '5,000,000', percent: 5, color: 'bg-green-500' },
  { name: 'Market Infrastructure', amount: '5,000,000', percent: 5, color: 'bg-purple-500' },
  { name: 'Ecosystem Fund', amount: '1,000,000', percent: 1, color: 'bg-orange-500' },
  { name: 'Community Fund', amount: '1,000,000', percent: 1, color: 'bg-red-500' },
  { name: 'Ethereum Foundation', amount: '100,000', percent: 0.1, color: 'bg-yellow-500' },
];

export const DEPOSIT_ALLOCATION = [
  { name: 'Liquidity Pool', percent: 69, color: 'bg-blue-500' },
  { name: 'Token Burn', percent: 25, color: 'bg-red-500' },
  { name: 'Node Rewards', percent: 1.5, color: 'bg-orange-500' },
  { name: 'S2+ Rewards', percent: 1, color: 'bg-green-500' },
  { name: 'S3+ Rewards', percent: 1, color: 'bg-teal-500' },
  { name: 'Foundation', percent: 1.5, color: 'bg-purple-500' },
  { name: 'Pot & Official', percent: 1, color: 'bg-gray-500' },
];
