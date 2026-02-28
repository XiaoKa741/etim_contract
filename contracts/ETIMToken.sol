// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

// progress transfer — no business logic
interface IETIMMain {
    function onTokenTransfer(address from, address to, uint256 value) external;
}

contract ETIMToken is ERC20, Ownable {

    // =========================================================
    //                      CONSTANTS
    // =========================================================

    uint256 public constant TOTAL_SUPPLY = 2_100_000_000 * 10 ** 18;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Module allocation amounts (for reference / off-chain verification)
    // uint256 public constant GROWTH_POOL_SUPPLY  = 1_925_700_000 * 10 ** 18; // 91.7%
    // uint256 public constant MARKET_INFRA_SUPPLY =   105_000_000 * 10 ** 18; // 5%
    // uint256 public constant ECOSYSTEM_SUPPLY    =    21_000_000 * 10 ** 18; // 1%
    // uint256 public constant COMMUNITY_SUPPLY    =    21_000_000 * 10 ** 18; // 1%
    // uint256 public constant AIRDROP_SUPPLY      =    21_000_000 * 10 ** 18; // 1%
    // uint256 public constant ETH_FOUNDATION_SUPPLY =   6_300_000 * 10 ** 18; // 0.3%

    // =========================================================
    //                       STATE
    // =========================================================
    address public mainContract;

    // =========================================================
    //                      EVENTS
    // =========================================================

    event MainContractSet(address indexed main);

    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        _mint(msg.sender, TOTAL_SUPPLY);
    }

    // Check contract address
    function _isContract(address addr) private view returns (bool) {
        return addr.code.length > 0;
    }

    // Set business contract
    function setMainContract(address _mainContract) external onlyOwner {
        mainContract = _mainContract;
        emit MainContractSet(_mainContract);
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        // Transfer executes unconditionally
        super._update(from, to, value);

        // Notify
        if (_shouldNotifyMain(from, to)) {
            try IETIMMain(mainContract).onTokenTransfer(from, to, value) {} catch {}
        }
    }

    // Returns true if should be notified for this transfer
    function _shouldNotifyMain(address from, address to) private view returns (bool) {
        return mainContract != address(0)
            && from != address(0)
            && to   != address(0)
            && to   != BURN_ADDRESS
            && !_isContract(from)
            && !_isContract(to);
    }
}
