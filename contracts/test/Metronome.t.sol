// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {Metronome} from "../src/Metronome.sol";
import {IMetronome} from "../src/interfaces/IMetronome.sol";
import {TickMath} from "../src/lib/TickMath.sol";
import {ClearingLib} from "../src/lib/ClearingLib.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockAggregator} from "../src/mocks/MockAggregator.sol";

contract MetronomeTestBase is Test {
    // Tick 0 = 0.1 AUSD per MON. Raw units: 0.1 * 1e6 / 1e18, scaled by 1e36.
    uint256 internal constant PRICE_MIN = 1e23;
    uint256 internal constant SHARDS = 4;
    uint256 internal constant MIN_SIZE = 1e15; // 0.001 MON
    uint16 internal constant FEE_BPS = 5;

    uint16 internal constant T = 2303; // ~1.00 AUSD per MON

    MockERC20 internal wmon;
    MockERC20 internal ausd;
    Metronome internal m;

    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal keeper = makeAddr("keeper");

    function setUp() public virtual {
        wmon = new MockERC20("Wrapped MON", "WMON", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        m = new Metronome(IERC20(address(wmon)), IERC20(address(ausd)), PRICE_MIN, SHARDS, MIN_SIZE, FEE_BPS, 0, owner);
        address[4] memory users = [alice, bob, carol, dave];
        for (uint256 i; i < users.length; ++i) {
            _fund(users[i]);
        }
    }

    function _fund(address u) internal {
        wmon.mint(u, 1_000_000e18);
        ausd.mint(u, 1_000_000e6);
        vm.startPrank(u);
        wmon.approve(address(m), type(uint256).max);
        ausd.approve(address(m), type(uint256).max);
        vm.stopPrank();
    }

    function _buy(address u, uint16 tick, uint128 size) internal returns (bytes32) {
        vm.prank(u);
        return m.placeOrder(true, tick, size, false);
    }

    function _sell(address u, uint16 tick, uint128 size) internal returns (bytes32) {
        vm.prank(u);
        return m.placeOrder(false, tick, size, false);
    }

    function _next() internal {
        vm.roll(block.number + 1);
    }

    function _cost(uint256 size, uint256 tick) internal view returns (uint256) {
        return Math.mulDiv(size, m.price(tick), 1e36, Math.Rounding.Ceil);
    }

    function _proceeds(uint256 size, uint256 tick) internal view returns (uint256) {
        return Math.mulDiv(size, m.price(tick), 1e36);
    }

    function _fee(uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, m.feeBps(), 10_000, Math.Rounding.Ceil);
    }
}

contract MetronomeTest is MetronomeTestBase {
    // ------------------------------------------------------------------ placing

    function test_placeBuyEscrowsQuoteWithFee() public {
        uint256 before = ausd.balanceOf(alice);
        bytes32 id = _buy(alice, T, 10e18);
        uint256 cost = _cost(10e18, T);
        uint256 escrow = cost + _fee(cost);
        assertEq(before - ausd.balanceOf(alice), escrow);
        assertEq(ausd.balanceOf(address(m)), escrow);

        IMetronome.Order memory o = m.getOrder(id);
        assertEq(o.owner, alice);
        assertEq(o.batchId, block.number);
        assertEq(o.tick, T);
        assertTrue(o.isBuy);
        assertFalse(o.resting);
        assertFalse(o.closed);
        assertEq(o.size, 10e18);
        assertEq(o.escrow, escrow);
        assertEq(m.nonces(alice), 1);
    }

    function test_placeSellEscrowsBase() public {
        _sell(bob, T, 7e18);
        assertEq(wmon.balanceOf(address(m)), 7e18);
    }

    function test_orderIdsArePerUserAndUnique() public {
        bytes32 a1 = _buy(alice, T, 1e18);
        bytes32 a2 = _buy(alice, T, 1e18);
        bytes32 b1 = _buy(bob, T, 1e18);
        assertEq(a1, keccak256(abi.encode(alice, uint256(0))));
        assertEq(a2, keccak256(abi.encode(alice, uint256(1))));
        assertEq(b1, keccak256(abi.encode(bob, uint256(0))));
    }

    function test_placeEmitsEvent() public {
        uint256 cost = _cost(1e18, T);
        vm.expectEmit(address(m));
        emit IMetronome.OrderPlaced(
            keccak256(abi.encode(alice, uint256(0))),
            alice,
            block.number,
            true,
            false,
            T,
            1e18,
            uint128(cost + _fee(cost)),
            m.shardOf(alice)
        );
        _buy(alice, T, 1e18);
    }

    function test_revertsOnBadOrders() public {
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(TickMath.TickOutOfRange.selector, 4096));
        m.placeOrder(true, 4096, 1e18, false);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.OrderTooSmall.selector, MIN_SIZE - 1, MIN_SIZE));
        m.placeOrder(true, T, uint128(MIN_SIZE - 1), false);
        vm.stopPrank();
    }

    function test_pauseBlocksPlacingButNotClaiming() public {
        bytes32 id = _buy(alice, T, 1e18);
        vm.prank(owner);
        m.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _buy(alice, T, 1e18);
        _next();
        m.claim(id); // still works
    }

    // ------------------------------------------------------------------ settling

    function test_settleRevertsUntilBatchCloses() public {
        uint256 b = block.number;
        vm.expectRevert(abi.encodeWithSelector(IMetronome.BatchNotClosed.selector, b));
        m.settle(b);
    }

    function test_settleEmptyBatch() public {
        uint256 b = block.number;
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertTrue(r.settled);
        assertEq(r.volume, 0);
    }

    function test_settleIsIdempotent() public {
        uint256 b = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r1 = m.getBatchResult(b);
        m.settle(b);
        IMetronome.BatchResult memory r2 = m.getBatchResult(b);
        assertEq(abi.encode(r1), abi.encode(r2));
    }

    function test_getBookMergesShards() public {
        // alice..dave land in different shards; the book must add them up.
        _buy(alice, T, 1e18);
        _buy(bob, T, 2e18);
        _sell(carol, T + 1, 3e18);
        _sell(dave, T - 5, 4e18);
        (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells) = m.getBatchBook(block.number);
        assertEq(ticks.length, 3);
        assertEq(ticks[0], T - 5);
        assertEq(sells[0], 4e18);
        assertEq(ticks[1], T);
        assertEq(buys[1], 3e18);
        assertEq(ticks[2], T + 1);
        assertEq(sells[2], 3e18);
    }

    function test_usersSpreadAcrossShards() public view {
        bool[SHARDS] memory seen;
        address[4] memory users = [alice, bob, carol, dave];
        for (uint256 i; i < users.length; ++i) {
            seen[m.shardOf(users[i])] = true;
        }
        uint256 used;
        for (uint256 i; i < SHARDS; ++i) {
            if (seen[i]) used++;
        }
        assertGt(used, 1, "test users should hit more than one shard");
    }

    // ------------------------------------------------------------------ full cycles

    function test_exactMatch() public {
        uint256 b = block.number;
        bytes32 buyId = _buy(alice, T, 10e18);
        bytes32 sellId = _sell(bob, T, 10e18);
        uint256 aliceQuote0 = ausd.balanceOf(alice);
        uint256 bobQuote0 = ausd.balanceOf(bob);
        _next();

        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertEq(r.clearingTick, T);
        assertEq(r.volume, 10e18);
        assertEq(r.rationed, ClearingLib.RATIONED_NONE);

        m.claim(buyId);
        m.claim(sellId);
        uint256 cost = _cost(10e18, T);
        uint256 proceeds = _proceeds(10e18, T);
        assertEq(wmon.balanceOf(alice), 1_000_000e18 + 10e18);
        assertEq(ausd.balanceOf(alice), aliceQuote0); // escrow was exactly cost + fee, nothing refunded
        assertEq(wmon.balanceOf(bob), 1_000_000e18 - 10e18);
        assertEq(ausd.balanceOf(bob) - bobQuote0, proceeds - _fee(proceeds));
        assertEq(m.feesAccrued(), _fee(cost) + _fee(proceeds));
        _assertSolvent();
    }

    function test_buyerGetsPriceImprovement() public {
        // Buyer willing to pay up to T+50; seller asks T. Everyone trades at one price, and the buyer's
        // unused escrow comes back.
        uint256 b = block.number;
        bytes32 buyId = _buy(alice, T + 50, 5e18);
        bytes32 sellId = _sell(bob, T, 5e18);
        uint256 escrow = m.getOrder(buyId).escrow;
        _next();

        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertGe(r.clearingTick, T);
        assertLe(r.clearingTick, T + 50);

        uint256 before = ausd.balanceOf(alice);
        (uint256 baseOut, uint256 refund) = m.claim(buyId);
        uint256 cost = _cost(5e18, r.clearingTick);
        assertEq(baseOut, 5e18);
        assertEq(refund, escrow - cost - _fee(cost));
        assertEq(ausd.balanceOf(alice) - before, refund);
        m.claim(sellId);
        _assertSolvent();
    }

    function test_unfilledOrdersAreFullyRefunded() public {
        bytes32 buyId = _buy(alice, T, 5e18);
        bytes32 sellId = _sell(bob, T + 1, 5e18); // asks above the bid: no trade
        uint256 aliceQuote = ausd.balanceOf(alice) + m.getOrder(buyId).escrow;
        _next();
        m.claim(buyId);
        m.claim(sellId);
        assertEq(ausd.balanceOf(alice), aliceQuote);
        assertEq(wmon.balanceOf(bob), 1_000_000e18);
        assertEq(ausd.balanceOf(address(m)), 0);
        assertEq(wmon.balanceOf(address(m)), 0);
    }

    function test_buyersRationedProRata() public {
        // Two buyers want 6 each, only 8 for sale: each gets 4.
        uint256 b = block.number;
        bytes32 a = _buy(alice, T, 6e18);
        bytes32 c = _buy(carol, T, 6e18);
        bytes32 s = _sell(bob, T, 8e18);
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertEq(r.rationed, ClearingLib.RATIONED_BUY);
        (uint256 aBase,) = m.claim(a);
        (uint256 cBase,) = m.claim(c);
        m.claim(s);
        assertEq(aBase, 4e18);
        assertEq(cBase, 4e18);
        assertEq(wmon.balanceOf(bob), 1_000_000e18 - 8e18);
        _assertSolvent();
    }

    function test_sellersRationedWithAwkwardFractions() public {
        // 3 sellers of 1 wei-ish odd sizes against a buyer of 10: fractions don't divide evenly.
        uint256 b = block.number;
        bytes32 buyId = _buy(alice, T, 10e18);
        bytes32 s1 = _sell(bob, T, 7e18 + 1);
        bytes32 s2 = _sell(carol, T, 5e18 + 3);
        bytes32 s3 = _sell(dave, T, 3e18 + 7);
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertEq(r.rationed, ClearingLib.RATIONED_SELL);
        m.claim(buyId);
        m.claim(s1);
        m.claim(s2);
        m.claim(s3);
        assertEq(wmon.balanceOf(alice), 1_000_000e18 + 10e18);
        _assertSolvent();
    }

    // ------------------------------------------------------------------ claiming

    function test_claimSettlesIfNeededAndPaysOwner() public {
        bytes32 buyId = _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        vm.prank(keeper);
        m.claim(buyId); // keeper calls, alice gets paid
        assertEq(wmon.balanceOf(alice), 1_000_000e18 + 1e18);
        assertEq(wmon.balanceOf(keeper), 0);
    }

    function test_claimRevertsBeforeBatchCloses() public {
        bytes32 id = _buy(alice, T, 1e18);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.BatchNotClosed.selector, block.number));
        m.claim(id);
    }

    function test_doubleClaimReverts() public {
        bytes32 id = _buy(alice, T, 1e18);
        _next();
        m.claim(id);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.AlreadyClosed.selector, id));
        m.claim(id);
    }

    function test_unknownOrderReverts() public {
        vm.expectRevert(abi.encodeWithSelector(IMetronome.UnknownOrder.selector, bytes32(uint256(1))));
        m.claim(bytes32(uint256(1)));
    }

    function test_settleAndClaimSkipsClaimedAndUnknown() public {
        uint256 b = block.number;
        bytes32 buyId = _buy(alice, T, 1e18);
        bytes32 sellId = _sell(bob, T, 1e18);
        _next();
        m.claim(buyId);
        bytes32[] memory ids = new bytes32[](3);
        (ids[0], ids[1], ids[2]) = (buyId, sellId, bytes32(uint256(123)));
        vm.prank(keeper);
        m.settleAndClaim(b, ids);
        assertTrue(m.getOrder(sellId).closed);
        _assertSolvent();
    }

    function test_previewMatchesClaim() public {
        bytes32 buyId = _buy(alice, T + 3, 3e18);
        _sell(bob, T, 2e18);
        (,, bool ready) = m.previewClaim(buyId);
        assertFalse(ready);
        _next();
        m.settle(block.number - 1);
        (uint256 pBase, uint256 pQuote, bool ready2) = m.previewClaim(buyId);
        assertTrue(ready2);
        (uint256 cBase, uint256 cQuote) = m.claim(buyId);
        assertEq(pBase, cBase);
        assertEq(pQuote, cQuote);
    }

    // ------------------------------------------------------------------ MEV

    /// @notice The attacker surrounds the victim's buy with their own buy and sell. On Metronome all three share one
    ///         price, so the victim pays exactly what they'd pay without the attacker, and the attacker earns nothing.
    function test_sandwichIsUnprofitable() public {
        uint256 b = block.number;
        // Resting liquidity from a maker.
        _sell(dave, T, 20e18);
        // Attacker front-runs, victim buys, attacker back-runs. Order inside the block is irrelevant.
        bytes32 atkBuy = _buy(carol, T + 100, 10e18);
        bytes32 victim = _buy(alice, T + 100, 5e18);
        bytes32 atkSell = _sell(carol, T - 100, 10e18);
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);

        uint256 carolQuote0 = ausd.balanceOf(carol) + m.getOrder(atkBuy).escrow;
        uint256 carolBase0 = wmon.balanceOf(carol) + m.getOrder(atkSell).escrow;
        m.claim(atkBuy);
        m.claim(atkSell);
        (uint256 victimBase,) = m.claim(victim);

        assertEq(r.clearingTick, T, "attacker moved the price");
        assertEq(victimBase, 5e18);
        assertLe(ausd.balanceOf(carol), carolQuote0, "attacker made quote");
        assertLe(wmon.balanceOf(carol), carolBase0, "attacker made base");
    }

    // ------------------------------------------------------------------ fees

    function test_settleRewardPaidFromFees() public {
        vm.prank(owner);
        m.setFees(FEE_BPS, 1); // 1 raw AUSD unit
        // First batch builds up fees.
        bytes32 a = _buy(alice, T, 100e18);
        _sell(bob, T, 100e18);
        _next();
        m.claim(a); // settles (no reward yet: fees accrue after settle), then accrues the buyer's fee
        uint256 b2 = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        uint256 fees = m.feesAccrued();
        vm.prank(keeper);
        m.settle(b2);
        assertEq(ausd.balanceOf(keeper), 1);
        assertEq(m.feesAccrued(), fees - 1);
    }

    function test_feeIncreaseAfterPlacementCannotLockFunds() public {
        bytes32 id = _buy(alice, T, 10e18);
        _sell(bob, T, 10e18);
        vm.prank(owner);
        m.setFees(100, 0); // 1%, well above what was escrowed
        _next();
        m.claim(id);
        _assertSolvent();
    }

    function test_withdrawFees() public {
        bytes32 a = _buy(alice, T, 10e18);
        _sell(bob, T, 10e18);
        _next();
        m.claim(a);
        uint256 fees = m.feesAccrued();
        vm.prank(owner);
        m.withdrawFees(owner, fees);
        assertEq(ausd.balanceOf(owner), fees);
        assertEq(m.feesAccrued(), 0);
    }

    function test_onlyOwnerAdmin() public {
        vm.startPrank(alice);
        vm.expectRevert();
        m.pause();
        vm.expectRevert();
        m.setFees(1, 0);
        vm.expectRevert();
        m.setOracle(address(1), 1, 1);
        vm.expectRevert();
        m.withdrawFees(alice, 0);
        vm.stopPrank();
    }

    function test_claimManyPaysEveryOwner() public {
        bytes32 a = _buy(alice, T, 2e18);
        bytes32 c = _buy(carol, T, 1e18);
        bytes32 s = _sell(bob, T, 3e18);
        _next();
        bytes32[] memory ids = new bytes32[](3);
        (ids[0], ids[1], ids[2]) = (a, c, s);
        vm.prank(keeper);
        m.claimMany(ids);
        assertEq(wmon.balanceOf(alice), 1_000_000e18 + 2e18);
        assertEq(wmon.balanceOf(carol), 1_000_000e18 + 1e18);
        assertTrue(m.getOrder(s).closed);
        _assertSolvent();
    }

    function test_unpauseAllowsPlacingAgain() public {
        vm.startPrank(owner);
        m.pause();
        m.unpause();
        vm.stopPrank();
        _buy(alice, T, 1e18);
    }

    function test_constructorRejectsBadConfig() public {
        IERC20 w = IERC20(address(wmon));
        IERC20 q = IERC20(address(ausd));
        vm.expectRevert(Metronome.InvalidConfig.selector);
        new Metronome(w, w, PRICE_MIN, 4, 1, 5, 0, owner); // same token
        vm.expectRevert(Metronome.InvalidConfig.selector);
        new Metronome(w, q, 0, 4, 1, 5, 0, owner); // zero price
        vm.expectRevert(Metronome.InvalidConfig.selector);
        new Metronome(w, q, PRICE_MIN, 0, 1, 5, 0, owner); // no shards
        vm.expectRevert(Metronome.InvalidConfig.selector);
        new Metronome(w, q, PRICE_MIN, 65, 1, 5, 0, owner); // too many shards
        vm.expectRevert(Metronome.InvalidConfig.selector);
        new Metronome(w, q, PRICE_MIN, 4, 0, 5, 0, owner); // zero min size
        vm.expectRevert(Metronome.InvalidConfig.selector);
        new Metronome(w, q, PRICE_MIN, 4, 1, 101, 0, owner); // fee above 1%
    }

    function test_adminRejectsBadConfig() public {
        vm.startPrank(owner);
        vm.expectRevert(Metronome.InvalidConfig.selector);
        m.setFees(101, 0);
        vm.expectRevert(Metronome.InvalidConfig.selector);
        m.setOracle(address(1), 0, 1 hours);
        vm.expectRevert(Metronome.InvalidConfig.selector);
        m.setOracle(address(1), 500, 0);
        m.setOracle(address(0), 0, 0); // disabling is always allowed
        vm.stopPrank();
    }

    // ------------------------------------------------------------------ price guard

    function test_oracleWithinBoundAllowsTrade() public {
        _setOracle(1e8); // $1.00, 8 decimals
        uint256 b = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertFalse(r.voided);
        assertEq(r.volume, 1e18);
    }

    function test_oracleDeviationVoidsBatchAndRefunds() public {
        _setOracle(2e8); // oracle says $2, batch clears near $1
        uint256 b = block.number;
        bytes32 a = _buy(alice, T, 1e18);
        bytes32 s = _sell(bob, T, 1e18);
        uint256 aliceQuote = ausd.balanceOf(alice) + m.getOrder(a).escrow;
        _next();
        m.settle(b);
        IMetronome.BatchResult memory r = m.getBatchResult(b);
        assertTrue(r.voided);
        assertEq(r.volume, 0);
        m.claim(a);
        m.claim(s);
        assertEq(ausd.balanceOf(alice), aliceQuote);
        assertEq(wmon.balanceOf(bob), 1_000_000e18);
    }

    function test_staleOracleVoidsBatch() public {
        MockAggregator feed = _setOracle(1e8);
        vm.warp(block.timestamp + 2 hours);
        feed.setUpdatedAt(block.timestamp - 2 hours);
        uint256 b = block.number;
        _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        m.settle(b);
        assertTrue(m.getBatchResult(b).voided);
    }

    function test_revertingOracleVoidsInsteadOfBlocking() public {
        _setOracle(1e8);
        vm.prank(owner);
        m.setOracle(address(0xdead), 500, 1 hours); // no code: call reverts
        uint256 b = block.number;
        bytes32 a = _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        m.settle(b);
        assertTrue(m.getBatchResult(b).voided);
        m.claim(a); // funds still come back
    }

    function _setOracle(int256 answer) internal returns (MockAggregator feed) {
        feed = new MockAggregator(8, answer);
        vm.prank(owner);
        m.setOracle(address(feed), 500, 1 hours); // 5% band
    }

    // ------------------------------------------------------------------ helpers

    /// @dev With every order claimed, the contract must hold at least the protocol's fees.
    function _assertSolvent() internal view {
        assertGe(ausd.balanceOf(address(m)), m.feesAccrued(), "quote insolvent");
    }
}
