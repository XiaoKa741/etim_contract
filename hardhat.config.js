require("@nomicfoundation/hardhat-toolbox");
// require("@nomicfoundation/hardhat-foundry");  // requires forge to be installed
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
      ...(process.env.FORK === "true" ? {
        forking: {
          url: process.env.MAINNET_RPC_URL,
          blockNumber: 24561657,
        }
      } : {}),
      hardfork: "cancun",  // For PoolSwapTest
      initialBaseFeePerGas: 0, // 设置为0，这样就不会有基础费用了
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY1],
    },
    megaeth: {
      url: "https://carrot.megaeth.com/rpc",
      chainId: 6343,
      accounts: [process.env.PRIVATE_KEY, process.env.PRIVATE_KEY1],
    },
    // 以太坊主网配置
    // mainnet: {
    //   url: process.env.MAINNET_RPC_URL,
    //   accounts: [process.env.PRIVATE_KEY],
    //   gasLimit: 5000000,
    // },
  },
  // etherscan: {
  //   apiKey: process.env.ETHERSCAN_API_KEY
  // },
  mocha: {
    timeout: 120000, // 120秒，单位毫秒
  },
  sourcify: {
    enabled: true
  }
};
