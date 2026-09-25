// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TickMath} from "../../src/lib/TickMath.sol";
import {TickBitmap} from "../../src/lib/TickBitmap.sol";

contract TickBitmapHarness {
    using TickBitmap for TickBitmap.Map;

    TickBitmap.Map internal map;

    function set(uint256 tick) external {
        map.set(tick);
    }

    function isSet(uint256 tick) external view returns (bool) {
        return map.isSet(tick);
    }

    function summary() external view returns (uint256) {
        return map.summary;
    }

    function word(uint256 i) external view returns (uint256) {
        return map.words[i];
    }

    function orInto(uint256[16] memory acc) external view returns (uint256[16] memory, uint256 summary_) {
        summary_ = map.orInto(acc);
        return (acc, summary_);
    }

    function lowestBit(uint256 x) external pure returns (uint256) {
        return TickBitmap.lowestBit(x);
    }
}

contract TickBitmapTest is Test {
    TickBitmapHarness internal h;

    function setUp() public {
        h = new TickBitmapHarness();
    }

    function test_setAndIsSet() public {
        assertFalse(h.isSet(0));
        h.set(0);
        h.set(300);
        h.set(4095);
        assertTrue(h.isSet(0));
        assertTrue(h.isSet(300));
        assertTrue(h.isSet(4095));
        assertFalse(h.isSet(1));
        assertEq(h.summary(), (1 << 0) | (1 << 1) | (1 << 15));
        assertEq(h.word(1), 1 << (300 - 256));
    }

    function test_setIsIdempotent() public {
        h.set(42);
        h.set(42);
        assertEq(h.word(0), 1 << 42);
        assertEq(h.summary(), 1);
    }

    function test_revertsOutOfRange() public {
        vm.expectRevert(abi.encodeWithSelector(TickMath.TickOutOfRange.selector, 4096));
        h.set(4096);
    }

    function test_orIntoMergesWithExisting() public {
        h.set(5);
        h.set(700);
        uint256[16] memory acc;
        acc[0] = 1 << 6;
        acc[3] = 1;
        (uint256[16] memory out, uint256 s) = h.orInto(acc);
        assertEq(out[0], (1 << 5) | (1 << 6));
        assertEq(out[2], 1 << (700 - 512));
        assertEq(out[3], 1);
        assertEq(s, (1 << 0) | (1 << 2));
    }

    function testFuzz_orIntoRecoversExactlyTheSetTicks(uint16[20] memory raw) public {
        uint256[16] memory expected;
        for (uint256 i; i < raw.length; ++i) {
            uint256 t = raw[i] % TickMath.NUM_TICKS;
            h.set(t);
            expected[t >> 8] |= 1 << (t & 0xff);
        }
        uint256[16] memory acc;
        (uint256[16] memory out, uint256 s) = h.orInto(acc);
        for (uint256 i; i < 16; ++i) {
            assertEq(out[i], expected[i]);
            assertEq((s >> i) & 1 == 1, expected[i] != 0);
        }
    }

    function testFuzz_lowestBit(uint256 x) public view {
        vm.assume(x != 0);
        uint256 r = h.lowestBit(x);
        assertTrue((x >> r) & 1 == 1, "bit not set");
        if (r > 0) assertEq(x & ((1 << r) - 1), 0, "lower bit set");
    }

    function test_lowestBitEdges() public view {
        assertEq(h.lowestBit(1), 0);
        assertEq(h.lowestBit(1 << 255), 255);
        assertEq(h.lowestBit(type(uint256).max), 0);
        assertEq(h.lowestBit(0x100), 8);
    }
}
