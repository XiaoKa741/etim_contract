const { ethers } = require("hardhat");

async function main() {
    const USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
    const POOL_MANAGER_ADDRESS = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
    const CREATE2_FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C";

    const [deployer, deployer1] = await ethers.getSigners();
    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

    let code = await ethers.provider.getCode(POOL_MANAGER_ADDRESS);
    if (code === "0x") throw new Error("错误：你 Fork 的网络中找不到 POOL_MANAGER");
    code = await ethers.provider.getCode(CREATE2_FACTORY);
    if (code === "0x") throw new Error("错误：你 Fork 的网络中找不到 CREATE2_FACTORY");

    // afterSwap(bit6=0x40) + afterSwapReturnDelta(bit2=0x04) = 0x0044
    // beforeSwap(bit7=0x80) + beforeSwapReturnsDelta(bit3=0x08) =0x0088
    // 用找到的 salt 通过 CREATE2 工厂部署
    // 搜索满足条件的 salt
    const hookFactory = await ethers.getContractFactory("ETIMTaxHook");
    const initCode = hookFactory.bytecode + ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "address", "uint256", "uint256"],
        [POOL_MANAGER_ADDRESS, deployer.address, 300, 300]
    ).slice(2);
    const initCodeHash = ethers.keccak256(initCode);

    let foundSalt = null;
    let hookAddress = null;

    for (let salt = 0n; salt < 1000000n; salt++) {
        console.log("\t:", salt.toString())
        const saltHex = ethers.zeroPadValue(ethers.toBeHex(salt), 32);
        const predicted = ethers.getCreate2Address(CREATE2_FACTORY, saltHex, initCodeHash);
        if ((BigInt(predicted) & 0x3FFFn) === 0x00CCn) {
            foundSalt = salt;
            hookAddress = predicted;

            const existingCode = await ethers.provider.getCode(hookAddress)
            if (existingCode !== "0x") {
                continue;
            }
            console.log("\tfound salt:", salt.toString())
            console.log("\thook address:", predicted)
            break;
        }
    }
    if (!foundSalt) throw new Error("No valid salt found");

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

    // ========== 部署ETIM代币合约 ==========
    console.log("\n🆗. 部署ETIM代币合约...");
    const ETIMToken = await ethers.getContractFactory("ETIMToken");

    // 代币参数
    const etimToken = await ETIMToken.deploy("ETIM Token", "ETIM");
    await etimToken.waitForDeployment();
    const etimTokenAddress = await etimToken.getAddress();
    console.log("ETIM代币合约地址:", etimTokenAddress);

    // ========== 部署节点合约 ==========
    console.log("\n🆗. 部署节点NFT合约...");
    const ETIMNode = await ethers.getContractFactory("ETIMNode");

    const etimNode = await ETIMNode.deploy();
    await etimNode.waitForDeployment();
    const etimNodeAddress = await etimNode.getAddress();
    console.log("节点合约地址:", etimNodeAddress);

    // ========== 税收HOOK ==========
    console.log("\n🆗. 部署税收HOOK合约...");
    // Hardhat 本地 fork 可以直接用这个确定性工厂地址（主网/fork 都有）
    const saltHex = ethers.zeroPadValue(ethers.toBeHex(foundSalt), 32);
    const deployData = ethers.concat([
        saltHex,               // bytes32 salt
        ethers.getBytes(initCode)  // initCode as bytes
    ]);
    let tx = await deployer.sendTransaction({
        to: CREATE2_FACTORY,
        data: deployData,
        gasLimit: 8000000
    });
    await tx.wait()
    console.log("税收HOOK合约:", hookAddress);
    const etimHook = await ethers.getContractAt("ETIMTaxHook", hookAddress)
    console.log("税收HOOK合约验证 buyTaxBps:", await etimHook.buyTaxBps())
    console.log("税收HOOK合约验证 sellTaxBps:", await etimHook.sellTaxBps())

    // ========== 部署ETH/ETIM代币池合约 ==========
    console.log("\n🆗. 部署ETH/ETIM代币池合约...");
    const ETIMPool = await ethers.getContractFactory("ETIMPoolHelper");
    const etimPool = await ETIMPool.deploy(
        POOL_MANAGER_ADDRESS,
        etimTokenAddress,
        USDC_ADDRESS,
        hookAddress,
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

    // ========== 分配代币 ==========
    console.log("\n🆗. 分配代币...");
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("192570000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("105000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("21000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("21000000"));
    await tx.wait();
    // tx = await etimToken.connect(deployer).transfer(deployer.address, ethers.parseEther("21000000"));
    // await tx.wait();
    tx = await etimToken.connect(deployer).transfer(deployer1.address, ethers.parseEther("6300000"));
    await tx.wait();

    console.log("代币总量 grouthPool(Main):", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币总量 marketInfra:", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币总量 ecoFund:", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币总量 communityFund:", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币总量 airdrop:", ethers.formatEther(await etimToken.balanceOf(deployer.address)), "ETIM");
    console.log("代币总量 ethFoundation:", ethers.formatEther(await etimToken.balanceOf(deployer1.address)), "ETIM");

    // ========== 设置合约间依赖关系 ==========
    console.log("\n🆗. 设置合约间依赖关系...");

    // 设置代币合约关联合约地址
    tx = await etimToken.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【代币合约】设置main合约");

    tx = await etimPool.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【池子HELPER合约】设置main合约");

    // 用纯 BigInt 整数算法避免浮点精度丢失
    // sqrtPriceX96 = sqrt(price) * 2^96 = sqrt(price * 2^192)
    const sqrtBigInt = (n) => {
        if (n === 0n) return 0n;
        const bits = n.toString(2).length;
        let x = 1n << BigInt(Math.ceil(bits / 2));
        let prev;
        do { prev = x; x = (x + n / x) / 2n; } while (x < prev);
        return prev;
    };
    const Q96 = 2n ** 96n;
    const priceEtimPerEth = 2000n; // 1ETH = 2000ETIM
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
    console.log("【池子HOOK合约】设置Token合约", etimPoolAddress);
    tx = await etimHook.setTokenContract(etimTokenAddress);
    await tx.wait();
    console.log("【池子HOOK合约】设置main合约", etimMainAddress);
    tx = await etimHook.setMainContract(etimMainAddress);
    await tx.wait();

    console.log("【池子HELPER合约】添加初始流动性 ETIM/ETH");
    const ethAmount = ethers.parseEther("0.2");
    const etimAmount = ethers.parseEther("400");
    // approve
    tx = await etimToken.connect(deployer).approve(etimPoolAddress, ethers.MaxInt256);
    await tx.wait();
    tx = await etimPool.addLiquidity(ethAmount, etimAmount, { value: ethAmount });
    await tx.wait();

    console.log("【主合约】更新代币价格");
    tx = await etimMain.updateDailyPrice();
    await tx.wait();
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });