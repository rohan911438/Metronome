// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {Metronome} from "../src/Metronome.sol";
import {IMetronome} from "../src/interfaces/IMetronome.sol";
import {MetronomeTestBase} from "./Metronome.t.sol";

contract RestingTest is MetronomeTestBase {
    function _restSell(address u, uint16 tick, uint128 size) internal returns (bytes32) {
        vm.prank(u);
        return m.placeOrder(false, tick, size, true);
    }

    function _restBuy(address u, uint16 tick, uint128 size) internal returns (bytes32) {
        vm.prank(u);
        return m.placeOrder(true, tick, size, true);
    }

    function _settlePrev() internal {
        m.settle(block.number - 1);
    }

    // ------------------------------------------------------------------ core lifecycle

    function test_makerPostsOnceAndFillsAcrossBatches() public {
        bytes32 ask = _restSell(bob, T, 10e18);
        _next();
        _settlePrev(); // joins the pool; nothing to trade against yet
        assertEq(m.getPool(false, T).remaining, 10e18);

        // Two later batches, each with a taker. The maker sends no transaction in between.
        bytes32 t1 = _buy(alice, T, 4e18);
        _next();
        _settlePrev();
        assertEq(m.getPool(false, T).remaining, 6e18);

        bytes32 t2 = _buy(carol, T, 6e18);
        _next();
        _settlePrev();
        assertEq(m.getPool(false, T).remaining, 0, "pool used up");

        (uint256 b1,) = m.claim(t1);
        (uint256 b2,) = m.claim(t2);
        assertEq(b1, 4e18);
        assertEq(b2, 6e18);

        uint256 before = ausd.balanceOf(bob);
        (uint256 baseBack, uint256 proceeds) = m.claim(ask);
        assertEq(baseBack, 0);
        // Maker pays no fee: proceeds are the full value of 10 MON at T, minus rounding.
        assertApproxEqAbs(proceeds, _proceeds(10e18, T), 2);
        assertEq(ausd.balanceOf(bob) - before, proceeds);
        assertTrue(m.getOrder(ask).closed, "used-up pool closes the order");
        _assertSolventAfterAll();
    }

    function test_makerCanClaimPartialFillsAndStayOpen() public {
        bytes32 ask = _restSell(bob, T, 10e18);
        _buy(alice, T, 3e18);
        _next();
        _settlePrev();
        (, uint256 q1) = m.claim(ask);
        assertApproxEqAbs(q1, _proceeds(3e18, T), 2);
        assertFalse(m.getOrder(ask).closed);

        // Claiming again with no new fills pays nothing.
        (uint256 b2, uint256 q2) = m.claim(ask);
        assertEq(b2 + q2, 0);

        _buy(carol, T, 2e18);
        _next();
        _settlePrev();
        (, uint256 q3) = m.claim(ask);
        assertApproxEqAbs(q3, _proceeds(2e18, T), 2);
    }

    function test_restingOrderTradesInItsOwnBatch() public {
        // A resting buy and a taker sell in the same block trade immediately.
        uint256 b = block.number;
        bytes32 bid = _restBuy(alice, T, 5e18);
        _sell(bob, T, 5e18);
        _next();
        _settlePrev();
        assertEq(m.getBatchResult(b).volume, 5e18);
        (uint256 base,) = m.claim(bid);
        assertEq(base, 5e18);
    }

    function test_takerPaysFeeMakerDoesNot() public {
        _restSell(bob, T, 10e18);
        bytes32 taker = _buy(alice, T, 10e18);
        _next();
        _settlePrev();
        m.claim(taker);
        uint256 cost = _cost(10e18, T);
        // Only the taker's fee was collected.
        assertEq(m.feesAccrued(), _fee(cost));
    }

    function test_twoMakersShareFillsProRata() public {
        bytes32 a = _restSell(bob, T, 6e18);
        _next();
        _settlePrev();
        bytes32 c = _restSell(carol, T, 2e18); // joins a later batch
        _buy(alice, T, 4e18); // half the pool
        _next();
        _settlePrev();

        uint256 bobQ0 = ausd.balanceOf(bob);
        uint256 carolQ0 = ausd.balanceOf(carol);
        m.claim(a);
        m.claim(c);
        uint256 bobGot = ausd.balanceOf(bob) - bobQ0;
        uint256 carolGot = ausd.balanceOf(carol) - carolQ0;
        // 8 in the pool, 4 filled: each maker sold half of what they offered.
        assertApproxEqAbs(bobGot, _proceeds(3e18, T), 2);
        assertApproxEqAbs(carolGot, _proceeds(1e18, T), 2);
    }

    function test_restingBuyerGetsPriceImprovement() public {
        // Bid rests at T+10; a later seller asks T. Clearing is between them and the bid's unspent escrow returns.
        bytes32 bid = _restBuy(alice, T + 10, 5e18);
        _next();
        _settlePrev();
        uint256 b = block.number;
        _sell(bob, T, 5e18);
        _next();
        _settlePrev();
        uint16 ct = m.getBatchResult(b).clearingTick;
        assertLe(ct, T + 10);

        uint256 escrow = m.getOrder(bid).escrow;
        (uint256 base, uint256 refund) = m.claim(bid);
        assertEq(base, 5e18);
        assertTrue(m.getOrder(bid).closed);
        assertApproxEqAbs(escrow - refund, _cost(5e18, ct), 2, "paid the clearing price, not the limit");
    }

    // ------------------------------------------------------------------ cancel

    function test_cancelBeforeJoinRefundsEverything() public {
        uint256 w0 = wmon.balanceOf(bob);
        bytes32 ask = _restSell(bob, T, 10e18);
        vm.prank(bob);
        (uint256 base,) = m.cancel(ask);
        assertEq(base, 10e18);
        assertEq(wmon.balanceOf(bob), w0);
        _next();
        _settlePrev();
        assertEq(m.getPool(false, T).remaining, 0, "cancelled order never joined");
    }

    function test_cancelReturnsUnfilledAndFillsSoFar() public {
        bytes32 ask = _restSell(bob, T, 10e18);
        _buy(alice, T, 4e18);
        _next();
        _settlePrev();

        uint256 w0 = wmon.balanceOf(bob);
        uint256 q0 = ausd.balanceOf(bob);
        vm.prank(bob);
        m.cancel(ask);
        assertEq(wmon.balanceOf(bob) - w0, 6e18, "unfilled base back");
        assertApproxEqAbs(ausd.balanceOf(bob) - q0, _proceeds(4e18, T), 2, "fills paid");
        assertEq(m.getPool(false, T).remaining, 0);
        (uint16[] memory ticks,,) = m.getRestingBook();
        assertEq(ticks.length, 0, "empty pool leaves the book");
    }

    function test_cancelSettlesEarlierBatchesFirst() public {
        // A taker buys in block N; the maker cancels in N+1 before anyone settled N. The fill in N must still happen:
        // cancels can't pull liquidity out of a batch that already closed.
        bytes32 ask = _restSell(bob, T, 10e18);
        _next();
        _settlePrev();
        bytes32 taker = _buy(alice, T, 4e18);
        _next();
        vm.prank(bob);
        m.cancel(ask);
        (uint256 base,) = m.claim(taker);
        assertEq(base, 4e18);
    }

    function test_restingBuyCancelRefundsBuffer() public {
        uint256 q0 = ausd.balanceOf(alice);
        bytes32 bid = _restBuy(alice, T, 5e18);
        _next();
        _settlePrev();
        vm.prank(alice);
        m.cancel(bid);
        assertEq(ausd.balanceOf(alice), q0, "full escrow incl. buffer back");
    }

    function test_cancelGuards() public {
        bytes32 ask = _restSell(bob, T, 1e18);
        bytes32 taker = _buy(alice, T - 5, 1e18);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.NotOwner.selector, ask));
        vm.prank(alice);
        m.cancel(ask);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.NotResting.selector, taker));
        vm.prank(alice);
        m.cancel(taker);
        vm.prank(bob);
        m.cancel(ask);
        vm.expectRevert(abi.encodeWithSelector(IMetronome.AlreadyClosed.selector, ask));
        vm.prank(bob);
        m.cancel(ask);
    }

    // ------------------------------------------------------------------ ordering and views

    function test_settleRunsPendingBatchesInOrder() public {
        uint256 b1 = block.number;
        _restSell(bob, T, 5e18);
        _next();
        uint256 b2 = block.number;
        bytes32 taker = _buy(alice, T, 5e18);
        _next();
        // Settling b2 first must settle b1 (where the ask joined) before it.
        m.settle(b2);
        assertTrue(m.getBatchResult(b1).settled);
        assertEq(m.getBatchResult(b2).volume, 5e18);
        (uint256 base,) = m.claim(taker);
        assertEq(base, 5e18);
        assertEq(m.nextPendingBatch(), 0);
    }

    function test_restingBookView() public {
        _restSell(bob, T + 2, 3e18);
        _restBuy(alice, T - 2, 4e18);
        _next();
        _settlePrev();
        (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells) = m.getRestingBook();
        assertEq(ticks.length, 2);
        assertEq(ticks[0], T - 2);
        assertEq(buys[0], 4e18);
        assertEq(ticks[1], T + 2);
        assertEq(sells[1], 3e18);
    }

    function test_crossingRestingOrdersTradeAndBookStaysUncrossed() public {
        _restBuy(alice, T + 3, 5e18);
        _restSell(bob, T, 8e18);
        _next();
        _settlePrev();
        assertEq(m.getPool(true, T + 3).remaining, 0, "bid fully filled");
        assertEq(m.getPool(false, T).remaining, 3e18, "ask partly filled");
    }

    function test_dustPoolIsFrozenNotOffered() public {
        // Leave less than MIN_SIZE in the pool: it must stop being offered and go back to the maker.
        bytes32 ask = _restSell(bob, T, 1e18);
        _buy(alice, T, uint128(1e18 - MIN_SIZE / 2));
        _next();
        _settlePrev();
        assertEq(m.getPool(false, T).remaining, 0, "dust pool frozen");
        (uint256 base,) = m.claim(ask);
        assertEq(base, MIN_SIZE / 2, "dust returned");
        assertTrue(m.getOrder(ask).closed);
    }

    function test_previewMatchesRestingClaim() public {
        bytes32 ask = _restSell(bob, T, 10e18);
        _buy(alice, T, 3e18);
        _next();
        _settlePrev();
        (uint256 pb, uint256 pq, bool ready) = m.previewClaim(ask);
        assertTrue(ready);
        (uint256 cb, uint256 cq) = m.claim(ask);
        assertEq(pb, cb);
        assertEq(pq, cq);
    }

    // ------------------------------------------------------------------ helpers

    function _assertSolventAfterAll() internal view {
        assertGe(ausd.balanceOf(address(m)), m.feesAccrued(), "quote insolvent");
    }
}
