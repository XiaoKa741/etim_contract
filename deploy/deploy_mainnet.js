const { ethers } = require("hardhat");

async function main() {
    // await deploy();
    // await addLiquidity();
    // await updateDailyPrice();
}

async function deploy() {
    // ETH Mainnet addresses
    const USDC_ADDRESS = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const POOL_MANAGER_ADDRESS = "0x000000000004444c5dc75cB358380D2e3dE08A90";
    const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
    const CHAINLINK_ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

    // sepolia 测试网地址
    // const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
    // const POOL_MANAGER_ADDRESS = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    // const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
    // const CHAINLINK_ETH_USD = "0x694AA1769357215DE4FAC081bf1f309aDC325306";

    const [deployer] = await ethers.getSigners();

    const marketInfra = { address: "0xa9489529b893c13fa923e45d4c6cb20c913361d4" };  // 5% 市场基础设施 Market Infra
    const ecoFund = { address: "0x63BFB46f71757C23ef4352096800D9b916225c10" };      // 1% 生态建设基金
    const communityFund = { address: "0x3ed13128637f879858cF226ab1ca245C2F8B8eE3" };    // 1% 社区建设
    const airdrop = { address: "0xE2f8245BddA6d8F1AB49d75dA6960F2cD1a3Bc13" };    // 5% 空投 Airdrop
    const ethFoundation = { address: "0x9fc3dc011b461664c835f2527fffb1169b3c213e" };   // 0.1% 以太坊基金会

    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

    let code = await ethers.provider.getCode(POOL_MANAGER_ADDRESS);
    if (code === "0x") throw new Error("错误：POOL_MANAGER 不存在");
    code = await ethers.provider.getCode(CREATE2_FACTORY);
    if (code === "0x") throw new Error("错误：CREATE2_FACTORY 不存在");

    // Hook flags: afterSwap(bit6=0x40) + afterSwapReturnDelta(bit2=0x04) = 0x0044
    // beforeSwap(bit7=0x80) + beforeSwapReturnsDelta(bit3=0x08) = 0x0088
    // 合计: 0x00CC
    const hookFactory = await ethers.getContractFactory("ETIMTaxHook");
    const initCode = hookFactory.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256"],
        [POOL_MANAGER_ADDRESS, deployer.address, 300, 300]  // 3% buy/sell tax
    ).slice(2);
    const initCodeHash = ethers.keccak256(initCode);

    let foundSalt = null;
    let hookAddress = null;

    console.log("\n🔍 搜索满足 Hook flags 的 CREATE2 salt...");
    for (let salt = 0n; salt < 1000000n; salt++) {
        if (salt % 10000n === 0n) console.log("\t搜索进度:", salt.toString());
        const saltHex = ethers.zeroPadValue(ethers.toBeHex(salt), 32);
        const predicted = ethers.getCreate2Address(CREATE2_FACTORY, saltHex, initCodeHash);
        if ((BigInt(predicted) & 0x3FFFn) === 0x00CCn) {
            const existingCode = await ethers.provider.getCode(predicted);
            if (existingCode !== "0x") {
                continue;  // 地址已被占用，继续搜索
            }
            foundSalt = salt;
            hookAddress = predicted;
            console.log("\t✅ 找到 salt:", salt.toString());
            console.log("\t✅ Hook 地址:", predicted);
            break;
        }
    }
    if (!foundSalt) throw new Error("未找到有效的 salt");

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

    // ========== 部署ETIM代币合约 ==========
    console.log("\n🆗. 部署ETIM代币合约...");
    const ETIMToken = await ethers.getContractFactory("ETIMToken");
    const etimToken = await ETIMToken.deploy("ETIM Token", "ETIM");
    await etimToken.waitForDeployment();
    const etimTokenAddress = await etimToken.getAddress();
    console.log("ETIM代币合约地址:", etimTokenAddress);

    // ========== 部署节点合约 ==========
    // console.log("\n🆗. 部署节点NFT合约...");
    // const ETIMNode = await ethers.getContractFactory("ETIMNode");
    // const etimNode = await ETIMNode.deploy();
    // await etimNode.waitForDeployment();
    // const etimNodeAddress = await etimNode.getAddress();
    // console.log("节点合约地址:", etimNodeAddress);
    const etimNodeAddress = "0x2461EefbbA0f312a0a22b5ED9F0b18FAc3292CCb";
    console.log("\n🆗. 节点NFT合约【已部署】...");


    // ========== 部署税收HOOK合约 ==========
    console.log("\n🆗. 部署税收HOOK合约...");
    const saltHex = ethers.zeroPadValue(ethers.toBeHex(foundSalt), 32);
    const deployData = ethers.concat([
        saltHex,
        ethers.getBytes(initCode)
    ]);
    let tx = await deployer.sendTransaction({
        to: CREATE2_FACTORY,
        data: deployData
    });
    await tx.wait();
    console.log("税收HOOK合约:", hookAddress);
    const etimHook = await ethers.getContractAt("ETIMTaxHook", hookAddress);
    console.log("税收HOOK合约验证 buyTaxBps:", await etimHook.buyTaxBps());
    console.log("税收HOOK合约验证 sellTaxBps:", await etimHook.sellTaxBps());

    // ========== 部署ETH/ETIM代币池合约 ==========
    console.log("\n🆗. 部署ETH/ETIM代币池合约...");
    const ETIMPool = await ethers.getContractFactory("ETIMPoolHelper");
    const etimPool = await ETIMPool.deploy(
        POOL_MANAGER_ADDRESS,
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
        etimNodeAddress,
        etimPoolAddress,
        hookAddress,
    );
    await etimMain.waitForDeployment();
    const etimMainAddress = await etimMain.getAddress();
    console.log("主合约地址:", etimMainAddress);

    // ========== 分配代币（总量 100,000,000 ETIM）==========
    console.log("\n🆗. 分配代币...");
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("87900000")); // 87.9% Growth Pool
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(marketInfra.address, ethers.parseEther("5000000"));  // 5% Market Infra
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(ecoFund.address, ethers.parseEther("1000000"));  // 1% 生态建设基金
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(communityFund.address, ethers.parseEther("1000000"));  // 1% 社区建设
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(airdrop.address, ethers.parseEther("5000000"));  // 5% 空投
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(ethFoundation.address, ethers.parseEther("100000"));   // 0.1% 以太坊基金会
    await tx.wait();

    console.log("代币分配 growthPool(Main):", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币分配 marketInfra     :", ethers.formatEther(await etimToken.balanceOf(marketInfra.address)), "ETIM");
    console.log("代币分配 ecoFund         :", ethers.formatEther(await etimToken.balanceOf(ecoFund.address)), "ETIM");
    console.log("代币分配 communityFund   :", ethers.formatEther(await etimToken.balanceOf(communityFund.address)), "ETIM");
    console.log("代币分配 airdrop         :", ethers.formatEther(await etimToken.balanceOf(airdrop.address)), "ETIM");
    console.log("代币分配 ethFoundation   :", ethers.formatEther(await etimToken.balanceOf(ethFoundation.address)), "ETIM");

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
    const priceEtimPerEth = 500000n; // 1ETH = 500000ETIM
    const sqrtPriceX96 = sqrtBigInt(priceEtimPerEth * Q96 * Q96);
    tx = await etimPool.initializePool(sqrtPriceX96);
    await tx.wait();
    console.log("【池子HELPER合约】初始化池子价格ETH/ETIM");
    console.log("【池子HELPER合约】ETIM per ETH:", ethers.formatEther(await etimPool.getEtimPerEth()));
    console.log("【池子HELPER合约】USDC per ETH:", ethers.formatUnits(await etimPool.getUsdcPerEth(), 6));
    console.log("【池子HELPER合约】池子内ETH余量:", ethers.formatEther(await etimPool.getEthReserves()));

    console.log("【池子HOOK合约】设置不收税白名单", etimPoolAddress);
    tx = await etimHook.setExempt(etimPoolAddress, true);
    await tx.wait();
    console.log("【池子HOOK合约】设置Token合约", etimTokenAddress);
    tx = await etimHook.setTokenContract(etimTokenAddress);
    await tx.wait();
    console.log("【池子HOOK合约】设置main合约", etimMainAddress);
    tx = await etimHook.setMainContract(etimMainAddress);
    await tx.wait();

    // ========== 部署总结 ==========
    console.log("\n" + "=".repeat(60));
    console.log("部署完成！合约地址汇总:");
    console.log("=".repeat(60));
    console.log("ETIMToken      :", etimTokenAddress);
    console.log("ETIMNode       :", etimNodeAddress);
    console.log("ETIMTaxHook    :", hookAddress);
    console.log("ETIMPoolHelper :", etimPoolAddress);
    console.log("ETIMMain       :", etimMainAddress);
    console.log("=".repeat(60));
}

async function addLiquidity() {
    console.log("添加流动性 ETIM/ETH...");

    const [deployer] = await ethers.getSigners();

    const ETIMTokenAddress = ""; // 替换为实际地址
    const ETIMPoolAddress = ""; // 替换为实际地址
    const etimPool = await ethers.getContractAt("ETIMPoolHelper", ETIMPoolAddress);
    const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);

    let tx = await etimToken.connect(deployer).approve(ETIMPoolAddress, ethers.MaxInt256);
    await tx.wait();

    const ethAmount = ethers.parseEther("0.1");
    const etimAmount = ethers.parseEther("100");
    tx = await etimPool.connect(deployer).addLiquidity(ethAmount, etimAmount, { value: ethAmount });
    await tx.wait();

    console.log("🆗流动性添加完成");
}

async function updateDailyPrice() {
    console.log("更新每日价格...");

    const [deployer] = await ethers.getSigners();

    const ETIMMainAddress = ""; // 替换为实际地址
    const etimMain = await ethers.getContractAt("ETIMMain", ETIMMainAddress);

    tx = await etimMain.connect(deployer).updateDailyPrice();
    await tx.wait();

    console.log("🆗每日价格更新完成");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });