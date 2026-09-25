// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {TickMath} from "../src/lib/TickMath.sol";

contract DeployTest is Test {
    Deploy internal d = new Deploy();

    /// @notice The reference price must land on tick 2048, within rounding.
    function testFuzz_priceMinCentersReferencePrice(uint256 refPrice) public view {
        refPrice = bound(refPrice, 0.0001e18, 100_000e18);
        uint256 priceMin = d.priceMinFor(refPrice, 18, 6);
        uint256 atCenter = TickMath.price(priceMin, 2048);
        uint256 expected = (refPrice * 1e6 * 1e36) / (1e18 * 1e18);
        assertApproxEqRel(atCenter, expected, 1e9); // within 1e-9
    }

    function test_monAtTwoAndAHalfCents() public view {
        uint256 priceMin = d.priceMinFor(0.025e18, 18, 6);
        // 0.025 AUSD per MON = 0.025 * 1e6 / 1e18 raw, scaled by 1e36 = 2.5e22.
        assertApproxEqRel(TickMath.price(priceMin, 2048), 2.5e22, 1e9);
        // The grid spans roughly 7.7x below and above the reference.
        assertApproxEqRel(TickMath.price(priceMin, 0) * 7744, 2.5e22 * 1000, 1e15);
    }
}
