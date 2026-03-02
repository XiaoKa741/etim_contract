// scripts/convertEthToWeth.js
const { ethers } = require("hardhat");
const { getWETHContract } = require("./util");

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

    console.log("etim 节点价格(WETH)", ethers.formatEther(await etimNode.getCurrentNodePriceInWETH()));

    // await getEtimNodeStatus(b, etimNode);
    await mintNode(b, weth, etimNode, etimToken);
    // await getEtimNodeStatus(b, etimNode);
    console.log("token URI", await etimNode.tokenURI(1));

    // tx = await etimNode.connect(b).activateNode(1);
    // console.log((await tx.wait()).hash);

    await getEtimNodeStatus(b, etimNode);
    // console.log(ethers.formatEther(await etimNode.getPendingRewards(1)));

    // console.log("etimNode 合约内WETH数量", ethers.formatEther(await weth.balanceOf(ETIMNodeAddress)));
    // await getETH_WETH_ETIM(b, weth, etimToken);
    // tx = await etimNode.connect(b).claim(1);
    // console.log((await tx.wait()).hash);
    // await getETH_WETH_ETIM(b, weth, etimToken);
    // console.log("etimNode 合约内WETH数量", ethers.formatEther(await weth.balanceOf(ETIMNodeAddress)));
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

async function getETH_WETH_ETIM(user, weth, etimToken) {
    const balance = await ethers.provider.getBalance(user.address);
    const wethBalance = await weth.balanceOf(user.address);
    const etimBalance = await etimToken.balanceOf(user.address);
    console.log("账户余额:", user.address, ethers.formatEther(balance), "ETH", ethers.formatEther(wethBalance), "WETH", ethers.formatEther(etimBalance), "ETIM");

    return (balance, wethBalance, etimBalance);
}

async function mintNode(user, weth, etimNode, etimToken) {
    try {
        console.log(`当前WETH授权额度:`, await weth.allowance(user.address, ETIMMainAddress));
        await approveWETH(user, weth, ETIMNodeAddress, ethers.parseEther("100"));

        await getETH_WETH_ETIM(user, weth, etimToken);
        // let tx = await etimNode.connect(user).mintNode();
        let tx = await etimNode.connect(user).deposit({value: ethers.parseEther("0.2645")});
        console.log("mint成功, 交易hash", (await tx.wait()).hash);
        await getETH_WETH_ETIM(user, weth, etimToken);
    } catch (e) {
        console.log(e);
    }
}

async function getEtimNodeStatus(user, etimNode) {
    console.log("etimNode MINT数量", await etimNode.totalMinted());
    console.log(`etimNode 用户 ${user.address} 拥有tokenId: `);
    for (let i = 0; i < 10; i++) {
        try { console.log("\t  ", await etimNode.userNodes(user.address, i)); } catch (e) { }
    }
    console.log("etimNode 所有已激活数量", await etimNode.activatedNodeCount());
    console.log("etimNode 所有已激活tokenId: ",);
    for (let i = 0; i < 10; i++) {
        if (await etimNode.nodeActivated(i)) {
            console.log("\t  ", i);
        }
    }
    console.log("etimNode 当前节点分红");
    for (let i = 0; i < 10; i++) {
        const waiClaimable = await await etimNode.nodePerformanceRewards(i);
        if (waiClaimable > 0) {
            console.log("\t  ", ethers.formatEther(waiClaimable));
        }
    }
    console.log("etimNode 节点分红累积");
    for (let i = 0; i < 10; i++) {
        const addupVal = await etimNode.nodePerformanceAddup(i);
        if (addupVal > 0) {
            console.log("\t  ", ethers.formatEther(addupVal));
        }
    }
    console.log("etimNode 总业绩", ethers.formatEther(await etimNode.totalPerformancePool()));
    console.log("etimNode 已分配业绩", ethers.formatEther(await etimNode.lastDistributedPerformance()));
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });