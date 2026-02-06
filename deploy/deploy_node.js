const { ethers } = require("hardhat");

async function main() {
    // await deploy_node();
    // await test("0x2461EefbbA0f312a0a22b5ED9F0b18FAc3292CCb");
}

async function deploy_node() {
    const [deployer] = await ethers.getSigners();
    console.log("部署者地址:", deployer.address);
    console.log("部署者余额:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

    console.log("\n2. 部署节点NFT合约...");
    const ETIMNode = await ethers.getContractFactory("ETIMNode");

    const etimNode = await ETIMNode.deploy();
    await etimNode.waitForDeployment();
    const etimNodeAddress = await etimNode.getAddress();
    console.log("节点合约地址:", etimNodeAddress);
}

async function test(ETIMNodeAddress) {
    const [deployer, a, b] = await ethers.getSigners();
    console.log("部署者余额:", deployer.address, ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

    const etimNode = await ethers.getContractAt("ETIMNode", ETIMNodeAddress);

    console.log("BaseURI:", await etimNode.baseTokenURI());
    console.log("Total:", await etimNode.totalSupply(), "Max:", await etimNode.MAX_SUPPLY());
    try { console.log("URI:", await etimNode.tokenURI(1)); } catch { }
    // try { console.log(`${deployer.address} own count:`, await etimNode.balanceOf(deployer)); } catch { }
    // try { console.log(`${a.address} own count:`, await etimNode.balanceOf(a)); } catch { }
    // try { console.log(`${b.address} own count:`, await etimNode.balanceOf(b)); } catch { }

    const network = await deployer.provider.getNetwork();
    console.log("当前部署网络 ChainID:", network.chainId);

    // let tx = await etimNode.connect(a).mint(1);
    // receipt = await tx.wait();
    // console.log(receipt.hash);

    // tx = await etimNode.connect(deployer).updateURI("https://d2clu30ecxbfyv.cloudfront.net/etimNode/");
    // let receipt = await tx.wait();
    // console.log(receipt.hash);

    // tx = await etimNode.connect(deployer).batchMint("0x32FfE68ba2347f209e0E09ea720Ac1971aaCf9FF", 1);
    // receipt = await tx.wait();
    // console.log(receipt.hash);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });