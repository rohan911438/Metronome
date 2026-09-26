// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Metronome} from "../src/Metronome.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Shard-count benchmark: K = 1, 4, 16 with 200 traders placing in one batch.
/// Run with per-call transactions (cold storage per call, like real txs):
///     forge test --match-contract ShardBench --isolate -vv
///
/// Parallelism metric: Monad executes a block's transactions optimistically in parallel and re-executes one whose
/// inputs an earlier transaction changed. From each placeOrder's recorded storage reads and writes we compute the
/// critical path: the longest chain of orders in which each reads or writes a slot an earlier one wrote. 1 = all
/// orders independent; 200 = fully serial. Reported for Metronome's own storage and for all storage (the token
/// contracts too: every escrow transfer writes the exchange's token balance).
contract ShardBenchTest is Test {
    uint256 internal constant PRICE_MIN = 1e23;
    uint16 internal constant T = 2303;
    uint256 internal constant N = 200;

    MockERC20 internal wmon;
    MockERC20 internal ausd;
    Metronome internal m;
    address[] internal traders;

    // Critical-path bookkeeping, keyed by (run, account, slot) so runs don't mix.
    mapping(bytes32 => uint256) internal depthAll;
    mapping(bytes32 => uint256) internal depthOwn;
    mapping(bytes32 => uint256) internal depthNoEscrow;
    /// The exchange's own balance slot in each token (OpenZeppelin ERC20 keeps balances in mapping slot 0).
    bytes32 internal escrowSlot;
    uint256 internal run;

    function _deploy(uint256 shards) internal {
        wmon = new MockERC20("Wrapped MON", "WMON", 18);
        ausd = new MockERC20("AUSD", "AUSD", 6);
        m = new Metronome(IERC20(address(wmon)), IERC20(address(ausd)), PRICE_MIN, shards, 1e15, 5, 0, address(this));
        escrowSlot = keccak256(abi.encode(address(m), uint256(0)));
        delete traders;
        for (uint256 i; i < N; ++i) {
            address u = address(uint160(uint256(keccak256(abi.encode("trader", i)))));
            traders.push(u);
            wmon.mint(u, 1000e18);
            ausd.mint(u, 1000e6);
            vm.startPrank(u);
            wmon.approve(address(m), type(uint256).max);
            ausd.approve(address(m), type(uint256).max);
            vm.stopPrank();
        }
        ++run;
    }

    function test_bench_shards() public {
        uint256[3] memory ks = [uint256(1), 4, 16];
        console.log(
            "K | place avg | place max | critical path (Metronome) | critical path (all) | critical path (all but escrow balance) | settle | claim avg | settle 1-order batch | cancel resting"
        );
        for (uint256 i; i < ks.length; ++i) {
            _bench(ks[i]);
        }
    }

    struct Result {
        uint256 k;
        uint256 placeAvg;
        uint256 placeMax;
        uint256 pathOwn;
        uint256 pathAll;
        uint256 pathNoEscrow;
        uint256 settle;
        uint256 claimAvg;
        uint256 settleOne;
        uint256 cancel;
    }

    function _bench(uint256 k) internal {
        _deploy(k);
        Result memory r;
        r.k = k;
        uint256 batch = block.number;
        bytes32[] memory ids = _placeAll(r);

        vm.roll(block.number + 1);
        m.settle(batch);
        r.settle = vm.lastCallGas().gasTotalUsed;

        uint256 claimSum;
        for (uint256 i; i < N; ++i) {
            m.claim(ids[i]);
            claimSum += vm.lastCallGas().gasTotalUsed;
        }
        r.claimAvg = claimSum / N;
        _fixedCosts(r);
        _log(r);
    }

    function _placeAll(Result memory r) internal returns (bytes32[] memory ids) {
        ids = new bytes32[](N);
        uint256 placeSum;
        for (uint256 i; i < N; ++i) {
            bool isBuy = i % 2 == 0;
            // Buyers bid above sellers' asks so the batch clears; 20 distinct ticks per side.
            uint16 tick = isBuy ? uint16(T + (i % 20)) : uint16(T - 10 + (i % 20));
            vm.startStateDiffRecording();
            vm.prank(traders[i]);
            ids[i] = m.placeOrder(isBuy, tick, 1e18, false);
            Vm.AccountAccess[] memory acc = vm.stopAndReturnStateDiff();
            uint256 g = vm.lastCallGas().gasTotalUsed;
            placeSum += g;
            if (g > r.placeMax) r.placeMax = g;
            (uint256 dOwn, uint256 dAll, uint256 dNoEscrow) = _depth(acc);
            if (dOwn > r.pathOwn) r.pathOwn = dOwn;
            if (dAll > r.pathAll) r.pathAll = dAll;
            if (dNoEscrow > r.pathNoEscrow) r.pathNoEscrow = dNoEscrow;
        }
        r.placeAvg = placeSum / N;
    }

    function _fixedCosts(Result memory r) internal {
        // Fixed per-batch cost: a batch with a single order.
        uint256 one = block.number;
        vm.prank(traders[0]);
        m.placeOrder(true, T, 1e18, false);
        vm.roll(block.number + 1);
        m.settle(one);
        r.settleOne = vm.lastCallGas().gasTotalUsed;

        // Cancel a resting order that has joined its pool (scans the shards' batch chains).
        uint256 rb = block.number;
        vm.prank(traders[1]);
        bytes32 rest = m.placeOrder(false, T + 50, 1e18, true);
        vm.roll(block.number + 1);
        m.settle(rb);
        vm.roll(block.number + 1);
        vm.prank(traders[1]);
        m.cancel(rest);
        r.cancel = vm.lastCallGas().gasTotalUsed;
    }

    function _log(Result memory r) internal pure {
        string memory a = string.concat(
            vm.toString(r.k),
            " | ",
            vm.toString(r.placeAvg),
            " | ",
            vm.toString(r.placeMax),
            " | ",
            vm.toString(r.pathOwn)
        );
        string memory b = string.concat(
            " | ",
            vm.toString(r.pathAll),
            " | ",
            vm.toString(r.pathNoEscrow),
            " | ",
            vm.toString(r.settle),
            " | ",
            vm.toString(r.claimAvg)
        );
        console.log(string.concat(a, b, " | ", vm.toString(r.settleOne), " | ", vm.toString(r.cancel)));
    }

    /// Depth of this order in the dependency DAG: 1 + deepest earlier order that wrote a slot this one touches.
    function _depth(Vm.AccountAccess[] memory acc) internal returns (uint256 dOwn, uint256 dAll, uint256 dNo) {
        dOwn = 1;
        dAll = 1;
        dNo = 1;
        for (uint256 a; a < acc.length; ++a) {
            Vm.StorageAccess[] memory s = acc[a].storageAccesses;
            for (uint256 j; j < s.length; ++j) {
                if (s[j].reverted) continue;
                bytes32 key = keccak256(abi.encode(run, s[j].account, s[j].slot));
                if (depthAll[key] + 1 > dAll) dAll = depthAll[key] + 1;
                if (s[j].account == address(m) && depthOwn[key] + 1 > dOwn) dOwn = depthOwn[key] + 1;
                if (!_isEscrow(s[j]) && depthNoEscrow[key] + 1 > dNo) dNo = depthNoEscrow[key] + 1;
            }
        }
        for (uint256 a; a < acc.length; ++a) {
            Vm.StorageAccess[] memory s = acc[a].storageAccesses;
            for (uint256 j; j < s.length; ++j) {
                if (s[j].reverted || !s[j].isWrite) continue;
                bytes32 key = keccak256(abi.encode(run, s[j].account, s[j].slot));
                if (dAll > depthAll[key]) depthAll[key] = dAll;
                if (s[j].account == address(m) && dOwn > depthOwn[key]) depthOwn[key] = dOwn;
                if (!_isEscrow(s[j]) && dNo > depthNoEscrow[key]) depthNoEscrow[key] = dNo;
            }
        }
    }

    function _isEscrow(Vm.StorageAccess memory a) internal view returns (bool) {
        return (a.account == address(wmon) || a.account == address(ausd)) && a.slot == escrowSlot;
    }
}
