const { ethers } = require("hardhat");

async function main() {
    // await deploy();
    // await addLiquidity();
    // await updateDailyPrice();
}

async function deploy() {
    // BSC Testnet addresses (需要确认 PancakeSwap V4 是否已部署)
    // 如果 V4 未部署，需要先部署 Vault 和 CLPoolManager

    const VAULT_ADDRESS = "";           // TODO: PancakeSwap V4 Vault on BSC Testnet
    const CL_POOL_MANAGER_ADDRESS = ""; // TODO: PancakeSwap V4 CLPoolManager on BSC Testnet
    const WETH_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";  // WBNB on BSC Testnet (作为 ETH 等价物)
    const USDC_ADDRESS = "0x64544969ed7EBf5f083679233325356EbE738930";  // USDC on BSC Testnet (如有)
    const CHAINLINK_ETH_USD = "0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526"; // BNB/USD on BSC Testnet
    const PANCAKE_ROUTER_V2 = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1"; // PancakeSwap V2 Router on BSC Testnet
    const WBNB_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";   // WBNB on BSC Testnet
    const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C"; // 需确认 testnet 是否已部署

    const [deployer] = await ethers.getSigners();

    // 测试用的钱包地址 (使用部署者地址)
    const marketInfra    = { address: deployer.address };
    const ecoFund        = { address: deployer.address };
    const communityFund  = { address: deployer.address };
    const airdrop        = { address: deployer.address };
    const bnbFoundation  = { address: deployer.address };

    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

    // 检查 PancakeSwap V4 地址
    if (!VAULT_ADDRESS || !CL_POOL_MANAGER_ADDRESS) {
        console.log("\n⚠️  警告: PancakeSwap V4 地址未配置!");
        console.log("请先确认 PancakeSwap V4 是否已部署在 BSC Testnet 上。");
        console.log("如果未部署，需要先部署以下合约:");
        console.log("  - Vault");
        console.log("  - CLPoolManager");
        console.log("\n或者使用 local fork 测试。");
        return;
    }

    // 检查 CREATE2 Factory
    const create2Code = await ethers.provider.getCode(CREATE2_FACTORY);
    if (create2Code === "0x") {
        console.log("\n⚠️  警告: CREATE2 Factory 未部署在 BSC Testnet!");
        console.log("地址: " + CREATE2_FACTORY);
        console.log("请先部署 CREATE2 Factory 或使用其他方式部署 Hook。");
        return;
    }

    // ========== 搜索满足 Hook flags 的 CREATE2 salt ==========
    // Hook flags: beforeSwap (bit 6) + beforeSwapReturnDelta (bit 10) = 0x0440
    console.log("\n🔍 搜索满足 Hook flags 的 CREATE2 salt...");
    const hookFactory = await ethers.getContractFactory("ETIMTaxHook");
    const initCode = hookFactory.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256"],
        [CL_POOL_MANAGER_ADDRESS, deployer.address, 300, 300]  // 3% buy/sell tax
    ).slice(2);
    const initCodeHash = ethers.keccak256(initCode);

    let foundSalt = null;
    let hookAddress = null;

    for (let salt = 51586n; salt < 1000000n; salt++) {
        const saltHex = ethers.zeroPadValue(ethers.toBeHex(salt), 32);
        const predicted = ethers.getCreate2Address(CREATE2_FACTORY, saltHex, initCodeHash);
        if ((BigInt(predicted) & 0x3FFFn) === 0x0440n) {
            const existingCode = await ethers.provider.getCode(predicted);
            if (existingCode !== "0x") {
                continue;
            }
            foundSalt = salt;
            hookAddress = predicted;
            console.log("\t✅ 找到 salt:", salt.toString());
            console.log("\t✅ Hook 地址:", predicted);
            break;
        }
    }
    if (!foundSalt) throw new Error("未找到有效的 salt");

    // ========== 部署ETIM代币合约 ==========
    console.log("\n🆗. 部署ETIM代币合约...");
    const ETIMToken = await ethers.getContractFactory("ETIMToken");
    const etimToken = await ETIMToken.deploy("ETIM Token", "ETIM");
    await etimToken.waitForDeployment();
    const etimTokenAddress = await etimToken.getAddress();
    console.log("ETIM代币合约地址:", etimTokenAddress);

    // ========== 部署节点NFT合约 ==========
    console.log("\n🆗. 部署节点NFT合约...");
    const ETIMNode = await ethers.getContractFactory("ETIMNode");
    const etimNode = await ETIMNode.deploy();
    await etimNode.waitForDeployment();
    const etimNodeAddress = await etimNode.getAddress();
    console.log("节点合约地址:", etimNodeAddress);

    // ========== 部署税收HOOK合约 ==========
    console.log("\n🆗. 部署税收HOOK合约...");
    const saltHex = ethers.zeroPadValue(ethers.toBeHex(foundSalt), 32);
    const deployData = ethers.concat([
        saltHex,
        ethers.getBytes(initCode)
    ]);
    let tx = await deployer.sendTransaction({
        to: CREATE2_FACTORY,
        data: deployData,
        gasLimit: 8000000
    });
    await tx.wait();
    console.log("税收HOOK合约:", hookAddress);
    const etimHook = await ethers.getContractAt("ETIMTaxHook", hookAddress);
    console.log("税收HOOK合约验证 buyTaxBps:", await etimHook.buyTaxBps());
    console.log("税收HOOK合约验证 sellTaxBps:", await etimHook.sellTaxBps());

    // ========== 部署WETH/ETIM代币池合约 ==========
    console.log("\n🆗. 部署WETH/ETIM代币池合约...");
    const ETIMPool = await ethers.getContractFactory("ETIMPoolHelper");
    const etimPool = await ETIMPool.deploy(
        VAULT_ADDRESS,
        CL_POOL_MANAGER_ADDRESS,
        WETH_ADDRESS,
        etimTokenAddress,
        USDC_ADDRESS,
        hookAddress,
        CHAINLINK_ETH_USD,
    );
    await etimPool.waitForDeployment();
    const etimPoolAddress = await etimPool.getAddress();
    console.log("池子HELPER合约地址:", etimPoolAddress);

    // ========== 部署主合约 ==========
    console.log("\n🆗. 部署ETIM主合约...");
    const ETIMMain = await ethers.getContractFactory("ETIMMain");
    const etimMain = await ETIMMain.deploy(
        etimTokenAddress,
        WETH_ADDRESS,
        etimNodeAddress,
        etimPoolAddress,
        hookAddress,
        PANCAKE_ROUTER_V2,
        WBNB_ADDRESS,
    );
    await etimMain.waitForDeployment();
    const etimMainAddress = await etimMain.getAddress();
    console.log("主合约地址:", etimMainAddress);

    // ========== 分配代币（总量 100,000,000 ETIM）==========
    console.log("\n🆗. 分配代币...");
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("87900000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(marketInfra.address, ethers.parseEther("5000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(ecoFund.address, ethers.parseEther("1000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(communityFund.address, ethers.parseEther("1000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(airdrop.address, ethers.parseEther("5000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(bnbFoundation.address, ethers.parseEther("100000"));
    await tx.wait();

    console.log("代币分配 growthPool(Main):", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币分配 marketInfra     :", ethers.formatEther(await etimToken.balanceOf(marketInfra.address)), "ETIM");
    console.log("代币分配 ecoFund         :", ethers.formatEther(await etimToken.balanceOf(ecoFund.address)), "ETIM");
    console.log("代币分配 communityFund   :", ethers.formatEther(await etimToken.balanceOf(communityFund.address)), "ETIM");
    console.log("代币分配 airdrop         :", ethers.formatEther(await etimToken.balanceOf(airdrop.address)), "ETIM");
    console.log("代币分配 bnbFoundation   :", ethers.formatEther(await etimToken.balanceOf(bnbFoundation.address)), "ETIM");

    // ========== 设置合约间依赖关系 ==========
    console.log("\n🆗. 设置合约间依赖关系...");

    tx = await etimToken.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【代币合约】设置main合约");

    tx = await etimPool.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【池子HELPER合约】设置main合约");

    // 初始化池子价格: sqrtPriceX96 = sqrt(price) * 2^96
    const sqrtBigInt = (n) => {
        if (n === 0n) return 0n;
        const bits = n.toString(2).length;
        let x = 1n << BigInt(Math.ceil(bits / 2));
        let prev;
        do { prev = x; x = (x + n / x) / 2n; } while (x < prev);
        return prev;
    };
    const Q96 = 2n ** 96n;
    const priceEtimPerEth = 500000n; // 1 ETH = 500000 ETIM
    const sqrtPriceX96 = sqrtBigInt(priceEtimPerEth * Q96 * Q96);
    tx = await etimPool.initializePool(sqrtPriceX96);
    await tx.wait();
    console.log("【池子HELPER合约】初始化池子价格WETH/ETIM");
    console.log("【池子HELPER合约】ETIM per ETH:", ethers.formatEther(await etimPool.getEtimPerEth()));
    console.log("【池子HELPER合约】USDC per ETH:", ethers.formatUnits(await etimPool.getUsdcPerEth(), 6));
    console.log("【池子HELPER合约】池子内WETH余量:", ethers.formatEther(await etimPool.getEthReserves()));

    console.log("【池子HOOK合约】设置不收税白名单", etimPoolAddress);
    tx = await etimHook.setExempt(etimPoolAddress, true);
    await tx.wait();
    console.log("【池子HOOK合约】设置Token合约", etimTokenAddress);
    tx = await etimHook.setTokenContract(etimTokenAddress);
    await tx.wait();
    console.log("【池子HOOK合约】设置main合约", etimMainAddress);
    tx = await etimHook.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【池子HOOK合约】设置WETH地址", WETH_ADDRESS);
    tx = await etimHook.setWethAddress(WETH_ADDRESS);
    await tx.wait();

    // ========== 部署总结 ==========
    console.log("\n" + "=".repeat(60));
    console.log("BSC Testnet 部署完成！合约地址汇总:");
    console.log("=".repeat(60));
    console.log("ETIMToken      :", etimTokenAddress);
    console.log("ETIMNode       :", etimNodeAddress);
    console.log("ETIMTaxHook    :", hookAddress);
    console.log("ETIMPoolHelper :", etimPoolAddress);
    console.log("ETIMMain       :", etimMainAddress);
    console.log("=".repeat(60));
}

async function addLiquidity() {
    console.log("添加流动性 ETIM/WETH...");

    const [deployer] = await ethers.getSigners();
    const WETH_ADDRESS = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd";

    const ETIMTokenAddress = ""; // 替换为实际地址
    const ETIMPoolAddress = ""; // 替换为实际地址
    const etimPool = await ethers.getContractAt("ETIMPoolHelper", ETIMPoolAddress);
    const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);
    const weth = await ethers.getContractAt("IERC20", WETH_ADDRESS);

    let tx = await etimToken.connect(deployer).approve(ETIMPoolAddress, ethers.MaxInt256);
    await tx.wait();
    tx = await weth.connect(deployer).approve(ETIMPoolAddress, ethers.MaxInt256);
    await tx.wait();

    const ethAmount = ethers.parseEther("0.1");
    const etimAmount = ethers.parseEther("50000"); // 1 ETH = 500000 ETIM
    tx = await etimPool.connect(deployer).addLiquidity(ethAmount, etimAmount);
    await tx.wait();

    console.log("🆗流动性添加完成");
}

async function updateDailyPrice() {
    console.log("更新每日价格...");

    const [deployer] = await ethers.getSigners();

    const ETIMMainAddress = ""; // 替换为实际地址
    const etimMain = await ethers.getContractAt("ETIMMain", ETIMMainAddress);

    let tx = await etimMain.connect(deployer).updateDailyPrice();
    await tx.wait();

    console.log("🆗每日价格更新完成");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
