// scripts/convertEthToWeth.js
const { ethers } = require("hardhat");

// forking
const ETIMMainAddress = '0x560C37Cd680b0816A09846F33BA9D9d15Ca1019C';
const ETIMTokenAddress = '0x4039De7C4bAa31b0F93ad232c656DC3e8387AE7a';
const ETIMNodeAddress = '0x1D64Fd9269b4Ca972D544920e1C5423b867D3d23';
const ETIMPoolAddress = '0x1a0B78E47bB91Bb152D039Fd82816aE72E72Ee54';
const ETIMHookAddress = '0xe3F8d5F49C2eb1a45352eF1dafB865cA27344044';
const Permit2Address = '0x000000000022D473030F116dDEE9F6B43aC78BA3';
const PositionManagerAddress = '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e';
const PoolManagerAddress = '0x000000000004444c5dc75cB358380D2e3dE08A90';

async function main() {
    const etimMain = await ethers.getContractAt("ETIMMain", ETIMMainAddress);
    const etimToken = await ethers.getContractAt("ETIMToken", ETIMTokenAddress);
    const etimNode = await ethers.getContractAt("ETIMNode", ETIMNodeAddress);
    const etimPool = await ethers.getContractAt("ETIMPoolHelper", ETIMPoolAddress);

    const [deployer, a, b, c, d, e, f] = await ethers.getSigners();

    let tx = await etimToken.approve(ETIMPoolAddress, ethers.MaxInt256);
    await tx.wait();

    console.log("【池子管理合约】池子内ETH余量:", ethers.formatEther(await etimPool.getEthReserves()));

    // 调整区块时间
    // await updateBlockTime();

    tx = await etimMain.updateDailyPrice();
    await tx.wait();
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

    {
        const provider = ethers.provider;
        const block = await provider.getBlock("latest");
        console.log("区块时间戳:", block.timestamp); // 固定为分叉区块的时间
    }
}

async function participate(user, etimMain) {
    try {
        console.log(`[ETIMMain] participate ${user.address}`);
        // 检查账户余额
        const balance = await ethers.provider.getBalance(user.address);
        console.log("账户余额:", user.address, ethers.formatEther(balance), "ETH");

        await getUserInfo(etimMain, user);

        const tx = await etimMain.connect(user).deposit({ value: ethers.parseEther("0.0637") });
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
        console.log("etimMain 当日deposit(ETH) 限制", ethers.formatEther(dailyDepositCap * dailyDepositRate / denominator));
    }
    console.log("etimMain deposited(ETH)", ethers.formatEther(await etimMain.totalDeposited()));
    console.log('etimMain 价格(ETIM per ETH): ', ethers.formatEther(await etimMain.ethPriceInEtim()));
    console.log('etimMain 价格(USDC per ETH): ', ethers.formatUnits(await etimMain.ethPriceInUsd(), 6));
    console.log('etimMain 价格(ETIM per USDC): ', ethers.formatEther(await etimMain.etimPerUsd()));
    console.log('etimMain 某日价格(ETIM per USDC): ', ethers.formatEther(await etimMain.dailyUsdEtimPrice(20512)));
    console.log('etimMain 总激活节点: ', await etimMain.totalActiveNodes());
    console.log('etimMain 激活节点奖励份额: ', ethers.formatEther(await etimMain.rewardPerNode()));
    try {
        for (let i = 0; i < 1000; i++) {
            console.log("etimMain 参与地址", await etimMain.participants(i));
        }
    } catch (e) {
    }
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