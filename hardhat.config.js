require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.26",
    settings: {
      viaIR: true,
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      }
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.BSC_RPC_URL || "https://bsc.publicnode.com",
        enabled: process.env.FORK === "true",
      },
      hardfork: "cancun",
      initialBaseFeePerGas: 0,
      blockGasLimit: 30000000,
      accounts: { count: 50 },
      loggingEnabled: true,
    },
    // BSC Testnet
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet-rpc.publicnode.com",
      chainId: 97,
      accounts: [
        process.env.PRIVATE_KEY,
        process.env.PRIVATE_KEY1,
        process.env.PRIVATE_KEY2,
        process.env.PRIVATE_KEY3,
        process.env.PRIVATE_KEY4,
        process.env.PRIVATE_KEY5,
        process.env.PRIVATE_KEY6,
      ].filter(Boolean),
    },
    // BSC Mainnet
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
      chainId: 56,
      accounts: [process.env.PRIVATE_KEY].filter(Boolean),
      gasLimit: 6000000,
    },
    // Ethereum Mainnet (keep for reference)
    mainnet: {
      url: process.env.MAINNET_RPC_URL,
      accounts: [process.env.PRIVATE_KEY].filter(Boolean),
      gasLimit: 6000000,
    },
  },
  etherscan: {
    apiKey: {
      bsc: process.env.BSCSCAN_API_KEY || "",
      bscTestnet: process.env.BSCSCAN_API_KEY || "",
      mainnet: process.env.ETHERSCAN_API_KEY || "",
    }
  },
  mocha: {
    timeout: 120000,
  },
  sourcify: {
    enabled: true
  }
};
