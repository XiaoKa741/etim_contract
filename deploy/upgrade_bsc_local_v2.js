const { ethers, upgrades } = require("hardhat");

// 代理合约地址
const ETIMMAIN_PROXY_ADDRESS = "";

async function main() {
    await upgrade();
}

async function upgrade() {
    const [deployer] = await ethers.getSigners();

    console.log("升级者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");
    console.log("代理合约地址:", ETIMMAIN_PROXY_ADDRESS);

    // 验证代理合约存在
    const proxyCode = await ethers.provider.getCode(ETIMMAIN_PROXY_ADDRESS);
    if (proxyCode === "0x") {
        throw new Error("错误：代理合约不存在");
    }

    // 获取当前实现合约地址
    const implAddress = await upgrades.erc1967.getImplementationAddress(ETIMMAIN_PROXY_ADDRESS);
    console.log("当前实现合约地址:", implAddress);

    // 部署新的实现合约并升级
    console.log("\n🆗 部署 ETIMMainV2 实现合约并升级代理...");
    const ETIMMainV2 = await ethers.getContractFactory("ETIMMainV2");
    const etimMainV2 = await upgrades.upgradeProxy(ETIMMAIN_PROXY_ADDRESS, ETIMMainV2);
    await etimMainV2.waitForDeployment();

    const newImplAddress = await upgrades.erc1967.getImplementationAddress(ETIMMAIN_PROXY_ADDRESS);
    console.log("新实现合约地址:", newImplAddress);
    console.log("代理合约地址:", await etimMainV2.getAddress());

    // 验证升级成功
    console.log("\n✅ 升级完成！");
    console.log("=".repeat(60));
    console.log("ETIMMainV2 升级摘要:");
    console.log("=".repeat(60));
    console.log("代理地址 (不变)      :", ETIMMAIN_PROXY_ADDRESS);
    console.log("旧实现地址          :", implAddress);
    console.log("新实现地址          :", newImplAddress);
    console.log("=".repeat(60));

    // 可选：验证一些基本状态
    console.log("\n验证合约状态...");
    const etimToken = await etimMainV2.etimToken();
    const weth = await etimMainV2.weth();
    const owner = await etimMainV2.owner();
    console.log("ETIM Token:", etimToken);
    console.log("WETH      :", weth);
    console.log("Owner     :", owner);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
