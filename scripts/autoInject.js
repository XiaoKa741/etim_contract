require('dotenv').config({ path: __dirname + '/.env' });
const { ethers } = require('ethers');

// Configuration
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL || 'https://bsc-dataseed1.binance.org';
const ETIM_MAIN_ADDRESS = process.env.ETIM_MAIN_ADDRESS || '0x0000000000000000000000000000000000000000'; // BSC address TBD after deployment

// ETIMMain ABI
const ETIM_MAIN_ABI = [
  'function triggerLpBurnAllocation() external',
  'function pendingLpEth() view returns (uint256)',
  'function pendingSwapBurnEth() view returns (uint256)',
  'function lpBurnCooldown() view returns (uint256)',
  'function lpBurnLastTrigger() view returns (uint256)',
];

async function main() {
  if (!PRIVATE_KEY) {
    console.error('Error: PRIVATE_KEY environment variable not set');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const etimMain = new ethers.Contract(ETIM_MAIN_ADDRESS, ETIM_MAIN_ABI, wallet);

  console.log('=== ETIM LP/Burn Auto Injection Script ===');
  console.log(`Wallet: ${wallet.address}`);
  console.log(`RPC: ${RPC_URL}`);
  console.log(`Contract: ${ETIM_MAIN_ADDRESS}`);
  console.log('');

  async function checkAndInject() {
    try {
      const now = Math.floor(Date.now() / 1000);
      const cooldown = await etimMain.lpBurnCooldown();
      const lastTrigger = await etimMain.lpBurnLastTrigger();
      const pendingLp = await etimMain.pendingLpEth();
      const pendingBurn = await etimMain.pendingSwapBurnEth();

      const nextTriggerTime = Number(lastTrigger) + Number(cooldown);
      const secondsUntilNext = Math.max(0, nextTriggerTime - now);
      const minutesUntilNext = Math.floor(secondsUntilNext / 60);
      const secondsRemainder = secondsUntilNext % 60;

      console.log(`\n[${new Date().toISOString()}]`);
      console.log(`Pending LP ETH: ${ethers.formatEther(pendingLp)} ETH`);
      console.log(`Pending Burn ETH: ${ethers.formatEther(pendingBurn)} ETH`);
      console.log(`Cooldown: ${cooldown} seconds (${Math.floor(Number(cooldown) / 60)} minutes)`);
      console.log(`Last trigger: ${new Date(Number(lastTrigger) * 1000).toISOString()}`);

      if (secondsUntilNext > 0) {
        console.log(`⏳ Next trigger available in ${minutesUntilNext}m ${secondsRemainder}s`);
        return false;
      }

      if (pendingLp === 0n && pendingBurn === 0n) {
        console.log('ℹ️ No pending ETH to inject');
        return false;
      }

      console.log('📤 Triggering injection...');
      const tx = await etimMain.triggerLpBurnAllocation();
      console.log(`Tx hash: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`✅ Confirmed in block ${receipt.blockNumber}`);
      return true;
    } catch (error) {
      console.error('❌ Error:', error.message);
      return false;
    }
  }

  // Initial check
  await checkAndInject();

  // Set up interval (every 2 hours)
  const intervalMs = 2 * 60 * 60 * 1000;
  console.log(`\n🔄 Running every 2 hours...`);
  console.log('Press Ctrl+C to stop\n');

  setInterval(checkAndInject, intervalMs);
}

main().catch(console.error);