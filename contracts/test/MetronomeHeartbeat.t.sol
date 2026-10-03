// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {MetronomeTestBase} from "./Metronome.t.sol";
import {IMetronome} from "../src/interfaces/IMetronome.sol";
import {MetronomeHeartbeat, IReceiver} from "../src/cre/MetronomeHeartbeat.sol";

contract MetronomeHeartbeatTest is MetronomeTestBase {
    MetronomeHeartbeat internal hb;
    address internal forwarder = makeAddr("forwarder");

    function setUp() public override {
        super.setUp();
        hb = new MetronomeHeartbeat(IMetronome(address(m)), forwarder, owner);
    }

    function _report(uint256 batchId) internal {
        vm.prank(forwarder);
        hb.onReport("", abi.encode(batchId, int256(0), uint256(0)));
    }

    function test_reportSettlesEveryPendingBatch() public {
        uint256 b1 = block.number;
        _buy(alice, T, 10e18);
        _sell(bob, T, 10e18);
        _next();
        uint256 b2 = block.number;
        _buy(carol, T, 5e18);
        _sell(dave, T, 5e18);
        _next();
        assertEq(m.nextPendingBatch(), b1);

        vm.expectEmit(address(hb));
        emit MetronomeHeartbeat.Heartbeat(b2);
        _report(b2);

        assertTrue(m.getBatchResult(b1).settled);
        assertTrue(m.getBatchResult(b2).settled);
        assertEq(m.getBatchResult(b2).volume, 5e18);
        assertEq(m.nextPendingBatch(), 0);
    }

    function test_repeatReportIsHarmless() public {
        uint256 b = block.number;
        _buy(alice, T, 10e18);
        _sell(bob, T, 10e18);
        _next();
        _report(b);
        _report(b);
        assertEq(m.getBatchResult(b).volume, 10e18);
    }

    function test_onlyForwarder() public {
        vm.expectRevert(abi.encodeWithSelector(MetronomeHeartbeat.NotForwarder.selector, alice));
        vm.prank(alice);
        hb.onReport("", abi.encode(uint256(1), int256(0), uint256(0)));
    }

    function test_openBatchReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IMetronome.BatchNotClosed.selector, block.number));
        _report(block.number);
    }

    function test_settleRewardIsSwept() public {
        vm.prank(owner);
        m.setFees(FEE_BPS, 1e3);
        // First batch builds up fees (they accrue on claim, after settle).
        bytes32 a = _buy(alice, T, 100e18);
        _sell(bob, T, 100e18);
        _next();
        m.claim(a);
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        _report(block.number - 1);
        assertEq(ausd.balanceOf(address(hb)), 1e3);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        vm.prank(alice);
        hb.sweep(IERC20(address(ausd)), alice);

        vm.prank(owner);
        hb.sweep(IERC20(address(ausd)), owner);
        assertEq(ausd.balanceOf(address(hb)), 0);
    }

    function test_setForwarder() public {
        address real = makeAddr("real");
        vm.prank(owner);
        hb.setForwarder(real);
        vm.expectRevert(abi.encodeWithSelector(MetronomeHeartbeat.NotForwarder.selector, forwarder));
        _report(1);
    }

    // ------------------------------------------------------------------ CRE price feed

    function _priceReport(uint256 batchId, int256 price, uint256 observedAt) internal {
        vm.prank(forwarder);
        hb.onReport("", abi.encode(batchId, price, observedAt));
    }

    function test_priceOnlyReportStoresPriceWithoutSettling() public {
        uint256 b = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        vm.warp(1000);

        vm.expectEmit(address(hb));
        emit MetronomeHeartbeat.PriceUpdated(1, 3.16e6, 990);
        _priceReport(0, 3.16e6, 990);

        (uint80 roundId, int256 answer,, uint256 updatedAt,) = hb.latestRoundData();
        assertEq(roundId, 1);
        assertEq(answer, 3.16e6);
        assertEq(updatedAt, 990);
        assertEq(hb.decimals(), 8);
        assertEq(m.nextPendingBatch(), b); // nothing settled
    }

    function test_olderOrFutureOrNonPositivePriceIsIgnored() public {
        vm.warp(1000);
        _priceReport(0, 3e6, 990);
        _priceReport(0, 4e6, 980); // older than the stored price
        _priceReport(0, 5e6, 1001); // from the future
        _priceReport(0, 0, 995); // not a price
        _priceReport(0, -1, 995);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = hb.latestRoundData();
        assertEq(roundId, 1);
        assertEq(answer, 3e6);
        assertEq(updatedAt, 990);
    }

    /// The receiver is the market's price feed: a report stores the price first, then settles against it.
    function test_guardReadsReportedPrice() public {
        vm.prank(owner);
        m.setOracle(address(hb), 500, 1 hours);

        vm.warp(1000);
        uint256 b1 = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        _priceReport(b1, 1e8, 1000); // $1: the batch clears near $1
        assertFalse(m.getBatchResult(b1).voided);
        assertEq(m.getBatchResult(b1).volume, 1e18);

        uint256 b2 = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        vm.warp(1010);
        _priceReport(b2, 2e8, 1010); // $2: 100% away, the batch is voided and refunded
        assertTrue(m.getBatchResult(b2).voided);
    }

    function test_supportsInterface() public view {
        assertTrue(hb.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(hb.supportsInterface(type(IERC165).interfaceId));
        assertFalse(hb.supportsInterface(0xffffffff));
    }
}
