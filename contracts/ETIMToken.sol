// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

// progress transfer — no business logic
interface IETIMMain {
    function onTokenTransfer(address from, address to, uint256 value) external;
    function onTokenBalanceChanged(address from, address to, uint256 value) external;
}

contract ETIMToken is ERC20, Ownable2Step {

    // =========================================================
    //                      CONSTANTS
    // =========================================================

    uint256 public constant TOTAL_SUPPLY = 100_000_000 * 10 ** 18;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // Module allocation amounts — total 100,000,000 ETIM (for reference / off-chain verification)
    // uint256 public constant GROWTH_POOL_SUPPLY      = 84_900_000 * 10 ** 18; // 84.9%
    // uint256 public constant MARKET_INFRA_SUPPLY     =  5_000_000 * 10 ** 18; // 5%
    // uint256 public constant ECOSYSTEM_SUPPLY        =  1_000_000 * 10 ** 18; // 1%
    // uint256 public constant COMMUNITY_SUPPLY        =  4_000_000 * 10 ** 18; // 4%
    // uint256 public constant AIRDROP_SUPPLY          =  5_000_000 * 10 ** 18; // 5%
    // uint256 public constant ETH_FOUNDATION_SUPPLY   =    100_000 * 10 ** 18; // 0.1%

    // =========================================================
    //                       STATE
    // =========================================================
    address public mainContract;
    mapping(address => bool) public excludedFromCallback;  // DEX pool / router etc.

    // =========================================================
    //                      EVENTS
    // =========================================================

    event MainContractSet(address indexed main);
    event ExcludedFromCallbackSet(address indexed addr, bool excluded);
    event CallbackFailed(string callbackName, address indexed from, address indexed to, uint256 value, bytes reason);

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

    // Exclude address from triggering main callbacks (e.g. DEX pool, router)
    function setExcludedFromCallback(address addr, bool excluded) external onlyOwner {
        excludedFromCallback[addr] = excluded;
        emit ExcludedFromCallbackSet(addr, excluded);
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
            try IETIMMain(mainContract).onTokenTransfer(from, to, value) {} catch (bytes memory reason) {
                emit CallbackFailed("onTokenTransfer", from, to, value, reason);
            }
        } else if (_shouldNotifyBalanceChange(from, to)) {
            try IETIMMain(mainContract).onTokenBalanceChanged(from, to, value) {} catch (bytes memory reason) {
                emit CallbackFailed("onTokenBalanceChanged", from, to, value, reason);
            }
        }
    }

    // Any address <-> Any address (except mint/burn/excluded), triggers full transfer callback
    // Supports both EOA and contract wallets (e.g. multisig, AA wallets)
    function _shouldNotifyMain(address from, address to) private view returns (bool) {
        return mainContract != address(0)
            && from != address(0)
            && to   != address(0)
            && to   != BURN_ADDRESS
            && from != mainContract
            && to   != mainContract
            && !excludedFromCallback[from]
            && !excludedFromCallback[to];
    }

    // Transfers involving mainContract, burn, or excluded addresses (DEX pool/router),
    // triggers balance change callback only (no referral binding, but team balance updated)
    function _shouldNotifyBalanceChange(address from, address to) private view returns (bool) {
        if (mainContract == address(0)) return false;
        if (from == address(0) || to == address(0)) return false;
        // Excluded addresses (DEX): notify balance change so team token balances stay in sync
        if (excludedFromCallback[from] || excludedFromCallback[to]) return true;
        // mainContract or burn address: notify balance change (not full transfer)
        if (from == mainContract || to == mainContract || to == BURN_ADDRESS) return true;
        return false;
    }
}
