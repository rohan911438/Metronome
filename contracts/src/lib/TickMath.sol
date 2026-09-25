// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title TickMath
/// @notice Price grid for Metronome. Tick t has price P_MIN * 1.001^t, so ticks are 10 bps apart.
/// @dev factor(t) = 1.001^t in WAD, computed by binary exponentiation over the 12 bits of t.
///      Each constant is floor(1.001^(2^i) * 1e18), taken from the exact rational 1001^(2^i) / 1000^(2^i).
library TickMath {
    uint256 internal constant WAD = 1e18;

    /// @notice Number of ticks in the grid. Valid ticks are [0, MAX_TICK].
    uint256 internal constant NUM_TICKS = 4096;
    uint16 internal constant MAX_TICK = 4095;

    error TickOutOfRange(uint256 tick);

    /// @notice 1.001^tick in WAD. factor(0) = 1e18, factor(4095) ~= 59.9e18.
    function factor(uint256 tick) internal pure returns (uint256 f) {
        if (tick > MAX_TICK) revert TickOutOfRange(tick);
        f = WAD;
        if (tick & 0x1 != 0) f = (f * 1_001_000_000_000_000_000) / WAD;
        if (tick & 0x2 != 0) f = (f * 1_002_001_000_000_000_000) / WAD;
        if (tick & 0x4 != 0) f = (f * 1_004_006_004_001_000_000) / WAD;
        if (tick & 0x8 != 0) f = (f * 1_008_028_056_070_056_028) / WAD;
        if (tick & 0x10 != 0) f = (f * 1_016_120_561_824_376_019) / WAD;
        if (tick & 0x20 != 0) f = (f * 1_032_500_996_162_285_568) / WAD;
        if (tick & 0x40 != 0) f = (f * 1_066_058_307_076_112_038) / WAD;
        if (tick & 0x80 != 0) f = (f * 1_136_480_314_085_985_989) / WAD;
        if (tick & 0x100 != 0) f = (f * 1_291_587_504_304_981_365) / WAD;
        if (tick & 0x200 != 0) f = (f * 1_668_198_281_276_770_257) / WAD;
        if (tick & 0x400 != 0) f = (f * 2_782_885_505_654_770_296) / WAD;
        if (tick & 0x800 != 0) f = (f * 7_744_451_737_583_406_558) / WAD;
    }

    /// @notice Price at `tick`, in the same fixed-point units as `priceMin`.
    /// @param priceMin Price of tick 0: quote raw units per base raw unit, scaled by 1e36 (see Metronome.PRICE_SCALE).
    function price(uint256 priceMin, uint256 tick) internal pure returns (uint256) {
        return (priceMin * factor(tick)) / WAD;
    }
}
