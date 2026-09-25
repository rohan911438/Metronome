// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title MiniAMM
/// @notice Minimal constant-product (x*y=k) pool, used only to show what a sandwich attack does to a normal AMM.
///         No LP shares: liquidity added here can't be withdrawn. Never use for real funds.
contract MiniAMM {
    using SafeERC20 for IERC20;

    IERC20 public immutable BASE;
    IERC20 public immutable QUOTE;
    uint256 public constant FEE_BPS = 30; // 0.3%, like Uniswap v2

    uint256 public reserveBase;
    uint256 public reserveQuote;

    event Swap(address indexed sender, bool buyBase, uint256 amountIn, uint256 amountOut);

    error InsufficientLiquidity();
    error Slippage();

    constructor(IERC20 base, IERC20 quote) {
        BASE = base;
        QUOTE = quote;
    }

    function addLiquidity(uint256 baseAmount, uint256 quoteAmount) external {
        BASE.safeTransferFrom(msg.sender, address(this), baseAmount);
        QUOTE.safeTransferFrom(msg.sender, address(this), quoteAmount);
        reserveBase += baseAmount;
        reserveQuote += quoteAmount;
    }

    /// @notice Quote needed to buy exactly `baseOut`, fee included.
    function quoteForBase(uint256 baseOut) public view returns (uint256) {
        if (baseOut >= reserveBase) revert InsufficientLiquidity();
        uint256 inAfterFee = Math.mulDiv(reserveQuote, baseOut, reserveBase - baseOut, Math.Rounding.Ceil);
        return Math.mulDiv(inAfterFee, 10_000, 10_000 - FEE_BPS, Math.Rounding.Ceil);
    }

    /// @notice Quote received for selling exactly `baseIn`, fee included.
    function quoteForSellingBase(uint256 baseIn) public view returns (uint256) {
        uint256 inAfterFee = (baseIn * (10_000 - FEE_BPS)) / 10_000;
        return (reserveQuote * inAfterFee) / (reserveBase + inAfterFee);
    }

    /// @notice Spot price: raw quote per raw base, scaled by 1e36 (same units as Metronome.price).
    function spotPrice() external view returns (uint256) {
        return Math.mulDiv(reserveQuote, 1e36, reserveBase);
    }

    function buyBase(uint256 baseOut, uint256 maxQuoteIn, address to) external returns (uint256 quoteIn) {
        quoteIn = quoteForBase(baseOut);
        if (quoteIn > maxQuoteIn) revert Slippage();
        QUOTE.safeTransferFrom(msg.sender, address(this), quoteIn);
        reserveQuote += quoteIn;
        reserveBase -= baseOut;
        BASE.safeTransfer(to, baseOut);
        emit Swap(msg.sender, true, quoteIn, baseOut);
    }

    function sellBase(uint256 baseIn, uint256 minQuoteOut, address to) external returns (uint256 quoteOut) {
        quoteOut = quoteForSellingBase(baseIn);
        if (quoteOut < minQuoteOut) revert Slippage();
        BASE.safeTransferFrom(msg.sender, address(this), baseIn);
        reserveBase += baseIn;
        reserveQuote -= quoteOut;
        QUOTE.safeTransfer(to, quoteOut);
        emit Swap(msg.sender, false, baseIn, quoteOut);
    }
}
