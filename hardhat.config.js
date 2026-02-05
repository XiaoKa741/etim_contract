require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-foundry");
require("dotenv").config();

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: "0.8.28",
  settings: {
    optimizer: {
      enabled: true, // 开启优化器
      runs: 200, // 推荐值：runs越小，部署字节码越小；200是平衡部署/运行的通用值
    },
  },
  networks: {
    hardhat: {
      forking: {
        url: process.env.MAINNET_RPC_URL || "https://rpc.ankr.com/eth/302f0e8421c1f2ea708f47d046ef1770edc1ac6793ce9dc6f99aa7b753e30b35", // 主网 RPC
        blockNumber: 13945678, // 指定区块（可选）
      },
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
    }
  }
};
