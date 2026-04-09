const { ethers, upgrades } = require("hardhat");

async function main() {
    // await deploy();
    // await addLiquidity();
    // await updateDailyPrice();
}

async function deploy() {
    // BSC Mainnet addresses
    const VAULT_ADDRESS           = "0x238a358808379702088667322f80aC48bAd5e6c4";
    const CL_POOL_MANAGER_ADDRESS = "0xa0FfB9c1CE1Fe56963B0321B32E7A0302114058b";
    const WETH_ADDRESS            = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8"; // BSC bridged ETH
    const USDC_ADDRESS            = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"; // BSC USDC
    const CHAINLINK_ETH_USD       = "0x9ef1B8c0E4F7dc8bF5719Ea496883DC6401d5b2e"; // ETH/USD on BSC
    const PANCAKE_ROUTER_V2       = "0x10ED43C718714eb63d5aA57B78B54704E256024E"; // PancakeSwap V2 Router
    const WBNB_ADDRESS            = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"; // WBNB on BSC
    const CREATE2_FACTORY         = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

    const [deployer] = await ethers.getSigners();

    const marketInfra    = { address: "0xa9489529b893c13fa923e45d4c6cb20c913361d4" };
    const ecoFund        = { address: "0x63BFB46f71757C23ef4352096800D9b916225c10" };
    const communityFund  = { address: "0x3ed13128637f879858cF226ab1ca245C2F8B8eE3" };
    const airdrop        = { address: "0xE2f8245BddA6d8F1AB49d75dA6960F2cD1a3Bc13" };
    const bnbFoundation  = { address: "0x9fc3dc011b461664c835f2527fffb1169b3c213e" };

    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "BNB");

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

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
    const etimToken = await ETIMToken.deploy("ETIM", "ETIM");
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

    // ========== 部署WETH/ETIM代币池合约 (UUPS Proxy) ==========
    console.log("\n🆗. 部署WETH/ETIM代币池合约 (UUPS Proxy)...");
    const ETIMPool = await ethers.getContractFactory("ETIMPoolHelper");
    const etimPool = await upgrades.deployProxy(ETIMPool, [hookAddress], {
        kind: 'uups',
        constructorArgs: [
            VAULT_ADDRESS,
            CL_POOL_MANAGER_ADDRESS,
            WETH_ADDRESS,
            etimTokenAddress,
            USDC_ADDRESS,
            CHAINLINK_ETH_USD,
        ],
        unsafeAllow: ['constructor', 'state-variable-immutable'],
    });
    await etimPool.waitForDeployment();
    const etimPoolAddress = await etimPool.getAddress();
    console.log("池子HELPER合约地址 (Proxy):", etimPoolAddress);

    // ========== 部署主合约 (UUPS Proxy) ==========
    console.log("\n🆗. 部署ETIM主合约 (UUPS Proxy)...");
    const ETIMMain = await ethers.getContractFactory("ETIMMain");
    const etimMain = await upgrades.deployProxy(ETIMMain, [
        etimTokenAddress,
        WETH_ADDRESS,
        etimNodeAddress,
        etimPoolAddress,
        hookAddress,
        PANCAKE_ROUTER_V2,
        WBNB_ADDRESS,
    ], { kind: 'uups' });
    await etimMain.waitForDeployment();
    const etimMainAddress = await etimMain.getAddress();
    console.log("主合约地址 (Proxy):", etimMainAddress);

    // ========== 分配代币（总量 100,000,000 ETIM）==========
    console.log("\n🆗. 分配代币...");
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("84900000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(marketInfra.address, ethers.parseEther("5000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(ecoFund.address, ethers.parseEther("1000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(communityFund.address, ethers.parseEther("4000000"));
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
    // sqrtPriceX96 = sqrt(token1/token0) * 2^96
    // If WETH < ETIM (address order): currency0=WETH, currency1=ETIM, price=ETIM/WETH=500000
    // If ETIM < WETH (address order): currency0=ETIM, currency1=WETH, price=WETH/ETIM=1/500000
    const wethAddr = BigInt(WETH_ADDRESS);
    const etimAddr = BigInt(etimTokenAddress);
    const sqrtPriceX96 = wethAddr < etimAddr ? sqrtBigInt(priceEtimPerEth * Q96 * Q96) : sqrtBigInt(Q96 * Q96 / priceEtimPerEth);
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
    console.log("BSC 部署完成！合约地址汇总:");
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
    const WETH_ADDRESS = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";

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
    const etimAmount = ethers.parseEther("100");
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
