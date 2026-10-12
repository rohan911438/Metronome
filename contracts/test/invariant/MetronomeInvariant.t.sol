// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Metronome} from "../../src/Metronome.sol";
import {IMetronome} from "../../src/interfaces/IMetronome.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @notice Drives Metronome with random taker and resting orders, block advances, settles, claims, cancels and fee
///         changes.
contract Handler is Test {
    Metronome internal immutable m;
    MockERC20 internal immutable wmon;
    MockERC20 internal immutable ausd;
    address internal immutable owner;

    uint16 internal constant T = 2303;

    address[] public actors;
    bytes32[] public orderIds;

    // Ghost state checked by the invariants.
    uint256 public limitViolations; // a taker filled beyond its limit, or a resting buy paid above its limit
    uint256 public fills; // claims that actually traded

    constructor(Metronome m_, MockERC20 wmon_, MockERC20 ausd_, address owner_) {
        (m, wmon, ausd, owner) = (m_, wmon_, ausd_, owner_);
        for (uint256 i; i < 6; ++i) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            wmon.mint(a, 1e30);
            ausd.mint(a, 1e30);
            vm.startPrank(a);
            wmon.approve(address(m), type(uint256).max);
            ausd.approve(address(m), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ------------------------------------------------------------------ actions

    function place(uint256 actorSeed, bool isBuy, uint256 tickSeed, uint256 sizeSeed, bool resting) external {
        address a = actors[actorSeed % actors.length];
        uint16 tick = uint16(T - 20 + (tickSeed % 41)); // tight window, so books cross often
        // Mix of round and awkward sizes so pro-rata rounding gets exercised.
        uint128 size = uint128(bound(sizeSeed, 1e15, 1000e18));
        if (sizeSeed % 3 == 0) size = uint128(size / 1e15 * 1e15 + (sizeSeed % 997));
        vm.prank(a);
        orderIds.push(m.placeOrder(isBuy, tick, size, resting));
    }

    function advance(uint256 blocks) external {
        vm.roll(block.number + bound(blocks, 1, 3));
    }

    function settle(uint256 seed) external {
        uint256 back = seed % 3;
        if (block.number <= back + 1) return;
        m.settle(block.number - 1 - back);
    }

    function claim(uint256 seed) external {
        if (orderIds.length == 0) return;
        claimOne(orderIds[seed % orderIds.length]);
    }

    function cancel(uint256 seed) external {
        if (orderIds.length == 0) return;
        cancelOne(orderIds[seed % orderIds.length]);
    }

    function setFee(uint256 seed) external {
        vm.prank(owner);
        m.setFees(uint16(seed % 101), 0);
    }

    // ------------------------------------------------------------------ used by invariants too

    function claimOne(bytes32 id) public {
        IMetronome.Order memory o = m.getOrder(id);
        if (o.closed || o.batchId >= block.number) return;
        (uint256 baseOut, uint256 quoteOut) = m.claim(id);
        IMetronome.Order memory after_ = m.getOrder(id);

        if (o.resting) {
            if (o.isBuy && baseOut > 0) {
                fills++;
                // Quote spent this claim must not exceed what `baseOut` costs at the limit (plus rounding). Makers
                // pay no fee. Each settled batch rounds the pool's cost up by at most 1 unit, so allow 1 per batch
                // since the order joined (plus 2 for the claim itself).
                uint256 spent = o.escrow - after_.escrow - (after_.closed ? quoteOut : 0);
                uint256 atLimit = m.restingBuyEscrow(baseOut, o.tick) - m.RESTING_BUY_BUFFER();
                if (spent > atLimit + 2 + (block.number - o.batchId)) limitViolations++;
            }
            if (!o.isBuy && quoteOut > 0) fills++;
            return;
        }

        IMetronome.BatchResult memory r = m.getBatchResult(o.batchId);
        if (o.isBuy) {
            if (baseOut > 0) fills++;
            if (baseOut > 0 && r.clearingTick > o.tick) limitViolations++;
        } else {
            uint256 given = o.escrow - baseOut;
            if (given > 0) fills++;
            if (given > 0 && r.clearingTick < o.tick) limitViolations++;
        }
    }

    function cancelOne(bytes32 id) public {
        IMetronome.Order memory o = m.getOrder(id);
        if (!o.resting || o.closed) return;
        vm.prank(o.owner);
        m.cancel(id);
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }
}

contract MetronomeInvariantTest is Test {
    Metronome internal m;
    MockERC20 internal wmon;
    MockERC20 internal ausd;
    Handler internal h;
    address internal owner = makeAddr("owner");

    function setUp() public {
        wmon = new MockERC20("Wrapped MON", "WMON", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        m = new Metronome(IERC20(address(wmon)), IERC20(address(ausd)), 1e23, 4, 1e15, 5, 0, owner);
        h = new Handler(m, wmon, ausd, owner);

        targetContract(address(h));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = Handler.place.selector;
        selectors[1] = Handler.advance.selector;
        selectors[2] = Handler.settle.selector;
        selectors[3] = Handler.claim.selector;
        selectors[4] = Handler.cancel.selector;
        selectors[5] = Handler.setFee.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: selectors}));
    }

    /// @notice No order ever fills at a worse price than its limit.
    function invariant_limitPricesRespected() public view {
        assertEq(h.limitViolations(), 0);
    }

    /// @notice If every order were claimed or cancelled right now, every call would succeed, and the contract would be
    ///         left with at least the protocol's fees in quote and only rounding dust in either token.
    function invariant_everyoneCanBePaidOut() public {
        uint256 snap = vm.snapshotState();
        _closeEverything();

        uint256 n = h.orderCount();
        assertGe(ausd.balanceOf(address(m)), m.feesAccrued(), "quote below fees");
        assertLe(ausd.balanceOf(address(m)) - m.feesAccrued(), 2 * n, "quote dust too large");
        assertLe(wmon.balanceOf(address(m)), 2 * n, "base dust too large");
        vm.revertToState(snap);
    }

    /// @notice A pool's shares and remaining size are zero together, and a live pool is never below the minimum size.
    function invariant_poolsConsistent() public view {
        (uint16[] memory ticks,,) = m.getRestingBook();
        for (uint256 i; i < ticks.length; ++i) {
            _checkPool(m.getPool(true, ticks[i]));
            _checkPool(m.getPool(false, ticks[i]));
        }
    }

    /// @notice Once every closed batch is settled, the resting book never crosses: best bid < best ask.
    function invariant_restingBookNeverCrosses() public {
        uint256 snap = vm.snapshotState();
        vm.roll(block.number + 1);
        m.settle(block.number - 1);
        (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells) = m.getRestingBook();
        uint256 bestBid;
        bool hasBid;
        uint256 bestAsk = type(uint256).max;
        for (uint256 i; i < ticks.length; ++i) {
            if (buys[i] > 0) (bestBid, hasBid) = (ticks[i], true);
            if (sells[i] > 0 && ticks[i] < bestAsk) bestAsk = ticks[i];
        }
        if (hasBid) assertLt(bestBid, bestAsk, "resting book crossed");
        vm.revertToState(snap);
    }

    /// @notice Guards against a vacuous suite: once a run has placed enough random orders into a 41-tick window,
    ///         some of them must have traded. (The chance 40+ random orders never cross is about 2^-40.)
    function afterInvariant() public {
        if (h.orderCount() < 40) return;
        _closeEverything();
        assertGt(h.fills(), 0, "vacuous run: nothing ever traded");
    }

    function _closeEverything() internal {
        vm.roll(block.number + 1);
        uint256 n = h.orderCount();
        for (uint256 i; i < n; ++i) {
            h.claimOne(h.orderIds(i)); // reverts (failing the invariant) if the contract can't pay
            h.cancelOne(h.orderIds(i));
        }
    }

    function _checkPool(Metronome.Pool memory p) internal view {
        assertEq(p.shares == 0, p.remaining == 0, "shares/remaining mismatch");
        if (p.remaining > 0) assertGe(p.remaining, m.MIN_ORDER_SIZE(), "live pool below minimum");
    }
}
