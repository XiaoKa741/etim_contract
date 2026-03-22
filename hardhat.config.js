require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.28",
    settings: {
      viaIR: true,
      evmVersion: "cancun",  // For PoolSwapTest
      optimizer: {
        enabled: true,
        runs: 200,
      }
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.MAINNET_RPC_URL,
        enabled: process.env.FORK === "true",
        blockNumber: 24561657,
      },
      hardfork: "cancun",  // For PoolSwapTest
      initialBaseFeePerGas: 0, // 设置为0，这样就不会有基础费用了
      blockGasLimit: 30000000,
      accounts: { count: 50 },
      loggingEnabled: true,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [
        process.env.PRIVATE_KEY,
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2,
        process.env.PRIVATE_KEY3,
        process.env.PRIVATE_KEY4,
        process.env.PRIVATE_KEY5,
        process.env.PRIVATE_KEY6,
        // 添加更多账户用于邀请（使用随机私钥也可以，因为我们会给它们转 ETH/ETIM）
      ],
      // 允许使用未配置的账户（通过 ethers.Wallet.createRandom）
    },
    megaeth: {
      url: "https://carrot.megaeth.com/rpc",
      chainId: 6343,
      accounts: [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY1],
    },
    // 以太坊主网配置
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
      accounts: [process.env.PRIVATE_KEY],
      gasLimit: 6000000,
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY
  },
  mocha: {
    timeout: 120000, // 120秒，单位毫秒
  },
  sourcify: {
    enabled: true
  }
};
