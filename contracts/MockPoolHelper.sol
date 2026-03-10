// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IETIMMainForMock {
    function onTokenTransfer(address from, address to, uint256 value) external;
}

/// @notice Mock implementation of IETIMPoolHelper for testing purposes
contract MockPoolHelper {
    IERC20 public etimToken;
    address public mainContract;

    uint256 private _etimPerEth;
    uint256 private _usdcPerEth;
    uint256 private _ethReserves;

    constructor(address _etimToken) {
        etimToken = IERC20(_etimToken);
    }

    function setMainContract(address _mainContract) external {
        mainContract = _mainContract;
    }

    function setEtimPerEth(uint256 value) external {
        _etimPerEth = value;
    }

    function setUsdcPerEth(uint256 value) external {
        _usdcPerEth = value;
    }

    function setEthReserves(uint256 value) external {
        _ethReserves = value;
    }

    function getEthReserves() external view returns (uint256) {
        return _ethReserves;
    }

    function getEtimPerEth() external view returns (uint256) {
        return _etimPerEth;
    }

    function getUsdcPerEth() external view returns (uint256) {
        return _usdcPerEth;
    }

    /// @notice Simulate ETH→ETIM swap: absorb ETH and return equivalent ETIM amount.
    /// ETIMMain already holds the growth-pool ETIM, so no actual token transfer is needed —
    /// the return value is used only for rewardPerNode accounting.
    function swapEthToEtim(uint256 ethAmount) external payable returns (uint256) {
        require(msg.value == ethAmount, "MockPoolHelper: ETH mismatch");
        uint256 etimAmount = (ethAmount * _etimPerEth) / 1e18;
        return etimAmount;
    }

    /// @notice Simulate ETIM→ETH swap: consume ETIM, return ETH to recipient
    function swapEtimToEth(uint256 etimAmount, address to) external returns (uint256) {
        etimToken.transferFrom(msg.sender, address(this), etimAmount);
        // Calculate ETH: etimAmount / etimPerEth * 1e18
        uint256 ethAmount = 0;
        if (_etimPerEth > 0) {
            ethAmount = (etimAmount * 1e18) / _etimPerEth;
        }
        if (ethAmount > 0 && address(this).balance >= ethAmount) {
            payable(to).transfer(ethAmount);
        }
        return ethAmount;
    }

    /// @notice Simulate swap + add liquidity (absorb ETH, no-op for tests)
    function swapAndAddLiquidity(uint256 /*ethAmount*/) external payable {
        // Absorb the ETH, simulate LP addition
    }

    /// @notice Simulate swap + burn (absorb ETH, no-op for tests)
    function swapAndBurn(uint256 /*ethAmount*/) external payable {
        // Absorb the ETH, simulate burn
    }

    receive() external payable {}
}
