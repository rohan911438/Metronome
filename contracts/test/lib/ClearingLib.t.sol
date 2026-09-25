// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "../../src/lib/TickMath.sol";
import {ClearingLib} from "../../src/lib/ClearingLib.sol";

contract ClearingLibHarness {
    function clear(uint16[] memory ticks, uint256[] memory buyAt, uint256[] memory sellAt)
        external
        pure
        returns (ClearingLib.Result memory)
    {
        return ClearingLib.clear(ticks, buyAt, sellAt);
    }
}

contract ClearingLibTest is Test {
    uint256 internal constant N = TickMath.NUM_TICKS;

    ClearingLibHarness internal h = new ClearingLibHarness();

    struct RawOrder {
        bool isBuy;
        uint16 tick;
        uint96 size;
    }

    // ---------------------------------------------------------------- examples

    function test_noOrders() public view {
        ClearingLib.Result memory r = h.clear(new uint16[](0), new uint256[](0), new uint256[](0));
        assertEq(r.volume, 0);
    }

    function test_onlyBuys() public view {
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _one(100, 5, 0);
        assertEq(h.clear(t, b, s).volume, 0);
    }

    function test_noCross() public view {
        // Buy at 100, sell at 101: nobody trades.
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _two(100, 5, 0, 101, 0, 5);
        assertEq(h.clear(t, b, s).volume, 0);
    }

    function test_exactMatchSameTick() public view {
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _one(100, 5, 5);
        ClearingLib.Result memory r = h.clear(t, b, s);
        assertEq(r.volume, 5);
        assertEq(r.clearingTick, 100);
        assertEq(r.rationed, ClearingLib.RATIONED_NONE);
    }

    function test_sellersRationedAtClearingTick() public view {
        // Buy 5 at 100, sell 8 at 100: sellers get 5/8.
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _one(100, 5, 8);
        ClearingLib.Result memory r = h.clear(t, b, s);
        assertEq(r.volume, 5);
        assertEq(r.clearingTick, 100);
        assertEq(r.rationed, ClearingLib.RATIONED_SELL);
        assertEq(r.fillNum, 5);
        assertEq(r.fillDen, 8);
    }

    function test_buyersRationedAtClearingTick() public view {
        // Buy 8 at 100, sell 5 at 100: buyers get 5/8.
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _one(100, 8, 5);
        ClearingLib.Result memory r = h.clear(t, b, s);
        assertEq(r.volume, 5);
        assertEq(r.clearingTick, 100);
        assertEq(r.rationed, ClearingLib.RATIONED_BUY);
        assertEq(r.fillNum, 5);
        assertEq(r.fillDen, 8);
    }

    function test_crossedBookClearsInsideSpread() public view {
        // Buy 5 at 110, sell 5 at 90: everything fills at one price between them.
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _two(90, 0, 5, 110, 5, 0);
        ClearingLib.Result memory r = h.clear(t, b, s);
        assertEq(r.volume, 5);
        assertGe(r.clearingTick, 90);
        assertLe(r.clearingTick, 110);
        assertEq(r.rationed, ClearingLib.RATIONED_NONE);
    }

    function test_sandwichGetsSamePrice() public view {
        // Attacker buys 10 and sells 10, victim buys 3; a maker sells 3. All at one price, so the attacker's legs cancel.
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _two(100, 13, 10, 101, 0, 3);
        ClearingLib.Result memory r = h.clear(t, b, s);
        assertEq(r.clearingTick, 100);
        assertEq(r.volume, 10);
    }

    function test_clearsAtTickZeroAndMaxTick() public view {
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _one(0, 3, 3);
        assertEq(h.clear(t, b, s).clearingTick, 0);
        (t, b, s) = _one(TickMath.MAX_TICK, 3, 7);
        ClearingLib.Result memory r = h.clear(t, b, s);
        assertEq(r.clearingTick, TickMath.MAX_TICK);
        assertEq(r.volume, 3);
    }

    function test_revertsOnUnsortedTicks() public {
        (uint16[] memory t, uint256[] memory b, uint256[] memory s) = _two(101, 1, 0, 100, 0, 1);
        vm.expectRevert(ClearingLib.TicksNotAscending.selector);
        h.clear(t, b, s);
    }

    // ---------------------------------------------------------------- differential fuzz

    /// @notice ClearingLib must match a brute force that evaluates min(D, S) at every one of the 4096 ticks.
    function testFuzz_matchesBruteForce(RawOrder[12] memory raw, uint8 count, uint8 region) public view {
        uint256[] memory buys = new uint256[](N);
        uint256[] memory sells = new uint256[](N);
        count = uint8(bound(count, 1, raw.length));
        // Cluster ticks into a narrow window so crosses are common; windows at both edges and in the middle.
        uint256 base = [uint256(0), 2040, N - 24][region % 3];
        for (uint256 i; i < count; ++i) {
            uint256 tick = base + (raw[i].tick % 24);
            uint256 size = bound(raw[i].size, 1, type(uint96).max);
            if (raw[i].isBuy) buys[tick] += size;
            else sells[tick] += size;
        }
        _checkAgainstBruteForce(buys, sells);
    }

    /// @notice Same, with small sizes so ties and exact matches happen a lot.
    function testFuzz_matchesBruteForceSmallSizes(RawOrder[12] memory raw, uint8 count) public view {
        uint256[] memory buys = new uint256[](N);
        uint256[] memory sells = new uint256[](N);
        count = uint8(bound(count, 1, raw.length));
        for (uint256 i; i < count; ++i) {
            uint256 tick = 1000 + (raw[i].tick % 8);
            uint256 size = 1 + (raw[i].size % 4);
            if (raw[i].isBuy) buys[tick] += size;
            else sells[tick] += size;
        }
        _checkAgainstBruteForce(buys, sells);
    }

    function _checkAgainstBruteForce(uint256[] memory buys, uint256[] memory sells) internal view {
        ClearingLib.Result memory r = _clearActive(buys, sells);
        (uint256[] memory dAt, uint256[] memory sAt, uint256 best) = _bruteForce(buys, sells);

        // 1. Volume is the maximum possible.
        assertEq(r.volume, best, "volume not maximal");
        if (best == 0) return;

        // 2. The clearing tick actually achieves that volume.
        uint256 c = r.clearingTick;
        assertEq(dAt[c] < sAt[c] ? dAt[c] : sAt[c], best, "clearing tick does not achieve volume");

        // 3. Both sides trade exactly `volume`, counting the rationed tick's fraction.
        _checkSides(r, buys[c], sells[c], c + 1 < N ? dAt[c + 1] : 0, c > 0 ? sAt[c - 1] : 0);
    }

    /// @param buyAtC Buys at the clearing tick.
    /// @param sellAtC Sells at the clearing tick.
    /// @param buyFull Buys strictly above the clearing tick.
    /// @param sellFull Sells strictly below the clearing tick.
    function _checkSides(
        ClearingLib.Result memory r,
        uint256 buyAtC,
        uint256 sellAtC,
        uint256 buyFull,
        uint256 sellFull
    ) internal pure {
        uint256 v = r.volume;
        if (r.rationed == ClearingLib.RATIONED_BUY) {
            assertEq(r.fillDen, buyAtC, "den != buys at clearing tick");
            assertLt(r.fillNum, r.fillDen, "rationed fraction >= 1");
            assertEq(buyFull + r.fillNum, v, "buy side != volume");
            assertEq(sellFull + sellAtC, v, "sell side != volume");
        } else if (r.rationed == ClearingLib.RATIONED_SELL) {
            assertEq(r.fillDen, sellAtC, "den != sells at clearing tick");
            assertLt(r.fillNum, r.fillDen, "rationed fraction >= 1");
            assertEq(sellFull + r.fillNum, v, "sell side != volume");
            assertEq(buyFull + buyAtC, v, "buy side != volume");
        } else {
            assertEq(buyFull + buyAtC, v, "buy side != volume");
            assertEq(sellFull + sellAtC, v, "sell side != volume");
        }
    }

    /// @dev Library input is the active ticks only.
    function _clearActive(uint256[] memory buys, uint256[] memory sells)
        internal
        view
        returns (ClearingLib.Result memory)
    {
        uint256 active;
        for (uint256 t; t < N; ++t) {
            if (buys[t] != 0 || sells[t] != 0) active++;
        }
        uint16[] memory ticks = new uint16[](active);
        uint256[] memory b = new uint256[](active);
        uint256[] memory s = new uint256[](active);
        uint256 k;
        for (uint256 t; t < N; ++t) {
            if (buys[t] != 0 || sells[t] != 0) {
                (ticks[k], b[k], s[k]) = (uint16(t), buys[t], sells[t]);
                k++;
            }
        }
        return h.clear(ticks, b, s);
    }

    /// @dev D(t) = buys at >= t, S(t) = sells at <= t, best = max over t of min(D, S).
    function _bruteForce(uint256[] memory buys, uint256[] memory sells)
        internal
        pure
        returns (uint256[] memory dAt, uint256[] memory sAt, uint256 best)
    {
        dAt = new uint256[](N);
        sAt = new uint256[](N);
        uint256 acc;
        for (uint256 t = N; t > 0; --t) {
            acc += buys[t - 1];
            dAt[t - 1] = acc;
        }
        acc = 0;
        for (uint256 t; t < N; ++t) {
            acc += sells[t];
            sAt[t] = acc;
        }
        for (uint256 t; t < N; ++t) {
            uint256 v = dAt[t] < sAt[t] ? dAt[t] : sAt[t];
            if (v > best) best = v;
        }
    }

    // ---------------------------------------------------------------- helpers

    function _one(uint16 tick, uint256 buy, uint256 sell)
        internal
        pure
        returns (uint16[] memory t, uint256[] memory b, uint256[] memory s)
    {
        t = new uint16[](1);
        b = new uint256[](1);
        s = new uint256[](1);
        (t[0], b[0], s[0]) = (tick, buy, sell);
    }

    function _two(uint16 t0, uint256 b0, uint256 s0, uint16 t1, uint256 b1, uint256 s1)
        internal
        pure
        returns (uint16[] memory t, uint256[] memory b, uint256[] memory s)
    {
        t = new uint16[](2);
        b = new uint256[](2);
        s = new uint256[](2);
        (t[0], b[0], s[0]) = (t0, b0, s0);
        (t[1], b[1], s[1]) = (t1, b1, s1);
    }
}
