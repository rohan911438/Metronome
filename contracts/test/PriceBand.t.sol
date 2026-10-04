// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IMetronome} from "../src/interfaces/IMetronome.sol";
import {TickBitmap} from "../src/lib/TickBitmap.sol";
import {MetronomeTestBase} from "./Metronome.t.sol";

/// @notice The price band keeps settle bounded: resting pools live until filled or cancelled, so settle only reads
///         the pools within PRICE_BAND ticks of the last clearing price, and new orders must be inside the band.
contract PriceBandTest is MetronomeTestBase {
    function _trade(uint16 tick) internal {
        _buy(alice, tick, 1e18);
        _sell(bob, tick, 1e18);
        _next();
        m.settle(block.number - 1);
        assertEq(m.getBatchResult(block.number - 1).clearingTick, tick);
    }

    /// @dev Fills every tick of [lo, hi] with 1-MON resting orders that don't cross: buys below `mid`, sells from it up.
    function _fillTicks(uint256 lo, uint256 hi, uint256 mid) internal {
        wmon.mint(carol, 1000e18);
        ausd.mint(carol, 1_000_000e6);
        for (uint256 t = lo; t <= hi; ++t) {
            vm.prank(carol);
            m.placeOrder(t < mid, uint16(t), 1e18, true);
        }
        _next();
        m.settle(block.number - 1);
    }

    function _settleGas() internal returns (uint256 used) {
        _buy(alice, uint16(m.lastClearingTick() + 1), 1e18);
        _next();
        uint256 g = gasleft();
        m.settle(block.number - 1);
        used = g - gasleft();
    }

    function test_noBandBeforeTheFirstTrade() public {
        _buy(alice, 10, 1e18);
        _sell(bob, 4000, 1e18);
    }

    function test_bandAroundLastClearingPrice() public {
        _trade(T);
        uint256 band = m.PRICE_BAND();
        _buy(alice, uint16(T + band), 1e18); // edges are inside
        _sell(bob, uint16(T - band), 1e18);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.OutsidePriceBand.selector, T + band + 1, T));
        _buy(alice, uint16(T + band + 1), 1e18);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.OutsidePriceBand.selector, T - band - 1, T));
        m.placeOrder(false, uint16(T - band - 1), 1e18, true);
    }

    function test_bandMovesWithThePrice() public {
        _trade(T);
        uint16 up = uint16(T + 100);
        _trade(up);
        _buy(alice, uint16(up + m.PRICE_BAND()), 1e18); // out of reach from T, fine from the new price
    }

    function test_poolOutsideTheBandWaitsAndWakesUp() public {
        _trade(T);
        // A resting ask 100 ticks up, then the price walks down until the ask is outside the band.
        vm.prank(bob);
        bytes32 ask = m.placeOrder(false, uint16(T + 100), 5e18, true);
        _trade(uint16(T - 60));
        _trade(uint16(T - 120)); // ask is now 220 ticks away
        // A buyer at the band edge can't reach it: the batch has no seller, so nothing trades.
        uint256 band = m.PRICE_BAND();
        _buy(alice, uint16(T - 120 + band), 1e18);
        _next();
        m.settle(block.number - 1);
        assertEq(m.getBatchResult(block.number - 1).volume, 0, "dormant pool doesn't trade");
        assertEq(m.getPool(false, uint16(T + 100)).remaining, 5e18);

        // The price comes back up; the ask is inside the band again and fills.
        _trade(uint16(T - 20));
        _buy(alice, uint16(T + 100), 2e18);
        _next();
        m.settle(block.number - 1);
        assertEq(m.getBatchResult(block.number - 1).clearingTick, T + 100);
        assertEq(m.getPool(false, uint16(T + 100)).remaining, 3e18);
        (, uint256 proceeds) = m.claim(ask);
        assertGt(proceeds, 0);
    }

    function test_settleReadsOnlyTheBand() public {
        _trade(T);
        uint256 band = m.PRICE_BAND();
        // An attacker fills the lower half of the band with resting buys...
        _fillTicks(T - band, T, T + 1);
        uint256 gasOneBand = _settleGas();

        // ...the price moves up a full band, and the attacker fills the new band's lower half too.
        _trade(uint16(T + band));
        uint256 ref = m.lastClearingTick();
        _fillTicks(ref - band, ref, ref + 1);
        (uint16[] memory live,,) = m.getRestingBook();
        assertGt(live.length, 2 * band, "about twice as many pools as one band holds");

        uint256 gasLater = _settleGas();
        emit log_named_uint("settle gas, band half full", gasOneBand);
        emit log_named_uint("settle gas, twice the pools", gasLater);
        // Settle cost depends on the band, not on how many pools exist.
        assertLt(gasLater, gasOneBand * 12 / 10);
    }
}

contract TickBitmapRangeTest is MetronomeTestBase {
    using TickBitmap for TickBitmap.Map;

    TickBitmap.Map internal map;

    function testFuzz_orIntoRangeMatchesNaive(uint256 seed, uint256 lo, uint256 hi) public {
        lo = bound(lo, 0, 4095);
        hi = bound(hi, lo, 4095);
        for (uint256 i; i < 40; ++i) {
            map.set(uint256(keccak256(abi.encode(seed, i))) % 4096);
        }
        uint256[16] memory got;
        map.orIntoRange(got, lo, hi);
        uint256[16] memory all;
        map.orInto(all);
        for (uint256 t; t < 4096; ++t) {
            bool want = t >= lo && t <= hi && (all[t >> 8] >> (t & 0xff)) & 1 == 1;
            assertEq((got[t >> 8] >> (t & 0xff)) & 1 == 1, want);
        }
    }
}
