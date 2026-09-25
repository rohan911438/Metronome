// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "../../src/lib/TickMath.sol";

contract TickMathHarness {
    function factor(uint256 tick) external pure returns (uint256) {
        return TickMath.factor(tick);
    }
}

contract TickMathTest is Test {
    TickMathHarness internal h = new TickMathHarness();

    function test_factorAtZeroIsOne() public view {
        assertEq(h.factor(0), 1e18);
    }

    function test_factorAtMaxTick() public view {
        // floor(1.001^4095 * 1e18), computed offline with exact rationals.
        assertApproxEqRel(h.factor(4095), 59_916_616_099_658_986_059, 1e2); // within 1e-16
    }

    /// @notice Every tick against a 1e36-precision reference built by repeated multiplication by 1.001.
    function test_allTicksMatchReference() public view {
        uint256 ref = 1e36;
        uint256 prev;
        for (uint256 t; t < TickMath.NUM_TICKS; ++t) {
            uint256 f = h.factor(t);
            uint256 expected = ref / 1e18;
            uint256 diff = f > expected ? f - expected : expected - f;
            assertLe(diff, expected / 1e16 + 1, "factor off by more than 1e-16");
            if (t > 0) {
                assertGt(f, prev, "not strictly increasing");
                // Consecutive ticks are exactly 10 bps apart, up to rounding.
                assertApproxEqRel(f * 1000, prev * 1001, 1e3);
            }
            prev = f;
            ref = (ref * 1001) / 1000;
        }
    }

    function test_revertsAboveMaxTick() public {
        vm.expectRevert(abi.encodeWithSelector(TickMath.TickOutOfRange.selector, 4096));
        h.factor(4096);
    }

    function testFuzz_priceScalesWithPriceMin(uint256 tick, uint128 priceMin) public pure {
        tick = bound(tick, 0, TickMath.MAX_TICK);
        uint256 p = TickMath.price(priceMin, tick);
        assertEq(p, (uint256(priceMin) * TickMath.factor(tick)) / 1e18);
        assertGe(p, priceMin);
    }
}
