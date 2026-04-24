const { ethers, upgrades } = require("hardhat");

const ETIMMAIN_PROXY_ADDRESS = "0x..."; // 填写你的代理地址

async function main() {
    await upgrade();
}

async function upgrade() {
    // 1. 基本校验
    if (!ETIMMAIN_PROXY_ADDRESS) {
        throw new Error("请填写 ETIMMAIN_PROXY_ADDRESS");
    }

    const [deployer] = await ethers.getSigners();
    console.log("升级者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(
        await ethers.provider.getBalance(deployer.address)
    ), "BNB");

    // 2. 验证代理合约存在
    const proxyCode = await ethers.provider.getCode(ETIMMAIN_PROXY_ADDRESS);
    if (proxyCode === "0x") {
        throw new Error("错误：代理合约不存在");
    }

    // 3. 获取升级前的实现地址
    const implAddress = await upgrades.erc1967.getImplementationAddress(ETIMMAIN_PROXY_ADDRESS);
    console.log("当前实现合约地址:", implAddress);

    // 3-1. 导入现有代理（首次在本机操作时需要,需要注意这里导入的是上一版的实现V2->V1, V3->V2）
    const ETIMMainV1 = await ethers.getContractFactory("contracts/ETIMMain.sol:ETIMMain__need_manual_set");
    try {
        await upgrades.forceImport(ETIMMAIN_PROXY_ADDRESS, ETIMMainV1, { kind: "uups" });
        console.log("✅ 代理导入成功");
    } catch (e) {
        if (e.message.includes("already registered")) {
            console.log("ℹ️  代理已注册，跳过导入");
        } else {
            throw e;
        }
    }

    // 4. 验证存储布局兼容性
    console.log("\n📋 验证存储布局兼容性...");
    const ETIMMainV2 = await ethers.getContractFactory("contracts/ETIMMainV2.sol:ETIMMain__need_manual_set");
    await upgrades.validateUpgrade(ETIMMAIN_PROXY_ADDRESS, ETIMMainV2, { kind: "uups" });
    console.log("✅ 存储布局验证通过");

    // 5. 执行升级
    console.log("\n🆗 部署 ETIMMainV2 并升级代理...");
    const etimMainV2 = await upgrades.upgradeProxy(ETIMMAIN_PROXY_ADDRESS, ETIMMainV2, {
        kind: "uups",
        redeployImplementation: "onchange",
    });
    await etimMainV2.waitForDeployment();

    // 6. 验证新实现地址
    const newImplAddress = await upgrades.erc1967.getImplementationAddress(ETIMMAIN_PROXY_ADDRESS);

    console.log("\n" + "=".repeat(60));
    console.log("ETIMMainV2 升级摘要:");
    console.log("=".repeat(60));
    console.log("代理地址 (不变):", ETIMMAIN_PROXY_ADDRESS);
    console.log("旧实现地址    :", implAddress);
    console.log("新实现地址    :", newImplAddress);

    if (newImplAddress.toLowerCase() === implAddress.toLowerCase()) {
        console.warn("⚠️ 警告：实现地址未变化，升级可能未生效");
    } else {
        console.log("✅ 实现合约已成功更新");
    }

    // 7. 验证合约状态
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