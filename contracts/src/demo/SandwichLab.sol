// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Metronome} from "../Metronome.sol";
import {IMetronome} from "../interfaces/IMetronome.sol";
import {MiniAMM} from "./MiniAMM.sol";

/// @title SandwichLab
/// @notice Runs the same sandwich attack against a normal AMM and against Metronome, and reports what the victim lost
///         on each. Deterministic, so the demo works every time.
/// @dev The AMM side runs atomically in `run`. The Metronome side places all orders in the current batch, and `finish`
///      (any later block) settles, claims and reports. The lab plays every role itself; roles are just bookkeeping.
contract SandwichLab {
    using SafeERC20 for IERC20;

    Metronome public immutable METRONOME;
    MiniAMM public immutable AMM;
    IERC20 public immutable BASE;
    IERC20 public immutable QUOTE;

    /// @notice How far the attacker's and victim's limits sit from the maker's price, in ticks (100 ticks ~ 10%).
    uint16 public constant SLIPPAGE_TICKS = 100;

    struct Run {
        address caller;
        uint64 batchId;
        bool finished;
        bytes32 makerSell;
        bytes32 attackerBuy;
        bytes32 victimBuy;
        bytes32 attackerSell;
        uint256 victimCleanCost; // what the victim pays with no attacker: maker's price + fee
    }

    Run[] public runs;

    /// @param cleanCost Quote the victim would pay with no attacker present.
    /// @param attackedCost Quote the victim actually paid.
    /// @param attackerPnl Attacker's quote profit (negative = loss). Base position always ends flat.
    event AmmSandwich(uint256 indexed runId, uint256 cleanCost, uint256 attackedCost, int256 attackerPnl);
    event MetronomeSandwich(
        uint256 indexed runId,
        uint256 cleanCost,
        uint256 attackedCost,
        int256 attackerPnl,
        int256 attackerBaseDelta,
        uint16 clearingTick
    );

    error AlreadyFinished(uint256 runId);
    error NotCaller(uint256 runId);

    constructor(Metronome metronome, MiniAMM amm) {
        METRONOME = metronome;
        AMM = amm;
        BASE = metronome.BASE();
        QUOTE = metronome.QUOTE();
        BASE.forceApprove(address(metronome), type(uint256).max);
        QUOTE.forceApprove(address(metronome), type(uint256).max);
        BASE.forceApprove(address(amm), type(uint256).max);
        QUOTE.forceApprove(address(amm), type(uint256).max);
    }

    /// @notice Runs the attack on both venues. Caller must approve this contract for base and quote.
    /// @param victimBase How much base the victim buys.
    /// @param attackerBase How much base the attacker front-runs with.
    /// @param makerTick The price the maker offers the victim's size at on Metronome (use the AMM spot tick).
    function run(uint128 victimBase, uint128 attackerBase, uint16 makerTick) external returns (uint256 runId) {
        runId = runs.length;
        _ammSandwich(runId, victimBase, attackerBase);

        Run memory r;
        r.caller = msg.sender;
        r.batchId = uint64(block.number);

        // Everything below lands in one batch, so its order inside this transaction is irrelevant, just as the
        // order of transactions inside a block is.
        _pull(BASE, victimBase + attackerBase);
        _pull(QUOTE, METRONOME.quoteBuyEscrow(attackerBase, makerTick + SLIPPAGE_TICKS));
        _pull(QUOTE, METRONOME.quoteBuyEscrow(victimBase, makerTick + SLIPPAGE_TICKS));

        r.makerSell = METRONOME.placeOrder(false, makerTick, victimBase, false);
        r.attackerBuy = METRONOME.placeOrder(true, makerTick + SLIPPAGE_TICKS, attackerBase, false); // front-run
        r.victimBuy = METRONOME.placeOrder(true, makerTick + SLIPPAGE_TICKS, victimBase, false); // victim, loose slippage
        r.attackerSell = METRONOME.placeOrder(false, makerTick - SLIPPAGE_TICKS, attackerBase, false); // back-run
        r.victimCleanCost = METRONOME.quoteBuyEscrow(victimBase, makerTick);
        runs.push(r);
    }

    /// @notice Settles the Metronome batch of `runId`, reports the result and returns all funds to the caller.
    function finish(uint256 runId) external {
        Run storage r = runs[runId];
        if (r.finished) revert AlreadyFinished(runId);
        if (msg.sender != r.caller) revert NotCaller(runId);
        r.finished = true;

        METRONOME.settle(r.batchId);
        IMetronome.BatchResult memory res = METRONOME.getBatchResult(r.batchId);
        uint256 victimPaid = _claimVictim(r.victimBuy);
        (int256 pnl, int256 baseDelta) = _claimAttacker(r.attackerBuy, r.attackerSell);
        METRONOME.claim(r.makerSell);
        emit MetronomeSandwich(runId, r.victimCleanCost, victimPaid, pnl, baseDelta, res.clearingTick);

        _returnAll(r.caller);
    }

    function runCount() external view returns (uint256) {
        return runs.length;
    }

    /// @return paid Quote the victim paid: escrow minus refund.
    function _claimVictim(bytes32 id) internal returns (uint256 paid) {
        uint256 escrow = METRONOME.getOrder(id).escrow;
        (, uint256 refund) = METRONOME.claim(id);
        paid = escrow - refund;
    }

    /// @return pnl Quote received on the sell minus quote spent on the buy.
    /// @return baseDelta Base bought minus base sold.
    function _claimAttacker(bytes32 buyId, bytes32 sellId) internal returns (int256 pnl, int256 baseDelta) {
        uint256 buyEscrow = METRONOME.getOrder(buyId).escrow;
        (uint256 baseBought, uint256 buyRefund) = METRONOME.claim(buyId);
        uint256 sellEscrow = METRONOME.getOrder(sellId).escrow;
        (uint256 sellRefund, uint256 proceeds) = METRONOME.claim(sellId);
        pnl = int256(proceeds) - int256(buyEscrow - buyRefund);
        baseDelta = int256(baseBought) - int256(sellEscrow - sellRefund);
    }

    function _ammSandwich(uint256 runId, uint256 victimBase, uint256 attackerBase) internal {
        uint256 clean = AMM.quoteForBase(victimBase);

        _pull(QUOTE, AMM.quoteForBase(attackerBase));
        uint256 attackerIn = AMM.buyBase(attackerBase, type(uint256).max, address(this)); // front-run

        _pull(QUOTE, AMM.quoteForBase(victimBase));
        uint256 victimIn = AMM.buyBase(victimBase, type(uint256).max, address(this)); // victim, loose slippage

        uint256 attackerOut = AMM.sellBase(attackerBase, 0, address(this)); // back-run

        emit AmmSandwich(runId, clean, victimIn, int256(attackerOut) - int256(attackerIn));
        _returnAll(msg.sender);
    }

    function _pull(IERC20 token, uint256 amount) internal {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    function _returnAll(address to) internal {
        uint256 b = BASE.balanceOf(address(this));
        uint256 q = QUOTE.balanceOf(address(this));
        if (b > 0) BASE.safeTransfer(to, b);
        if (q > 0) QUOTE.safeTransfer(to, q);
    }
}
