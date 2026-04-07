// scripts/convertEthToWeth.js
const { ethers } = require("hardhat");

// forking
const ETIMMainAddress = '0x4457eEb3f3E0AB10B1340aCb7818fF2838E3B41b';
const ETIMTokenAddress = '0xCC2C1eB57bc4da75587fB513d7b1f20c62b9C863';
const ETIMNodeAddress = '0x308B07DA84DBafAA4CA862ce7EB85FA013f832D6';
const ETIMPoolAddress = '0xE2B0ec1D2bdb23431865534e1BCffd8845F5D3B4';
const ETIMHookAddress = '0xf0e19D44989F5C9E3F3c993AaA9D4Ff9f17c8440';
const Permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PositionManagerAddress = '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e';
const PoolManagerAddress = '0x000000000004444c5dc75cB358380D2e3dE08A90';

async function main() {
    const etimMain = await ethers.getContractAt("ETIMMain", ETIMMainAddress);
    const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);
    const etimNode = await ethers.getContractAt("ETIMNode", ETIMNodeAddress);
    const etimPool = await ethers.getContractAt("ETIMPoolHelper", ETIMPoolAddress);
    const etimTaxHook = await ethers.getContractAt("ETIMTaxHook", ETIMHookAddress);

    // const [deployer, a, b, c, d, e, f] = await ethers.getSigners();
    const [a, b, c, d, e, f] = await ethers.getSigners();

    let tx = await etimToken.approve(ETIMPoolAddress, ethers.MaxInt256);
    await tx.wait();

    console.log("【池子管理合约】池子内ETH余量:", ethers.formatEther(await etimPool.getEthReserves()));

    // 调整区块时间
    // await updateBlockTime();

    await getEtimTaxHookStatus(etimTaxHook);

    // tx = await etimMain.updateDailyPrice();
    // await tx.wait();

    // tx = await etimMain.setDailyDepositRate(1000);
    // await tx.wait();
    // tx = await etimMain.setDailyDepositLimit(ethers.parseEther("10"));
    // await tx.wait();

    // console.log('etim per eth: ', ethers.formatEther(await etimMain.ethPriceInEtim()));
    // console.log('usdc per eth: ', ethers.formatUnits(await etimMain.ethPriceInUsd(), 6));

    // 相互转账1
    // tx = await etimToken.connect(a).transfer(b.address, ethers.parseEther("10"));
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

    // await participate(a, etimMain);
    // await participate(b, etimMain);
    // await participate(c, etimMain);
    // await participate(d, etimMain);
    // await participate(e, etimMain);
    // await participate(f, etimMain);

    // console.log("下级", a.address, "上级", await etimMain.referrerOf(a.address));
    // console.log("下级", b.address, "上级", await etimMain.referrerOf(b.address));
    // try { console.log("上级", a.address, "下级", await etimMain.referralsOfList(a.address, 0)); } catch (e) { }
    // try { console.log("上级", b.address, "下级", await etimMain.referralsOfList(b.address, 0)); } catch (e) { }
    // console.log("main合约etim代币", ethers.formatEther(await etimToken.balanceOf(ETIMMainAddress)));
    // console.log("0地址etim代币", ethers.formatEther(await etimToken.balanceOf("0x000000000000000000000000000000000000dEaD")));

    await getEtimMainStatus(etimMain);
    await getUserInfo(etimMain, a);
    // await getUserInfo(etimMain, b);
    // await getUserInfo(etimMain, c);
    // await getUserInfo(etimMain, d);

    // await getEthEtimAmount(a, etimToken);
    // await getEthEtimAmount(b, etimToken);

    // Mint节点
    // tx = await etimNode.connect(a).mint(1);
    // console.log((await tx.wait()).hash);
    // 同步节点
    // tx = await etimMain.connect(a).syncNodes();
    // console.log((await tx.wait()).hash);
    // 领取节点奖励
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(a.address)));
    // tx = await etimMain.connect(a).claimNodeRewards();
    // console.log((await tx.wait()).hash);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(a.address)));


    // console.log("挖矿奖励：", ethers.formatEther(await etimMain.connect(a).getClaimableAmount()));
    console.log(ethers.formatEther(await etimMain.connect(b).getClaimableAmount()));
    // console.log(ethers.formatEther(await etimMain.connect(c).getClaimableAmount()));

    // 领奖
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(a.address)));
    // tx = await etimMain.connect(a).claim();
    // console.log((await tx.wait()).hash);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(a.address)));

    // 卖出
    // await getEthEtimAmount(deployer, etimToken);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(deployer.address)));
    // tx = await etimMain.connect(deployer).sellETIM(ethers.parseEther("1"));
    // console.log((await tx.wait()).hash);
    // console.log("etim代币数量", ethers.formatEther(await etimToken.balanceOf(deployer.address)));
    // await getEthEtimAmount(deployer, etimToken);

    // console.log(await getEthEtimAmount(a, etimToken));
    // console.log(await getEthEtimAmount(ETIMMainAddress, etimToken));

    // console.log(await etimNode.connect(b).totalPerformancePool());
    // console.log(await etimToken.balanceOf(ETIMMainAddress));

    {
        const provider = ethers.provider;
        const block = await provider.getBlock("latest");
        console.log("区块时间戳:", block.timestamp); // 固定为分叉区块的时间
    }
}

async function participate(user, etimMain) {
    try {
        console.log(`[ETIMMain] participate ${user.address}`);

        const WETH_ADDRESS = "0x2170Ed0880ac9A755fd29B2688956BD959F933F8";
        const WBNB_ADDRESS = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
        const PANCAKE_ROUTER_V2 = "0x10ED43C718714eb63d5aA57B78B54704E256024E";
        const ETIMMainAddress = await etimMain.getAddress();

        // 检查账户余额
        const bnbBalance = await ethers.provider.getBalance(user.address);
        const weth = await ethers.getContractAt("IERC20", WETH_ADDRESS);
        const wethBalance = await weth.balanceOf(user.address);
        console.log("BNB 余额:", ethers.formatEther(bnbBalance));
        console.log("WETH 余额:", ethers.formatEther(wethBalance));

        await getUserInfo(etimMain, user);

        const depositAmount = ethers.parseEther("0.0637");

        // 如果 WETH 不够，先用 BNB 买 WETH
        if (wethBalance < depositAmount) {
            console.log("WETH 不够，用 BNB 购买...");
            const ROUTER_ABI = [
                "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)"
            ];
            const router = new ethers.Contract(PANCAKE_ROUTER_V2, ROUTER_ABI, user);
            const path = [WBNB_ADDRESS, WETH_ADDRESS];
            const block = await ethers.provider.getBlock("latest");
            const deadline = block.timestamp + 60 * 20;  // 区块时间 + 20分钟（fork 环境必须用区块时间）
            const swapTx = await router.swapExactETHForTokens(
                0,
                path,
                user.address,
                deadline,
                { value: ethers.parseEther("500") }  // 换等量 WETH
            );
            await swapTx.wait();
            console.log("购买 WETH 完成");
        }

        // 授权 WETH 给 main 合约
        console.log("授权 WETH 给 main 合约...");
        const approveTx = await weth.connect(user).approve(ETIMMainAddress, ethers.MaxInt256);
        await approveTx.wait();

        // 存款
        console.log("调用 deposit...");
        const tx = await etimMain.connect(user).deposit(depositAmount);
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
    console.log(`  节点数量: ${userInfo[i++]}`);
    console.log(`  节点奖励领取累积: ${ethers.formatUnits(userInfo[i++])}`);
    console.log(`  节点待领奖励: ${ethers.formatUnits(userInfo[i++])}`);

    return userInfo;
}

async function getEthEtimAmount(user, etimToken) {
    const balance = await ethers.provider.getBalance(user.address);
    const etimBalance = await etimToken.balanceOf(user.address);
    console.log("账户余额:", user.address, ethers.formatEther(balance), "ETH", ethers.formatEther(etimBalance), "ETIM");

    return (balance, etimBalance);
}

async function getEtimMainStatus(etimMain) {
    console.log("etimMain 参与人数", await etimMain.totalUsers());
    {
        const dailyDepositCap = await etimMain.dailyDepositCap();
        const dailyDepositRate = await etimMain.dailyDepositRate();
        const denominator = await etimMain.FEE_DENOMINATOR();
        console.log("etimMain 当日deposit(ETH) 限制", ethers.formatEther(dailyDepositCap), ethers.formatEther(dailyDepositCap * dailyDepositRate / denominator));
    }
    console.log("etimMain deposited(ETH)", ethers.formatEther(await etimMain.totalDeposited()));
    console.log('etimMain 价格(ETIM per ETH): ', ethers.formatEther(await etimMain.ethPriceInEtim()));
    console.log('etimMain 价格(USDC per ETH): ', ethers.formatUnits(await etimMain.ethPriceInUsd(), 6));
    console.log('etimMain 价格(ETIM per USDC): ', ethers.formatEther(await etimMain.etimPerUsd()));
    console.log('etimMain 某日价格(ETIM per USDC): ', ethers.formatEther(await etimMain.dailyUsdEtimPrice(20513)));
    console.log('etimMain 总激活节点: ', await etimMain.totalActiveNodes());
    console.log('etimMain 激活节点奖励份额: ', ethers.formatEther(await etimMain.rewardPerNode()));
    console.log('etimMain S2奖励(ETH): ', ethers.formatEther(await etimMain.s2PlusAccRewardPerShare()));
    console.log('etimMain S3奖励(ETH): ', ethers.formatEther(await etimMain.s3PlusAccRewardPerShare()));
    console.log('etimMain 基金会(ETH): ', ethers.formatEther(await etimMain.foundationRewardEth()));
    console.log('etimMain 奖池(ETH): ', ethers.formatEther(await etimMain.potRewardEth()));
    console.log('etimMain 官方(ETH): ', ethers.formatEther(await etimMain.officialRewardEth()));
    try {
        for (let i = 0; i < 1000; i++) {
            console.log("etimMain 参与地址", await etimMain.participants(i));
        }
    } catch (e) {
    }
}

async function getEtimTaxHookStatus(etimTaxHook) {
    console.log('etimTaxHook buyTax (ETH): ', ethers.formatEther(await etimTaxHook.buyTax()));
    console.log('etimTaxHook sellTaxToBurn (ETIM): ', ethers.formatEther(await etimTaxHook.sellTaxToBurn()));
    console.log('etimTaxHook sellTaxToS6 (ETIM): ', ethers.formatEther(await etimTaxHook.sellTaxToS6()));
    console.log('etimTaxHook sellTaxToFundation (ETIM): ', ethers.formatEther(await etimTaxHook.sellTaxToFoundation()));
    console.log('etimTaxHook sellTaxToOfficial (ETIM): ', ethers.formatEther(await etimTaxHook.sellTaxToOfficial()));
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