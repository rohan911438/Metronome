// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TickMath} from "./TickMath.sol";

/// @title TickBitmap
/// @notice Two-level bitmap over the 4096 ticks: 16 words of 256 bits, plus a summary word whose bit i is set
///         when word i has any bit set. Reading the set ticks costs 1 SLOAD + 1 per non-empty word.
/// @dev Batch bitmaps are only ever set (a batch is never reused). Resting-pool bitmaps are also unset when a pool empties.
library TickBitmap {
    uint256 internal constant NUM_WORDS = 16; // TickMath.NUM_TICKS / 256

    struct Map {
        uint256 summary;
        uint256[NUM_WORDS] words;
    }

    /// @notice Marks `tick` as active. Only writes storage when a bit actually changes.
    function set(Map storage self, uint256 tick) internal {
        if (tick > TickMath.MAX_TICK) revert TickMath.TickOutOfRange(tick);
        uint256 wordIndex = tick >> 8;
        uint256 mask = 1 << (tick & 0xff);
        uint256 word = self.words[wordIndex];
        if (word & mask != 0) return;
        if (word == 0) self.summary |= 1 << wordIndex;
        self.words[wordIndex] = word | mask;
    }

    /// @notice Clears `tick`. Only writes storage when a bit actually changes.
    function unset(Map storage self, uint256 tick) internal {
        if (tick > TickMath.MAX_TICK) revert TickMath.TickOutOfRange(tick);
        uint256 wordIndex = tick >> 8;
        uint256 mask = 1 << (tick & 0xff);
        uint256 word = self.words[wordIndex];
        if (word & mask == 0) return;
        word &= ~mask;
        self.words[wordIndex] = word;
        if (word == 0) self.summary &= ~(1 << wordIndex);
    }

    function isSet(Map storage self, uint256 tick) internal view returns (bool) {
        if (tick > TickMath.MAX_TICK) revert TickMath.TickOutOfRange(tick);
        return self.words[tick >> 8] & (1 << (tick & 0xff)) != 0;
    }

    /// @notice ORs this bitmap's non-empty words into `acc` (memory), skipping empty words via the summary.
    ///         Used by settle to merge the K shard bitmaps of one batch.
    /// @return summary The summary word, so callers can OR summaries too.
    function orInto(Map storage self, uint256[NUM_WORDS] memory acc) internal view returns (uint256 summary) {
        summary = self.summary;
        uint256 remaining = summary;
        while (remaining != 0) {
            uint256 i = lowestBit(remaining);
            acc[i] |= self.words[i];
            remaining &= remaining - 1;
        }
    }

    /// @notice Like orInto, but only the ticks in [lo, hi]. Reads at most the words that range spans.
    function orIntoRange(Map storage self, uint256[NUM_WORDS] memory acc, uint256 lo, uint256 hi) internal view {
        uint256 summary = self.summary;
        for (uint256 i = lo >> 8; i <= hi >> 8; ++i) {
            if ((summary >> i) & 1 == 0) continue;
            uint256 mask = type(uint256).max;
            if (i == lo >> 8) mask &= type(uint256).max << (lo & 0xff);
            if (i == hi >> 8) mask &= type(uint256).max >> (255 - (hi & 0xff));
            acc[i] |= self.words[i] & mask;
        }
    }

    /// @notice Index of the lowest set bit of `x`. `x` must be non-zero.
    function lowestBit(uint256 x) internal pure returns (uint256 r) {
        // Isolate the lowest set bit, then take its log2 with a binary search.
        x &= ~x + 1;
        if (x >= 1 << 128) {
            x >>= 128;
            r += 128;
        }
        if (x >= 1 << 64) {
            x >>= 64;
            r += 64;
        }
        if (x >= 1 << 32) {
            x >>= 32;
            r += 32;
        }
        if (x >= 1 << 16) {
            x >>= 16;
            r += 16;
        }
        if (x >= 1 << 8) {
            x >>= 8;
            r += 8;
        }
        if (x >= 1 << 4) {
            x >>= 4;
            r += 4;
        }
        if (x >= 1 << 2) {
            x >>= 2;
            r += 2;
        }
        if (x >= 1 << 1) r += 1;
    }
}
