const { ethers } = require("hardhat");
const { getWETHContract } = require("./util");

async function main() {
    // weth contract
    const weth = await getWETHContract();
    const usdcAddress = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
    const poolManagerAddress = "0x000000000004444c5dc75cB358380D2e3dE08A90";
    // const positionManagerAddress = "0xbD216513d74C8cf14cf4747E6AaA6420FF64ee9e";

    const [deployer, marketInfra, ecoFund, communityFund, airdrop, ethFoundation, t1, t2, t3, t4, t5, t6] = await ethers.getSigners();
    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH", ethers.formatEther(await weth.balanceOf(deployer.address)), "WETH");

    let code = await ethers.provider.getCode(poolManagerAddress);
    if (code === "0x") {
        console.error("错误：你 Fork 的网络中找不到 PoolManager！");
    }

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

    // ========== 1. 部署ETIM代币合约 ==========
    console.log("\n1. 部署ETIM代币合约...");
    const ETIMToken = await ethers.getContractFactory("ETIMToken");

    // 代币参数
    const etimToken = await ETIMToken.deploy();
    await etimToken.waitForDeployment();
    const etimTokenAddress = await etimToken.getAddress();
    console.log("ETIM代币合约地址:", etimTokenAddress);

    // ========== 2. 部署节点合约 ==========
    console.log("\n2. 部署节点NFT合约...");
    const ETIMNode = await ethers.getContractFactory("ETIMNode");

    const etimNode = await ETIMNode.deploy();
    await etimNode.waitForDeployment();
    const etimNodeAddress = await etimNode.getAddress();
    console.log("节点合约地址:", etimNodeAddress);

    // ========== 3. 部署ETH/ETIM代币池合约 ==========
    console.log("\n3. 部署ETH/ETIM代币池合约...");
    const ETIMPool = await ethers.getContractFactory("ETIMPoolManager");
    const etimPool = await ETIMPool.deploy(
        poolManagerAddress,
        etimTokenAddress,
        usdcAddress  
    );
    const etimPoolAddress = await etimPool.getAddress();
    console.log("池子管理合约地址:", etimPoolAddress);

    // ========== 3. 部署主合约 ==========
    console.log("\n4. 部署ETIM主合约...");
    const ETIMMain = await ethers.getContractFactory("ETIMMain");

    const etimMain = await ETIMMain.deploy(
        etimTokenAddress,
        etimNodeAddress,
        etimPoolAddress,
    );
    await etimMain.waitForDeployment();
    const etimMainAddress = await etimMain.getAddress();
    console.log("主合约地址:", etimMainAddress);

    // ========== 4. 分配代币 ==========
    console.log("\n4. 分配代币...");
    // let tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("1925700000"));
    let tx = await etimToken.connect(deployer).transfer(etimMainAddress, ethers.parseEther("192570000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(marketInfra.address, ethers.parseEther("105000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(ecoFund.address, ethers.parseEther("21000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(communityFund.address, ethers.parseEther("21000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(airdrop.address, ethers.parseEther("21000000"));
    await tx.wait();
    tx = await etimToken.connect(deployer).transfer(ethFoundation.address, ethers.parseEther("6300000"));
    await tx.wait();
    
    console.log("代币总量 grouthPool(Main):", ethers.formatEther(await etimToken.balanceOf(etimMainAddress)), "ETIM");
    console.log("代币总量 marketInfra:", ethers.formatEther(await etimToken.balanceOf(marketInfra.address)), "ETIM");
    console.log("代币总量 ecoFund:", ethers.formatEther(await etimToken.balanceOf(ecoFund.address)), "ETIM");
    console.log("代币总量 communityFund:", ethers.formatEther(await etimToken.balanceOf(communityFund.address)), "ETIM");
    console.log("代币总量 airdrop:", ethers.formatEther(await etimToken.balanceOf(airdrop.address)), "ETIM");
    console.log("代币总量 ethFoundation:", ethers.formatEther(await etimToken.balanceOf(ethFoundation.address)), "ETIM");

    // ========== 5. 设置合约间依赖关系 ==========
    console.log("\n5. 设置合约间依赖关系...");

    // 设置代币合约关联合约地址
    tx = await etimToken.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【代币合约】设置主合约地址");

    tx = await etimPool.setMainContract(etimMainAddress);
    await tx.wait();
    console.log("【池子管理合约】设置主合约地址");

    const priceEtimPerEth = 2000; // 1ETH = 2000ETIM
    const sqrtPriceX96 = BigInt(Math.floor(Math.sqrt(priceEtimPerEth) * 2 ** 96));
    tx = await etimPool.initializePool(sqrtPriceX96);
    await tx.wait();
    console.log("【池子管理合约】初始化池子价格ETH/ETIM");
    console.log("【池子管理合约】ETIM per ETH:", ethers.formatEther(await etimPool.getPriceEtimPerEth()));
    console.log("【池子管理合约】USDC per ETH:", ethers.formatUnits(await etimPool.getPriceUsdcPerEth(), 6));
    console.log("【池子管理合约】池子内ETH余量:", ethers.formatEther(await etimPool.getEthReserves()));

    console.log("【主合约】更新代币价格");
    tx = await etimMain.updateDailyPrice();
    await tx.wait();

    // console.log("【主合约】池子添加流动性 ETIM/ETH");
    // await injectEthEtimToPool(positionManagerAddress, etimTokenAddress);
}

async function transferWethEtimToken(user, etimTokenAddress, etimTokenAmount, wethAmount) {
    const [_, marketInfra] = await ethers.getSigners();
    const weth = await getWETHContract(user);

    const tokenAbi = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address guy) public view returns (uint)",
        "function deposit() public payable",
        "function transfer(address dst, uint wad) public returns (bool)",
    ];
    const etimToken = new ethers.Contract(etimTokenAddress, tokenAbi, marketInfra);

    try {
        let tx = await weth.deposit({ value: wethAmount });
        await tx.wait();
        console.log("发放 WETH 成功!", ethers.formatEther(await weth.balanceOf(user.address)), user.address);

        tx = await etimToken.transfer(user.address, etimTokenAmount);
        await tx.wait();

        console.log("发放 ETIM TOKEN 成功!", ethers.formatEther(await etimToken.balanceOf(user.address)), user.address);
    } catch (error) {
        console.log("转换失败:", error.message);
    }
}

async function injectEthEtimToPool(positionManagerAddress, etimTokenAddress) {
    const [signer] = await ethers.getSigners();

    // ===== 配置 =====
    const POSITION_MANAGER_ADDRESS = positionManagerAddress; // 替换为实际 PositionManager 地址
    const ETIM_TOKEN_ADDRESS = etimTokenAddress;       // ETIM 代币地址
    const ETIM_DECIMALS = 18;

    // PoolKey 参数（必须和 initialize 时一致！）
    const CURRENCY0 = "0x0000000000000000000000000000000000000000"; // ETH
    const CURRENCY1 = ETIM_TOKEN_ADDRESS;                           // ETIM
    const FEE = 3000;        // 0.3%
    const TICK_SPACING = 60; // 必须匹配初始化时的 tickSpacing
    const HOOKS = "0x0000000000000000000000000000000000000000";    // 无 hooks

    const ETH_AMOUNT = ethers.parseEther("1");
    const ETIM_AMOUNT = ethers.parseUnits("2000", ETIM_DECIMALS);

    // ===== 获取合约 =====
    const positionManager = await ethers.getContractAt(
        "IPositionManager",
        POSITION_MANAGER_ADDRESS,
        signer
    );
    const etimToken = await ethers.getContractAt("IERC20", ETIM_TOKEN_ADDRESS, signer);

    // ===== 1. 授权 ETIM 给 PositionManager =====
    console.log("🔑 Approving ETIM to PositionManager...");
    // const approveTx = await etimToken.approve(POSITION_MANAGER_ADDRESS, ETIM_AMOUNT);
    const approveTx = await etimToken.approve(POSITION_MANAGER_ADDRESS, ethers.MaxInt256);
    await approveTx.wait();
    console.log("✅ Approved");

    // ===== 2. 构建 PoolKey =====
    const poolKey = {
        currency0: CURRENCY0,
        currency1: CURRENCY1,
        fee: FEE,
        tickSpacing: TICK_SPACING,
        hooks: HOOKS
    };

    // ===== 3. 编码 Actions 和 Params =====
    const Actions = {
        MINT_POSITION: 0x02,
        SETTLE_ALL: 0x0c,
        TAKE_PAIR: 0x11,
        SETTLE_PAIR: 0x0d,
        SWEEP : 0x14
    };

    const actions = ethers.concat([
        ethers.toBeHex(Actions.MINT_POSITION, 1),
        ethers.toBeHex(Actions.SETTLE_PAIR, 1),
        ethers.toBeHex(Actions.SWEEP, 1),
        ethers.toBeHex(Actions.SWEEP, 1),
    ]);

    // const params = [
    //     // MINT_POSITION
    //     ethers.AbiCoder.defaultAbiCoder().encode(
    //         ["tuple(address,address,uint24,int24)"], // PoolKey as tuple
    //         [[CURRENCY0, CURRENCY1, FEE, TICK_SPACING]]
    //     ) +
    //     ethers.zeroPadValue(ethers.toBeHex(TICK_SPACING), 32).slice(2) + // hooks (bytes1)
    //     ethers.zeroPadValue(ethers.toBeHex(-887272), 32).slice(2) +     // tickLower
    //     ethers.zeroPadValue(ethers.toBeHex(887272), 32).slice(2) +      // tickUpper
    //     ethers.zeroPadValue(ETH_AMOUNT.toHexString(), 32).slice(2) +          // amount0Desired
    //     ethers.zeroPadValue(ETIM_AMOUNT.toHexString(), 32).slice(2) +         // amount1Desired
    //     ethers.zeroPadValue((ETH_AMOUNT.mul(95).div(100)).toHexString(), 32).slice(2) + // amount0Min
    //     ethers.zeroPadValue((ETIM_AMOUNT.mul(95).div(100)).toHexString(), 32).slice(2) + // amount1Min
    //     ethers.zeroPadValue(signer.address, 32).slice(2),                    // recipient
    //     // SETTLE_ALL: no params (empty bytes)
    //     "0x"
    // ];

    // 更简单的方式：使用 abi.encode 嵌套
    const paramsEncoded = [
        ethers.AbiCoder.defaultAbiCoder().encode(
            [
                "tuple(address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks)",
                "int24",
                "int24",
                "uint256",
                "uint256",
                "uint256",
                "uint256",
                "address"
            ],
            [
                poolKey,// [CURRENCY0, CURRENCY1, FEE, TICK_SPACING, HOOKS],
                -887272,   // tickLower
                887272,    // tickUpper
                ETH_AMOUNT,
                ETIM_AMOUNT,
                0, //ETH_AMOUNT * BigInt(95) / BigInt(100),
                0, //ETIM_AMOUNT * BigInt(95) / BigInt(100),
                signer.address
            ]
        ),
        // "0x0c" // for SETTLE_ALL
        ethers.AbiCoder.defaultAbiCoder().encode(
            ["address", "address"],
            [CURRENCY0, CURRENCY1]
        )
    ];

    const unlockData = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes", "bytes[]"],
        [actions, paramsEncoded]
    );

    // ===== 4. 调用 modifyLiquidities =====
    console.log("💧 Adding liquidity directly via PositionManager...");
    const tx = await positionManager.modifyLiquidities(
        unlockData,
        Math.floor(Date.now() / 1000) + 600, // 10-minute deadline
        {
            value: ETH_AMOUNT,
            gasLimit: 6000000
        }
    );
    await tx.wait();
    console.log("✅ Liquidity added! NFT minted to your address.");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });