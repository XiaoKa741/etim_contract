const { ethers } = require("hardhat");

const MIN_PRICE_LIMIT = BigInt("4295128740");
const MAX_PRICE_LIMIT = BigInt("1461446703485210103287273052203988822378723970341");

const ETIMTokenAddress = '0xb28C1C983Bb584cA4Ff3D9F381Cb23fC5bF0392A';
const ETIMHookAddress = '0x1bfC1176F0B399bFb3F63ea888786bDf2Bce80CC';
const PoolManagerAddress = '0x000000000004444c5dc75cB358380D2e3dE08A90';
const SwapRouterTestAddress = '0x6561Fb13599F81C85cE1b89a7d49deEd2Bcc8259'
const DeploySwapRouter = true;

async function deploy_swap_test() {
    const PoolSwapTest = await ethers.getContractFactory("PoolSwapTest");
    const swapRouter = await PoolSwapTest.deploy(PoolManagerAddress);
    await swapRouter.waitForDeployment();
    const swapRouterAddress = await swapRouter.getAddress();
    console.log("SWAP ROUTER测试合约地址:", swapRouterAddress);
}

async function main() {
    const [signer] = await ethers.getSigners();
    if (DeploySwapRouter) {
        await deploy_swap_test();
    } else {
        const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);
        const swapRouter = await ethers.getContractAt("PoolSwapTest", SwapRouterTestAddress);
        {
            // 开启交易
            const hook = await ethers.getContractAt("ETIMTaxHook", ETIMHookAddress);
            tx = await hook.connect(signer).setTradingEnabled(true);
            await tx.wait();
        }

        const poolKey = {
            currency0: ethers.ZeroAddress,  // Native ETH
            currency1: ETIMTokenAddress,
            fee: 3000,
            tickSpacing: 60,
            hooks: ETIMHookAddress,
        };

        // await testBuyEtim(signer, poolKey, etimToken, swapRouter);
        await testSellETIM(signer, poolKey, etimToken, swapRouter);
    }
}

// 买入ETIM
async function testBuyEtim(signer, poolKey, etimToken, swapRouter) {
    const ethAmount = ethers.parseEther("0.001");

    const etimBefore = await etimToken.balanceOf(signer.address);
    const ethBefore = await ethers.provider.getBalance(signer.address);

    console.log("ETH before: ", ethers.formatEther(ethBefore));
    console.log("ETIM before:", ethers.formatEther(etimBefore));

    const tx = await swapRouter.swap(
        poolKey,
        {
            zeroForOne: true,                      // ETH → ETIM
            amountSpecified: -ethAmount,           // exactInput，负数
            sqrtPriceLimitX96: MIN_PRICE_LIMIT,
        },
        {
            takeClaims: false,
            settleUsingBurn: false
        },
        "0x",
        { value: ethAmount }                     // 附带 ETH
    );

    const receipt = await tx.wait();
    console.log("买入 gas used:", receipt.gasUsed.toString());

    const etimAfter = await etimToken.balanceOf(signer.address);
    const ethAfter = await ethers.provider.getBalance(signer.address);

    console.log("ETH after: ", ethers.formatEther(ethAfter));
    console.log("ETIM after:", ethers.formatEther(etimAfter));
}

// 卖出ETIM
async function testSellETIM(signer, poolKey, etimToken, swapRouter) {
    const etimAmount = ethers.parseEther("5");

    // 先授权 swapRouter 使用 ETIM
    const approveTx = await etimToken.approve(SwapRouterTestAddress, ethers.MaxUint256);
    await approveTx.wait();

    const etimBefore = await etimToken.balanceOf(signer.address);
    const ethBefore = await ethers.provider.getBalance(signer.address);

    console.log("ETIM before:", ethers.formatEther(etimBefore));
    console.log("ETH before: ", ethers.formatEther(ethBefore));

    const tx = await swapRouter.swap(
        poolKey,
        {
            zeroForOne: false,                     // ETIM → ETH
            amountSpecified: -etimAmount,          // exactInput，负数
            sqrtPriceLimitX96: MAX_PRICE_LIMIT,
        },
        {
            takeClaims: false,
            settleUsingBurn: false
        },
        "0x"
        // 卖出不需要附带 ETH
    );

    const receipt = await tx.wait();
    console.log("卖出 gas used:", receipt.gasUsed.toString());

    const etimAfter = await etimToken.balanceOf(signer.address);
    const ethAfter = await ethers.provider.getBalance(signer.address);

    console.log("ETIM after:", ethers.formatEther(etimAfter));
    console.log("ETH after: ", ethers.formatEther(ethAfter));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });