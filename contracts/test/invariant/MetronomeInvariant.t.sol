// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Metronome} from "../../src/Metronome.sol";
import {IMetronome} from "../../src/interfaces/IMetronome.sol";
import {MockERC20} from "../../src/mocks/MockERC20.sol";

/// @notice Drives Metronome with random orders, block advances, settles, claims and fee changes.
contract Handler is Test {
    Metronome internal immutable m;
    MockERC20 internal immutable wmon;
    MockERC20 internal immutable ausd;
    address internal immutable owner;

    uint16 internal constant T = 2303;

    address[] public actors;
    bytes32[] public orderIds;

    // Ghost state checked by the invariants.
    uint256 public limitViolations; // a buyer filled above its limit, or a seller below it
    uint256 public claims;
    uint256 public fills; // claims that actually traded
    mapping(uint256 batchId => uint256) public baseToBuyers;
    mapping(uint256 batchId => uint256) public baseFromSellers;
    uint256[] public batches;
    mapping(uint256 batchId => bool) internal _seenBatch;

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

    function place(uint256 actorSeed, bool isBuy, uint256 tickSeed, uint256 sizeSeed) external {
        address a = actors[actorSeed % actors.length];
        uint16 tick = uint16(T - 20 + (tickSeed % 41)); // tight window, so books cross often
        // Mix of round and awkward sizes so pro-rata rounding gets exercised.
        uint128 size = uint128(bound(sizeSeed, 1e15, 1000e18));
        if (sizeSeed % 3 == 0) size = uint128(size / 1e15 * 1e15 + (sizeSeed % 997));
        vm.prank(a);
        bytes32 id = m.placeOrder(isBuy, tick, size);
        orderIds.push(id);
        if (!_seenBatch[block.number]) {
            _seenBatch[block.number] = true;
            batches.push(block.number);
        }
    }

    function advance(uint256 blocks) external {
        vm.roll(block.number + bound(blocks, 1, 3));
    }

    function settle(uint256 seed) external {
        if (batches.length == 0) return;
        uint256 b = batches[seed % batches.length];
        if (b >= block.number) return;
        m.settle(b);
    }

    function claim(uint256 seed) external {
        if (orderIds.length == 0) return;
        claimOne(orderIds[seed % orderIds.length]);
    }

    function setFee(uint256 seed) external {
        vm.prank(owner);
        m.setFees(uint16(seed % 101), 0);
    }

    // ------------------------------------------------------------------ used by invariants too

    function claimOne(bytes32 id) public {
        IMetronome.Order memory o = m.getOrder(id);
        if (o.claimed || o.batchId >= block.number) return;
        (uint256 baseOut,) = m.claim(id);
        claims++;
        if (o.isBuy ? baseOut > 0 : baseOut < o.escrow) fills++;

        IMetronome.BatchResult memory r = m.getBatchResult(o.batchId);
        if (o.isBuy) {
            baseToBuyers[o.batchId] += baseOut;
            if (baseOut > 0 && r.clearingTick > o.tick) limitViolations++;
        } else {
            uint256 given = o.escrow - baseOut;
            baseFromSellers[o.batchId] += given;
            if (given > 0 && r.clearingTick < o.tick) limitViolations++;
        }
    }

    function orderCount() external view returns (uint256) {
        return orderIds.length;
    }

    function batchCount() external view returns (uint256) {
        return batches.length;
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
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = Handler.place.selector;
        selectors[1] = Handler.advance.selector;
        selectors[2] = Handler.settle.selector;
        selectors[3] = Handler.claim.selector;
        selectors[4] = Handler.setFee.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: selectors}));
    }

    /// @notice No order ever fills at a worse price than its limit.
    function invariant_limitPricesRespected() public view {
        assertEq(h.limitViolations(), 0);
    }

    /// @notice If everyone claimed right now, every claim would succeed, and the contract would be left with at least
    ///         the protocol's fees in quote and only rounding dust in base.
    function invariant_everyoneCanBePaidOut() public {
        uint256 snap = vm.snapshotState();
        vm.roll(block.number + 1);

        uint256 n = h.orderCount();
        for (uint256 i; i < n; ++i) {
            h.claimOne(h.orderIds(i)); // reverts (and fails the invariant) if the contract can't pay
        }

        assertGe(ausd.balanceOf(address(m)), m.feesAccrued(), "quote below fees");
        // Rounding dust is at most 1 raw unit per order in each token.
        assertLe(ausd.balanceOf(address(m)) - m.feesAccrued(), n, "quote dust too large");
        assertLe(wmon.balanceOf(address(m)), n, "base dust too large");

        // Per batch: buyers never receive more base than sellers gave, and the gap is only dust.
        uint256 batches = h.batchCount();
        for (uint256 i; i < batches; ++i) {
            uint256 b = h.batches(i);
            uint256 toBuyers = h.baseToBuyers(b);
            uint256 fromSellers = h.baseFromSellers(b);
            assertLe(toBuyers, fromSellers, "buyers got more base than sellers gave");
            assertLe(fromSellers - toBuyers, n, "batch base gap too large");
            assertLe(toBuyers, m.getBatchResult(b).volume, "buyers got more than volume");
        }

        vm.revertToState(snap);
    }

    /// @notice Guards against a vacuous suite: once a run has placed enough random orders into a 41-tick window,
    ///         some of them must have traded. (The chance 40+ random orders never cross is about 2^-40.)
    function afterInvariant() public {
        if (h.orderCount() < 40) return;
        vm.roll(block.number + 1);
        uint256 n = h.orderCount();
        for (uint256 i; i < n; ++i) {
            h.claimOne(h.orderIds(i));
        }
        assertGt(h.fills(), 0, "vacuous run: nothing ever traded");
    }
}
