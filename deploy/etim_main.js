// scripts/convertEthToWeth.js
const { ethers } = require("hardhat");
const { getWETHContract } = require("./util");
const { formatEther } = require("ethers");

const ETIMMainAddress = '0x3aAde2dCD2Df6a8cAc689EE797591b2913658659';
const ETIMTokenAddress = '0xA7c59f010700930003b33aB25a7a0679C860f29c';
const ETIMNodeAddress = '0xfaAddC93baf78e89DCf37bA67943E1bE8F37Bb8c';
const WETHAddress = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';

async function main() {
    const etimMain = await ethers.getContractAt("ETIMMain", ETIMMainAddress);
    const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);
    const etimNode = await ethers.getContractAt("ETIMNode", ETIMNodeAddress);
    const weth = await getWETHContract();

    const [deployer, marketInfra, ecoFund, communityFund, ethFoundation, a, b, c, d, e, f] = await ethers.getSigners();

    // 调整区块时间
    // await updateBlockTime();

    // tx = await etimMain._getCurrentPrice();
    // await tx.wait();
    // console.log('etim per weth: ', ethers.formatEther(await etimMain.wethPriceInEtim()));
    // tx = await etimMain._getCurrentPriceWethInU();
    // await tx.wait();
    // console.log('usdc per weth: ', ethers.formatUnits(await etimMain.wethPriceInUSD(), 6));

    // tx = await etimMain.updateDailyPrice();
    // await tx.wait();
    // console.log('etim per usdc: ', ethers.formatEther(await etimMain.usdPriceInEtim()));

    // await participate(deployer, etimMain, weth);

    // await participate(a, etimMain, weth);
    await participate(b, etimMain, weth);
    // await participate(c, etimMain, weth);
    // await participate(d, etimMain, weth);
    // await participate(e, etimMain, weth);
    // await participate(f, etimMain, weth);

    // 相互转账1
    // let tx = await etimToken.connect(a).transfer(b.address, ethers.parseEther("10"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(b).transfer(a.address, ethers.parseEther("10"));
    // console.log((await tx.wait()).hash);

    // 相互转账2
    // tx = await etimToken.connect(b).transfer(c.address, ethers.parseEther("10"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(b).transfer(d.address, ethers.parseEther("15"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(c).transfer(b.address, ethers.parseEther("20"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(d).transfer(b.address, ethers.parseEther("25"));
    // console.log((await tx.wait()).hash);

    // console.log("下级", a.address, "上级", await etimMain.referrerOf(a.address));
    // console.log("下级", b.address, "上级", await etimMain.referrerOf(b.address));
    // try { console.log("上级", a.address, "下级", await etimMain.referralsOfList(a.address, 0)); } catch (e) { }
    // try { console.log("上级", b.address, "下级", await etimMain.referralsOfList(b.address, 0)); } catch (e) { }
    // console.log("main合约etim代币", ethers.formatEther(await etimToken.balanceOf(ETIMMainAddress)), "main合约weth代币", ethers.formatEther(await weth.balanceOf(ETIMMainAddress)));
    // console.log("0地址etim代币", ethers.formatEther(await etimToken.balanceOf("0x000000000000000000000000000000000000dEaD")));

    await getEtimMainStatus(etimMain);
    // await getUserInfo(etimMain, a);
    // await getUserInfo(etimMain, b);
    // await getUserInfo(etimMain, c);
    // await getUserInfo(etimMain, d);

    // console.log("x usd兑换etim", ethers.formatEther(await etimMain._getDayU2ETIM(0, ethers.parseUnits("100", 6))));

    // await getETH_WETH_ETIM(a, weth, etimToken);
    // await getETH_WETH_ETIM(b, weth, etimToken);

    // console.log(ethers.formatEther(await etimMain.connect(a).getClaimableAmount()));
    // console.log(ethers.formatEther(await etimMain.connect(b).getClaimableAmount()));
    // console.log(ethers.formatEther(await etimMain.connect(c).getClaimableAmount()));

    // 领奖
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(a.address)));
    // let tx = await etimMain.connect(a).claim();
    // console.log((await tx.wait()).hash);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(a.address)));

    // 卖出
    // await getETH_WETH_ETIM(deployer, weth, etimToken);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(deployer.address)));
    // tx = await etimMain.connect(deployer).sellETIM(ethers.parseEther("1"));
    // console.log((await tx.wait()).hash);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(deployer.address)));
    // await getETH_WETH_ETIM(deployer, weth, etimToken);

    // console.log(await getETH_WETH_ETIM(a, weth, etimToken));
    // console.log(await getETH_WETH_ETIM(ETIMMainAddress, weth, etimToken));

    // console.log(await etimNode.connect(b).totalPerformancePool());
    // console.log(await etimToken.balanceOf(ETIMMainAddress));

    await getPriceFromUniswapV2(WETHAddress, ETIMTokenAddress, ethers.parseEther("1"));
    {
        const provider = ethers.provider;
        const block = await provider.getBlock("latest");
        console.log("区块时间戳:", block.timestamp); // 固定为分叉区块的时间
    }
}

// 授权 WETH
async function approveWETH(user, wethContract, spender, amount) {
    // 授权一个较大的金额，避免频繁授权
    const approveAmount = amount * 10n;

    console.log("授权金额:", ethers.formatEther(approveAmount), "WETH");
    console.log("授权给:", spender);

    const approveTx = await wethContract.connect(user).approve(
        spender,
        approveAmount
    );
    await approveTx.wait();
    console.log("授权成功");

    // 验证授权
    const newAllowance = await wethContract.allowance(user.address, spender);
    console.log("新授权额度:", ethers.formatEther(newAllowance), "WETH");
}

async function participate(user, etimMain, weth) {
    try {
        console.log(`[ETIMMain] participate ${user.address}`);
        // 检查账户余额
        const balance = await ethers.provider.getBalance(user.address);
        console.log("账户余额:", user.address, ethers.formatEther(balance), "ETH", ethers.formatEther(await weth.balanceOf(user.address)), "WETH");
        console.log("当前WETH授权额度:", await weth.allowance(user.address, ETIMMainAddress));
        await approveWETH(user, weth, ETIMMainAddress, ethers.parseEther("100"));

        await getUserInfo(etimMain, user);

        // const tx = await etimMain.connect(user).participate();
        const tx = await etimMain.connect(user).deposit({ value: ethers.parseEther("0.0315") });
        const receipt = await tx.wait();
        console.log("交易hash", receipt.hash);
    } catch (e) {
        console.log(e);
    }
}

async function getUserInfo(etimMain, user) {
    let i = 0;
    const userInfo = await etimMain.users(user);
    console.log("用户信息: ", user.address);
    console.log(`  参与时间: ${userInfo[i++]}`);
    console.log(`  投入WETH: ${ethers.formatEther(userInfo[i++])}`);
    console.log(`  投入U: ${ethers.formatUnits(userInfo[i++], 6)}`);
    console.log(`  已领取U本位价值: ${ethers.formatUnits(userInfo[i++], 6)}`);
    console.log(`  领取时间: ${userInfo[i++]}`);
    console.log(`  直推人数: ${userInfo[i++]}`);
    console.log(`  团队币量: ${ethers.formatEther(userInfo[i++])}`);
    console.log(`  邀请等级: ${userInfo[i++]}`);

    return userInfo;
}

async function getETH_WETH_ETIM(user, weth, etimToken) {
    const balance = await ethers.provider.getBalance(user.address);
    const wethBalance = await weth.balanceOf(user.address);
    const etimBalance = await etimToken.balanceOf(user.address);
    console.log("账户余额:", user.address, ethers.formatEther(balance), "ETH", ethers.formatEther(wethBalance), "WETH", ethers.formatEther(etimBalance), "ETIM");

    return (balance, wethBalance, etimBalance);
}

async function getEtimMainStatus(etimMain) {
    console.log("etimMain 参与人数", await etimMain.totalUsers());
    console.log("etimMain deposited(WETH)", ethers.formatEther(await etimMain.totalDeposited()));
    console.log("etimMain node总业绩(WETH)", ethers.formatEther(await etimMain.totalNodePerformance()));
    console.log('etimMain 价格(ETIM per WETH): ', ethers.formatEther(await etimMain.wethPriceInEtim()));
    console.log('etimMain 价格(USDC per WETH): ', ethers.formatUnits(await etimMain.wethPriceInUSD(), 6));
    console.log('etimMain 价格(ETIM per USDC): ', ethers.formatEther(await etimMain.usdPriceInEtim()));
    try {
        for (let i = 0; i < 1000; i++) {
            console.log("etimMain 参与地址", await etimMain.participants(i));
        }
    } catch (e) {
    }
}

async function getPriceFromUniswapV2(tokenInAddr, tokenOutAddr, amountIn) {
    console.log("=== 从本地分叉网络获取 Uniswap V2 价格 ===");
    // 1. 获取 provider
    const provider = ethers.provider;

    // 2. Uniswap V2 Router 地址
    const UNISWAP_V2_ROUTER = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";

    // 3. Router 合约 ABI（简化版，只需要 getAmountsOut）
    const ROUTER_ABI = [
        "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)"
    ];

    const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, provider);

    // 4. 构建路径
    const path = [tokenInAddr, tokenOutAddr];

    try {
        // 5. 获取兑换数量
        const amounts = await router.getAmountsOut(amountIn, path);

        // 计算价格
        const price = amounts[1] / amounts[0];
        const pricePerOne = ethers.formatUnits(amounts[1], 18) / ethers.formatUnits(amounts[0], 18);

        console.log(`输入: ${ethers.formatUnits(amountIn, 18)} WETH`);
        console.log(`输出: ${ethers.formatUnits(amounts[1], 18)} ETIM`);
        console.log(`价格: 1 WETH = ${pricePerOne} ETIM`);
        console.log(`原始数据: ${amounts[1]} ETIM 换 ${amounts[0]} WETH`);

        return {
            amountIn: amounts[0],
            amountOut: amounts[1],
            price: pricePerOne
        };
    } catch (error) {
        console.error("获取价格失败:", error.message);
        return null;
    } finally {
        await getPriceUsdcPerWeth(router);
    }
}

async function getPriceUsdcPerWeth(uniswapRouter) {
    // 通过 Uniswap 路由器合约查询 1 WETH 可以兑换多少 USDC
    const amounts = await uniswapRouter.getAmountsOut(
        ethers.parseEther("1"), // 输入 1 WETH
        [WETHAddress, "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"]    // 交易路径：WETH -> USDC
    );
    // 返回的 amounts[1] 就是能兑换的 USDC 数量（带 6 位小数）
    const usdcAmount = ethers.formatUnits(amounts[1], 6);
    console.log(`1 WETH = ${usdcAmount} USDC`);
}

async function updateBlockTime() {
    // 使用 evm_increaseTime 快进时间
    // 将链上时间快进 1 天 (86400 秒)
    await network.provider.send("evm_increaseTime", [86400]);

    // 重要：evm_increaseTime 本身不挖掘新区块，需要发送一笔交易来使时间生效
    await network.provider.send("evm_mine"); // 挖掘一个新区块，时间戳为原最新区块 + 增加的时间
    console.log("时间操纵成功！");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });