// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {TickMath} from "./TickMath.sol";

/// @title ClearingLib
/// @notice Finds the uniform clearing price of one batch. Pure, so it can be fuzzed against a brute-force version.
/// @dev With D(t) = buy size at limit >= t and S(t) = sell size at limit <= t, let t0 be the lowest tick with
///      S(t0) >= D(t0). The volume-maximising tick is t0 or t0 - 1:
///        - D(t0) >= S(t0 - 1): clear at t0,     volume D(t0),     sellers at t0 rationed
///        - otherwise:          clear at t0 - 1, volume S(t0 - 1), buyers at t0 - 1 rationed
///      Only the clearing tick is ever rationed. Every order at a better price fills fully.
library ClearingLib {
    using SafeCast for uint256;

    uint8 internal constant RATIONED_NONE = 0;
    uint8 internal constant RATIONED_BUY = 1;
    uint8 internal constant RATIONED_SELL = 2;

    struct Result {
        uint16 clearingTick;
        uint8 rationed;
        uint128 volume; // base units traded
        uint128 fillNum; // fraction of each rationed order that fills
        uint128 fillDen;
    }

    error TicksNotAscending();
    error LengthMismatch();

    /// @param ticks Active ticks, strictly ascending.
    /// @param buyAt Total buy size at each tick (base units).
    /// @param sellAt Total sell size at each tick (base units).
    function clear(uint16[] memory ticks, uint256[] memory buyAt, uint256[] memory sellAt)
        internal
        pure
        returns (Result memory r)
    {
        uint256 n = ticks.length;
        if (buyAt.length != n || sellAt.length != n) revert LengthMismatch();

        uint256 totalBuy;
        uint256 totalSell;
        for (uint256 i; i < n; ++i) {
            if (i > 0 && ticks[i] <= ticks[i - 1]) revert TicksNotAscending();
            totalBuy += buyAt[i];
            totalSell += sellAt[i];
        }
        if (totalBuy == 0 || totalSell == 0) return r;

        Crossing memory x = _findCrossing(ticks, buyAt, sellAt, totalBuy, totalSell);
        uint256 dT0 = x.dT0;
        uint256 sBefore = x.sBefore;

        if (dT0 >= sBefore) {
            // Clear at t0. Only reachable with t0 <= MAX_TICK: past the end, dT0 = 0 < sBefore = totalSell.
            if (dT0 == 0) return r;
            r.clearingTick = uint16(x.t0);
            r.volume = dT0.toUint128();
            uint256 num = dT0 - sBefore; // sellers at t0 fill this much of sellAtT0
            if (num < x.sellAtT0) {
                r.rationed = RATIONED_SELL;
                r.fillNum = num.toUint128();
                r.fillDen = x.sellAtT0.toUint128();
            }
        } else {
            // Clear at t0 - 1. Here S(t0 - 1) > D(t0) >= 0, so t0 >= 1 and buyAtPrev > 0.
            r.clearingTick = uint16(x.t0 - 1);
            r.volume = sBefore.toUint128();
            r.rationed = RATIONED_BUY;
            r.fillNum = (sBefore - dT0).toUint128(); // buyers at t0 - 1 fill this much of buyAtPrev
            r.fillDen = x.buyAtPrev.toUint128();
        }
    }

    /// @dev Values at the crossing tick t0: D(t0), S(t0 - 1), sells at t0, buys at t0 - 1.
    struct Crossing {
        uint256 t0;
        uint256 dT0;
        uint256 sBefore;
        uint256 sellAtT0;
        uint256 buyAtPrev;
    }

    /// @dev Walks the active ticks, testing each one and the inactive tick right after it (where D drops but S
    ///      stays flat). If S < D everywhere, t0 is one past the end with D(t0) = 0.
    function _findCrossing(
        uint16[] memory ticks,
        uint256[] memory buyAt,
        uint256[] memory sellAt,
        uint256 totalBuy,
        uint256 totalSell
    ) private pure returns (Crossing memory x) {
        uint256 n = ticks.length;
        x.t0 = TickMath.NUM_TICKS;
        x.sBefore = totalSell;
        x.buyAtPrev = ticks[n - 1] == TickMath.MAX_TICK ? buyAt[n - 1] : 0;

        uint256 buyBelow; // buys at ticks < current
        uint256 sellBelow; // sells at ticks < current
        for (uint256 i; i < n; ++i) {
            uint256 t = ticks[i];

            uint256 d = totalBuy - buyBelow;
            if (sellBelow + sellAt[i] >= d) {
                x.t0 = t;
                x.dT0 = d;
                x.sBefore = sellBelow;
                x.sellAtT0 = sellAt[i];
                x.buyAtPrev = (i > 0 && ticks[i - 1] == t - 1) ? buyAt[i - 1] : 0;
                return x;
            }
            buyBelow += buyAt[i];
            sellBelow += sellAt[i];

            bool nextIsActive = i + 1 < n && ticks[i + 1] == t + 1;
            if (t < TickMath.MAX_TICK && !nextIsActive && sellBelow >= totalBuy - buyBelow) {
                x.t0 = t + 1;
                x.dT0 = totalBuy - buyBelow;
                x.sBefore = sellBelow;
                x.buyAtPrev = buyAt[i];
                return x;
            }
        }
    }

    /// @notice Fraction of an order that fills, as (num, den). Full = (1, 1), none = (0, 1).
    function fillFraction(Result memory r, bool isBuy, uint256 tick) internal pure returns (uint256 num, uint256 den) {
        if (r.volume == 0) return (0, 1);
        uint256 t = r.clearingTick;
        bool better = isBuy ? tick > t : tick < t;
        if (better) return (1, 1);
        if (tick != t) return (0, 1);
        bool rationedHere = isBuy ? r.rationed == RATIONED_BUY : r.rationed == RATIONED_SELL;
        if (rationedHere) return (r.fillNum, r.fillDen);
        return (1, 1);
    }
}
