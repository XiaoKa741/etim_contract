require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-foundry");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  settings: {
    optimizer: {
      enabled: true,
      runs: 200,
    }
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.MAINNET_RPC_URL,
        // blockNumber: 24554373, // 指定区块（可选）
      },
      // timeout: 120000,  // 120秒
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
  sourcify: {
    enabled: true
  }
};
