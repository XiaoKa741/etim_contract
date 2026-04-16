const { ethers, upgrades } = require("hardhat");

// 代理合约地址
const ETIMMAIN_PROXY_ADDRESS = "0x7Bb0814236E80Dc6AaFcd4B02Faa60C950A96728";
const ETIMHELPER_PROXY_ADDRESS = "0x3e15dEd17eA481cbcEa4A573EaFd5a779B42063C";

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

    // 导入现有代理（首次在本机操作时需要）
    const ETIMMainV1 = await ethers.getContractFactory("contracts/ETIMMain.sol:ETIMMain");
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

    // 验证存储布局兼容性
    console.log("\n📋 验证存储布局兼容性...");
    const ETIMMainV2 = await ethers.getContractFactory("contracts/ETIMMainV2.sol:ETIMMain");
    await upgrades.validateUpgrade(ETIMMAIN_PROXY_ADDRESS, ETIMMainV2, { kind: "uups" });
    console.log("✅ 存储布局验证通过");

    // 部署新的实现合约并升级
    console.log("\n🆗 部署 ETIMMainV2 实现合约并升级代理...");
    const etimMainV2 = await upgrades.upgradeProxy(ETIMMAIN_PROXY_ADDRESS, ETIMMainV2, {
        kind: "uups",
        redeployImplementation: "onchange",
    });
    const tx = etimMainV2.deploymentTransaction();
    if (tx) await tx.wait(2);

    const newImplAddress = await upgrades.erc1967.getImplementationAddress(ETIMMAIN_PROXY_ADDRESS);

    // 验证升级成功
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

    // 验证合约状态
    console.log("\n验证合约状态...");
    const etimToken = await etimMainV2.etimToken();
    const weth = await etimMainV2.weth();
    const owner = await etimMainV2.owner();
    console.log("ETIM Token:", etimToken);
    console.log("WETH      :", weth);
    console.log("Owner     :", owner);
}

async function upgrade_helper() {
    // BSC Mainnet addresses
    const VAULT_ADDRESS = "0x238a358808379702088667322f80aC48bAd5e6c4";
    const CL_POOL_MANAGER_ADDRESS = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
    const WETH_ADDRESS = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";
    const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d";
    const CHAINLINK_ETH_USD = "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e";

    const [deployer] = await ethers.getSigners();

    console.log("升级者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");
    console.log("代理合约地址:", ETIMHELPER_PROXY_ADDRESS);

    // 验证代理合约存在
    const proxyCode = await ethers.provider.getCode(ETIMHELPER_PROXY_ADDRESS);
    if (proxyCode === "0x") {
        throw new Error("错误：代理合约不存在");
    }

    // 获取当前实现合约地址
    const implAddress = await upgrades.erc1967.getImplementationAddress(ETIMHELPER_PROXY_ADDRESS);
    console.log("当前实现合约地址:", implAddress);

    // 从现有代理读取 ETIM 地址（immutable）
    const poolHelperOld = await ethers.getContractAt("ETIMPoolHelper", ETIMHELPER_PROXY_ADDRESS);
    const etimAddress = await poolHelperOld.etim();

    // 构造函数参数
    const constructorArgs = [
        VAULT_ADDRESS,
        CL_POOL_MANAGER_ADDRESS,
        WETH_ADDRESS,
        etimAddress,
        USDC_ADDRESS,
        CHAINLINK_ETH_USD,
    ];

    // 导入现有代理（首次在本机操作时需要）
    const ETIMPoolHelperV1 = await ethers.getContractFactory("ETIMPoolHelper");
    try {
        await upgrades.forceImport(ETIMHELPER_PROXY_ADDRESS, ETIMPoolHelperV1, {
            kind: "uups",
            constructorArgs,
            unsafeAllow: ["constructor", "state-variable-immutable"],
        });
        console.log("✅ 代理导入成功");
    } catch (e) {
        if (e.message.includes("already registered")) {
            console.log("ℹ️  代理已注册，跳过导入");
        } else {
            throw e;
        }
    }

    // 验证存储布局兼容性
    console.log("\n📋 验证存储布局兼容性...");
    const ETIMPoolHelper = await ethers.getContractFactory("ETIMPoolHelper");
    await upgrades.validateUpgrade(ETIMHELPER_PROXY_ADDRESS, ETIMPoolHelper, {
        kind: "uups",
        constructorArgs,
        unsafeAllow: ["constructor", "state-variable-immutable"],
    });
    console.log("✅ 存储布局验证通过");

    // 部署新的实现合约并升级
    console.log("\n🆗 部署 ETIMPoolHelper 实现合约并升级代理...");
    const poolHelper = await upgrades.upgradeProxy(ETIMHELPER_PROXY_ADDRESS, ETIMPoolHelper, {
        kind: "uups",
        constructorArgs,
        unsafeAllow: ["constructor", "state-variable-immutable"],
        redeployImplementation: "onchange",
    });
    const tx = poolHelper.deploymentTransaction();
    if (tx) await tx.wait(2);

    const newImplAddress = await upgrades.erc1967.getImplementationAddress(ETIMHELPER_PROXY_ADDRESS);

    // 验证升级成功
    console.log("\n" + "=".repeat(60));
    console.log("ETIMPoolHelper 升级摘要:");
    console.log("=".repeat(60));
    console.log("代理地址 (不变):", ETIMHELPER_PROXY_ADDRESS);
    console.log("旧实现地址    :", implAddress);
    console.log("新实现地址    :", newImplAddress);

    if (newImplAddress.toLowerCase() === implAddress.toLowerCase()) {
        console.warn("⚠️ 警告：实现地址未变化，升级可能未生效");
    } else {
        console.log("✅ 实现合约已成功更新");
    }

    // 验证合约状态
    console.log("\n验证合约状态...");
    const etimToken = await poolHelper.etim();
    const weth = await poolHelper.weth();
    const owner = await poolHelper.owner();
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
