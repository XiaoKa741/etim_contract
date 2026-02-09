// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IETIMMain {
    function procTokenTransfer(
        address from,
        address to,
        uint256 value
    ) external;
}

contract ETIMToken is ERC20, Ownable {
    uint256 public constant TOTAL_SUPPLY = 2_100_000_000 * 10 ** 18;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // 各模块分配
    // uint256 public constant GROWTH_POOL = 1_925_700_000 * 10 ** 18; // 91.7%
    // uint256 public constant MARKET_INFRA = 105_000_000 * 10 ** 18; // 5%
    // uint256 public constant ECOSYSTEM_FUND = 21_000_000 * 10 ** 18; // 1%
    // uint256 public constant COMMUNITY_FUND = 21_000_000 * 10 ** 18; // 1%
    // uint256 public constant AIRDROP = 21_000_000 * 10 ** 18; // 1%
    // uint256 public constant ETH_FOUNDATION = 6_300_000 * 10 ** 18; // 0.3%

    // 分配地址
    // address public growthPool; // 增长池 91.7%
    // address public marketInfra; // 市场基础设施 5%
    // address public ecoFund; // 生态建设基金 1%
    // address public communityFund; // 社区建设 1%
    // address public airdrop; // 空投 1%
    // address public ethFoundation; // 以太坊基金会 0.3%

    // 逻辑合约
    address public mainContract;

    constructor() ERC20("ETIM Token", "ETIM") Ownable(msg.sender) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    // 代币分配
    // function allocateETIM(address _address, uint256 amount) external onlyOwner {
    //     require(_address != address(0) && amount > 0, "Invalid address or amount");
    //     _transfer(address(this), _address, amount);
    // }

    // check contract address
    function _isContract(address addr) private view returns (bool) {
        return addr.code.length > 0;
    }

    // main contract
    function setMainContract(address _mainContract) external onlyOwner {
        // require(mainContract == address(0), "Main already set");
        mainContract = _mainContract;
    }

    // main hook
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        super._update(from, to, value);

        // hook
        if (
            from != address(0) &&
            to != address(0) &&
            to != BURN_ADDRESS &&
            mainContract != address(0) &&
            !_isContract(from) &&
            !_isContract(to)
        ) {
            try IETIMMain(mainContract).procTokenTransfer(from, to, value) {} catch {}
        }
    }
}
