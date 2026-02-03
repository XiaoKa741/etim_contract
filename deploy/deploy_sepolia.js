const { ethers } = require("hardhat");
const { getWETHContract } = require("./util");

async function main() {
    const [deployer, deployer1] = await ethers.getSigners();

    const usdcAddress = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
    // weth contract
    const weth = await getWETHContract(deployer, "0xfff9976782d46cc05630d1f6ebab18b2324d6b14");
    // await wrapETH();

    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH", ethers.formatEther(await weth.balanceOf(deployer.address)), "WETH");

    // Uniswap V2
    const { router, factoryAddress, wethAddress } = await setupUniswapV2Pair();

    // ========== 1. 部署ETIM代币合约 ==========
    console.log("\n1. 部署ETIM代币合约...");
    const ETIMToken = await ethers.getContractFactory("ETIMToken");

    // 代币参数
    const etimToken = await ETIMToken.deploy(deployer1.address, deployer1.address, deployer1.address, deployer1.address);
    await etimToken.waitForDeployment();
    const etimTokenAddress = await etimToken.getAddress();
    console.log("ETIM代币合约地址:", etimTokenAddress);
    console.log("代币总量 合约:", ethers.formatEther(await etimToken.balanceOf(etimTokenAddress)), "ETIM");
    console.log("代币总量 marketInfra:", ethers.formatEther(await etimToken.balanceOf(deployer1.address)), "ETIM");
    console.log("代币总量 ecoFund:", ethers.formatEther(await etimToken.balanceOf(deployer1.address)), "ETIM");
    console.log("代币总量 communityFund:", ethers.formatEther(await etimToken.balanceOf(deployer1.address)), "ETIM");
    console.log("代币总量 ethFoundation:", ethers.formatEther(await etimToken.balanceOf(deployer1.address)), "ETIM");

    // ========== 2. 部署节点合约 ==========
    console.log("\n2. 部署节点NFT合约...");
    const ETIMNode = await ethers.getContractFactory("ETIMNode");

    const etimNode = await ETIMNode.deploy(wethAddress);
    await etimNode.waitForDeployment();
    const etimNodeAddress = await etimNode.getAddress();
    console.log("节点合约地址:", etimNodeAddress);

    // 创建交易对ETIM/WETH
    const pairAddress = await createPairAndAddLiquidity(etimTokenAddress, "ETIM", factoryAddress, wethAddress);
    if (!pairAddress) {
        console.log("\n 创建交易对失败, 退出");
        return;
    }
    console.log("\n交易对地址:", pairAddress, "\n");

    // 添加流动性
    const etimAmount = ethers.parseUnits("2", await etimToken.decimals()); // 1000 个代币
    const wethAmount = ethers.parseEther("0.001"); // 1 WETH
    // 发放WETH、ETIMToken
    await transferWethEtimToken(deployer, etimTokenAddress, ethers.parseEther("5"), ethers.parseEther("0"));
    for (let u of [deployer1]) {
        // await transferWethEtimToken(u, etimTokenAddress, ethers.parseEther("5"), ethers.parseEther("0"));
    }
    // await transferWethEtimToken(deployer, etimTokenAddress, etimAmount, wethAmount);
    await addLiquidityToPair(router, etimTokenAddress, wethAddress, etimAmount, wethAmount);

    // ========== 3. 部署主合约 ==========
    console.log("\n3. 部署ETIM主合约...");
    const ETIMMain = await ethers.getContractFactory("ETIMMain");

    const etimMain = await ETIMMain.deploy(
        etimTokenAddress,
        etimNodeAddress,
        router,
        wethAddress,
        usdcAddress
    );
    await etimMain.waitForDeployment();
    console.log("主合约地址:", await etimMain.getAddress());

    // ========== 4. 设置合约间依赖关系 ==========
    console.log("\n4. 设置合约间依赖关系...");

    // 设置节点合约的主合约地址
    const nodeTx1 = await etimNode.setMainContract(await etimMain.getAddress());
    await nodeTx1.wait();
    console.log("设置节点合约的主合约地址");

    // 设置代币合约的主合约地址
    const tokenTx1 = await etimToken.setMainContract(await etimMain.getAddress());
    await tokenTx1.wait();
    console.log("设置代币合约的主合约地址");

    const updateTx = await etimMain.updateDailyPrice();
    await updateTx.wait();
    console.log("更新主合约代币价格");

    // etim/weth代币授权给main合约
    {
        const tokenAbi = [
            "function approve(address spender, uint256 amount) external returns (bool)",
            "function balanceOf(address guy) public view returns (uint)",
        ];
        const etimToken_ = new ethers.Contract(etimTokenAddress, tokenAbi, deployer);
        try {
            let approveTx = await etimToken_.approve(etimMain.getAddress(), ethers.MaxUint256);
            await approveTx.wait();

            approveTx = await weth.approve(etimMain.getAddress(), ethers.MaxUint256);
            await approveTx.wait();
            console.log("etim/weth代币授权给main成功");
        } catch (e) {
            console.log("etim/weth代币授权给main失败");
        }
    }

    // ========== 5. 初始化代币分配 ==========
    // console.log("\n5. 初始化代币分配...");

    // 分配1%到社区建设（0.21亿）
    // const communityAmount = ethers.parseEther("21000000"); // 0.21亿
    // const communityAddress = deployer.address; // 实际应该是社区多签地址
    // await etimToken.transfer(communityAddress, communityAmount);
    // console.log("分配", ethers.formatEther(communityAmount), "ETIM到社区建设");
}

async function setupUniswapV2Pair() {
    const [deployer] = await ethers.getSigners();

    // Uniswap V2 Router 地址（根据网络选择）
    const UNISWAP_V2_ROUTER_ADDRESS = {
        mainnet: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        goerli: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        hardhat: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
        sepolia: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3",
    };

    // WETH 地址
    const WETH_ADDRESS = {
        mainnet: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        goerli: "0xB4FBF271143F4FBf7B91A5ded31805e42b2208d6",
        hardhat: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" // 假设在 fork 中使用主网地址
    };

    // Router ABI（需要 factory 方法）
    const routerAbi = [
        "function factory() external view returns (address)",
        "function WETH() external view returns (address)",
        "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
        "function addLiquidity(address tokenA, address tokenB, uint amountADesired, uint amountBDesired, uint amountAMin, uint amountBMin, address to, uint deadline) external returns (uint amountA, uint amountB, uint liquidity)",
    ];

    // 创建 Router 合约实例
    const router = new ethers.Contract(
        UNISWAP_V2_ROUTER_ADDRESS.sepolia, // 根据网络选择
        routerAbi,
        deployer
    );

    // 获取 Factory 地址的正确方式
    const factoryAddress = await router.factory();
    console.log("Uniswap V2 Factory 地址:", factoryAddress);

    // 获取 WETH 地址的正确方式
    const wethAddress = await router.WETH();
    console.log("WETH 地址:", wethAddress);

    return { router, factoryAddress, wethAddress };
}

async function createPairAndAddLiquidity(tokenAddress, tokenName, factoryAddress, wethAddress) {
    const [deployer] = await ethers.getSigners();
    console.log("部署者地址:", deployer.address);

    // 1. 创建 Factory 合约实例
    const factoryAbi = [
        "function getPair(address tokenA, address tokenB) external view returns (address pair)",
        "function createPair(address tokenA, address tokenB) external returns (address pair)",
        "event PairCreated(address indexed token0, address indexed token1, address pair, uint)"
    ];

    const factory = new ethers.Contract(factoryAddress, factoryAbi, deployer);

    // 2. 创建你的代币合约实例
    const tokenAbi = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address account) external view returns (uint256)",
        "function decimals() external view returns (uint8)",
        "function symbol() external view returns (string)",
        "function name() external view returns (string)"
    ];

    const token = new ethers.Contract(tokenAddress, tokenAbi, deployer);

    // 4. 检查交易对是否存在
    console.log(`检查 ${tokenName}/WETH 交易对...`);
    let pairAddress = await factory.getPair(tokenAddress, wethAddress);

    if (pairAddress === ethers.ZeroAddress) {
        console.log(`交易对不存在，正在创建... ${tokenAddress}-${wethAddress}`);

        try {
            // 创建交易对
            const createPairTx = await factory.createPair(tokenAddress, wethAddress);

            console.log("交易已发送，等待确认...");
            const receipt = await createPairTx.wait();
            console.log("交易确认，区块:", receipt.blockNumber);

            // 从事件中获取 pair 地址
            const pairCreatedEvent = receipt.events?.find(e => e.event === "PairCreated");
            if (pairCreatedEvent) {
                pairAddress = pairCreatedEvent.args.pair;
                console.log("从事件中获取交易对地址:", pairAddress);
            } else {
                // 如果事件没找到，再次查询
                pairAddress = await factory.getPair(tokenAddress, wethAddress);
                console.log("查询到的交易对地址:", pairAddress);
            }

            console.log("交易对创建成功!");

        } catch (error) {
            console.error("创建交易对失败:", error.message);

            // 尝试解析错误
            if (error.data) {
                console.log("错误数据:", error.data);
            }
            return null;
        }
    } else {
        console.log("交易对已存在:", pairAddress);
    }

    return pairAddress;
}

async function addLiquidityToPair(router, etimTokenAddress, wethAddress, etimTokenAmount, wethAmount) {
    const [deployer] = await ethers.getSigners();

    // 代币合约实例
    const tokenAbi = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address guy) public view returns (uint)",
    ];
    const etimToken = new ethers.Contract(etimTokenAddress, tokenAbi, deployer);
    const weth = await getWETHContract(deployer, "0xfff9976782d46cc05630d1f6ebab18b2324d6b14");

    console.log("正在添加流动性...");

    try {
        // 1. 授权 Router 使用代币
        let approveTx = await etimToken.approve(router.getAddress(), ethers.MaxUint256);
        await approveTx.wait();
        console.log("etim token 授权成功", deployer.address, ethers.formatEther(await etimToken.balanceOf(deployer.address)));

        // 2. 授权 Router 使用代币
        approveTx = await weth.approve(router.getAddress(), ethers.MaxUint256);
        await approveTx.wait();
        console.log("weth token 授权成功", deployer.address, ethers.formatEther(await weth.balanceOf(deployer.address)));

        // 2. 设置期限（当前时间 + 20分钟）
        const deadline = Math.floor(Date.now() / 1000) + 1200;

        // 3. 添加流动性
        const addLiquidityTx = await router.addLiquidity(
            etimTokenAddress,       // 代币地址 etim
            wethAddress,            // 代币地址 weth
            etimTokenAmount,        // 代币数量 etim
            wethAmount,             // 代币数量 weth
            etimTokenAmount * 95n / 100n,  // 最小代币数量（95%）
            wethAmount * 95n / 100n,       // 最小WETH数量（95%）
            deployer.address,       // 流动性接收地址
            deadline                // 截止时间
        );

        const receipt = await addLiquidityTx.wait();
        console.log("流动性添加成功! 交易哈希:", receipt.hash);

        return receipt;

    } catch (error) {
        console.error("添加流动性失败:", error.message);

        // 详细错误分析
        if (error.code === "CALL_EXCEPTION") {
            console.log("合约调用异常，请检查:");
            console.log("1. 代币是否已授权给 Router");
            console.log("2. 账户是否有足够的代币和 ETH");
            console.log("3. 代币地址是否正确");
        }

        if (error.data) {
            console.log("错误数据:", error.data);
        }

        throw error;
    }
}

async function transferWethEtimToken(user, etimTokenAddress, etimTokenAmount, wethAmount) {
    const [_, marketInfra] = await ethers.getSigners();
    const weth = await getWETHContract(user, "0xfff9976782d46cc05630d1f6ebab18b2324d6b14");

    const tokenAbi = [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function balanceOf(address guy) public view returns (uint)",
        "function deposit() public payable",
        "function transfer(address dst, uint wad) public returns (bool)",
    ];
    const etimToken = new ethers.Contract(etimTokenAddress, tokenAbi, marketInfra);

    try {
        if (wethAmount > 0) {
            let tx = await weth.deposit({ value: wethAmount });
            await tx.wait();
            console.log("发放 WETH 成功!", ethers.formatEther(await weth.balanceOf(user.address)), user.address);
        }

        if (etimTokenAmount > 0) {
            tx = await etimToken.transfer(user.address, etimTokenAmount);
            await tx.wait();

            console.log("发放 ETIM TOKEN 成功!", ethers.formatEther(await etimToken.balanceOf(user.address)), user.address);
        }
    } catch (error) {
        console.log("转换失败:", error.message);
    }
}

async function wrapETH() {
    // 配置
    const [deployer, deployer1] = await ethers.getSigners();

    // WETH ABI（只需要 deposit 函数）
    const wethABI = [
        "function deposit() public payable",
        "function withdraw(uint wad) public",
        "function balanceOf(address owner) view returns (uint256)"
    ];

    const wethContract = await getWETHContract(deployer, "0xfff9976782d46cc05630d1f6ebab18b2324d6b14");

    // 要兑换的 ETH 数量（例如：0.1 ETH）
    const amount = ethers.parseEther("0.0001");

    try {
        // 检查余额
        const ethBalance = await ethers.provider.getBalance(deployer.address);
        console.log(`ETH 余额: ${ethers.formatEther(ethBalance)} ETH`);

        if (ethBalance < amount) {
            console.log("ETH 余额不足");
            return;
        }
        // 执行兑换
        console.log(`正在将 ${ethers.formatEther(amount)} ETH 兑换为 WETH...`);

        const tx = await wethContract.deposit({
            value: amount,
            gasLimit: 100000
        });

        console.log(`交易哈希: ${tx.hash}`);
        await tx.wait();
        console.log("兑换成功！");

        // 检查 WETH 余额
        const wethBalance = await wethContract.balanceOf(deployer.address);
        console.log(`WETH 余额: ${ethers.formatEther(wethBalance)} WETH`);

    } catch (error) {
        console.error("兑换失败:", error);
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });