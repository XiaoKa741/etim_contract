// scripts/convertEthToWeth.js
const { ethers } = require("hardhat");

// sepolia
const ETIMMainAddress = '0xe5fb695741B199479C4655E92bEd992B43d77505';
const ETIMTokenAddress = '0x8A56a8D49F8CD598701DA0f43FdACDFd60AaF10f';
const ETIMNodeAddress = '0x61b2db0Eb42f8bF14b14E6cf89Af26f1495441A2';
const ETIMPoolAddress = '0x45f89e9030ca813E7A5Ca5263356EaB438EA95B9';
const ETIMHookAddress = '0x2b6EB3356d64C98ad5d7A72EA4363ad12FF080CC';
const Permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PositionManagerAddress = '0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4';
const PoolManagerAddress = '0xE03A1074c86CFeDd5C142C4F04F1a1536e203543';

async function main() {
    const etimMain = await ethers.getContractAt("ETIMMain", ETIMMainAddress);
    const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);
    const etimNode = await ethers.getContractAt("ETIMNode", ETIMNodeAddress);
    const etimPool = await ethers.getContractAt("ETIMPoolHelper", ETIMPoolAddress);

    const [a, b, c, d, e, f] = await ethers.getSigners();

    // let tx = await etimToken.approve(ETIMPoolAddress, ethers.MaxInt256);
    // await tx.wait();

    console.log("【池子管理合约】池子内ETH余量:", ethers.formatEther(await etimPool.getEthReserves()));

    // tx = await etimMain.updateDailyPrice();
    // await tx.wait();

    // tx = await etimMain.getTestEtimToken(ethers.parseEther("100"));
    // await tx.wait();

    // console.log('etim per eth: ', ethers.formatEther(await etimMain.ethPriceInEtim()));
    // console.log('usdc per eth: ', ethers.formatUnits(await etimMain.ethPriceInUsd(), 6));

    // 相互转账1
    // let estimated = await etimToken.connect(a).transfer.estimateGas(b.address, ethers.parseEther("0.001"));
    // tx = await etimToken.connect(a).transfer(b.address, ethers.parseEther("0.001"), { gasLimit: estimated * 150n / 100n });
    // console.log((await tx.wait()).hash);
    // estimated = await etimToken.connect(b).transfer.estimateGas(a.address, ethers.parseEther("0.001"));
    // tx = await etimToken.connect(b).transfer(a.address, ethers.parseEther("0.001"), { gasLimit: estimated * 150n / 100n });
    // console.log((await tx.wait()).hash);

    // 相互转账2
    // tx = await etimToken.connect(b).transfer(c.address, ethers.parseEther("0.001"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(b).transfer(d.address, ethers.parseEther("0.001"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(c).transfer(b.address, ethers.parseEther("0.001"));
    // console.log((await tx.wait()).hash);
    // tx = await etimToken.connect(d).transfer(b.address, ethers.parseEther("0.001"));
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

    // await getEtimMainStatus(etimMain);
    // await getUserInfo(etimMain, a);
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

    // console.log(ethers.formatEther(await etimMain.connect(a).getClaimableAmount()));
    // console.log(ethers.formatEther(await etimMain.connect(b).getClaimableAmount()));
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
}

async function participate(user, etimMain) {
    try {
        console.log(`[ETIMMain] participate ${user.address}`);
        // 检查账户余额
        const balance = await ethers.provider.getBalance(user.address);
        console.log("账户余额:", user.address, ethers.formatEther(balance), "ETH");

        await getUserInfo(etimMain, user);

        let estimated = await etimMain.connect(user).deposit.estimateGas({ value: ethers.parseEther("0.0162") });
        console.log("gas预估", estimated);
        const tx = await etimMain.connect(user).deposit({
            value: ethers.parseEther("0.0162"),
            gasLimit: estimated * 150n / 100n
        });
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
    console.log('etimMain 某日价格(ETIM per USDC): ', ethers.formatEther(await etimMain.dailyUsdEtimPrice(20514)));
    console.log('etimMain 总激活节点: ', await etimMain.totalActiveNodes());
    console.log('etimMain 激活节点奖励份额: ', ethers.formatEther(await etimMain.rewardPerNode()));
    try {
        for (let i = 0; i < 1000; i++) {
            console.log("etimMain 参与地址", await etimMain.participants(i));
        }
    } catch (e) {
    }
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });