const { ethers } = require("hardhat");

// WETH9 主网固定地址
const WETH9_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

// 简化版 ABI，只包含常用函数
const WETH9_ABI = [
    "function deposit() public payable",
    "function withdraw(uint wad) public",
    "function approve(address guy, uint wad) public returns (bool)",
    "function transfer(address dst, uint wad) public returns (bool)",
    "function transferFrom(address src, address dst, uint wad) public returns (bool)",
    "function balanceOf(address guy) public view returns (uint)",
    "function totalSupply() public view returns (uint)",
    "function allowance(address owner, address spender) public view returns (uint256)",
    "event Approval(address indexed src, address indexed guy, uint wad)",
    "event Transfer(address indexed src, address indexed dst, uint wad)",
    "event Deposit(address indexed dst, uint wad)",
    "event Withdrawal(address indexed src, uint wad)"
];

async function getWETHContract(signer = null, weth_address = null) {
    if (!signer) {
        const [defaultSigner] = await ethers.getSigners();
        signer = defaultSigner;
    }
    if (weth_address) {
        return new ethers.Contract(weth_address, WETH9_ABI, signer);
    }
    return new ethers.Contract(WETH9_ADDRESS, WETH9_ABI, signer);
}

// 导出方式
module.exports = {
    WETH9_ADDRESS,
    WETH9_ABI,
    getWETHContract
};