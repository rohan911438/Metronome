// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {IMetronome} from "./interfaces/IMetronome.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {TickMath} from "./lib/TickMath.sol";
import {TickBitmap} from "./lib/TickBitmap.sol";
import {ClearingLib} from "./lib/ClearingLib.sol";

/// @title Metronome
/// @notice Fully onchain frequent batch auction for one base/quote pair. Every block is one batch, and every order in a
///         batch trades at the same price, so transaction ordering inside a block is worth nothing.
/// @dev Designed for Monad's parallel execution: placeOrder writes only the caller's own order, nonce and shard. No
///      global counter, and the reentrancy guard uses transient storage. See docs/architecture.md.
contract Metronome is IMetronome, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using TickBitmap for TickBitmap.Map;

    /// @notice Prices are quote raw units per base raw unit, scaled by 1e36.
    uint256 public constant PRICE_SCALE = 1e36;
    uint256 public constant MAX_SHARDS = 64;
    uint256 public constant MAX_FEE_BPS = 100; // 1%
    uint256 internal constant BPS = 10_000;

    struct Level {
        uint128 buy;
        uint128 sell;
    }

    /// @dev One per (batch, shard). `levels` is a fixed array so neighbouring ticks share a Monad storage page.
    struct Book {
        TickBitmap.Map active;
        Level[4096] levels;
    }

    struct OracleConfig {
        IAggregatorV3 feed; // address(0) disables the price guard
        uint16 maxDeviationBps;
        uint32 maxStaleness; // seconds
    }

    IERC20 public immutable BASE;
    IERC20 public immutable QUOTE;
    uint8 public immutable BASE_DECIMALS;
    uint8 public immutable QUOTE_DECIMALS;
    uint256 public immutable PRICE_MIN; // price of tick 0
    uint256 public immutable SHARDS;
    uint256 public immutable MIN_ORDER_SIZE;

    uint16 public feeBps;
    uint128 public settleReward; // quote units, paid from fees to whoever settles a batch with volume
    uint256 public feesAccrued; // quote units owned by the protocol
    OracleConfig public oracle;

    uint64 public lastSettledBatch;
    uint16 public lastClearingTick;

    mapping(uint256 batchId => mapping(uint256 shard => Book)) internal _books;
    mapping(uint256 batchId => BatchResult) internal _results;
    mapping(bytes32 orderId => Order) internal _orders;
    mapping(address owner => uint256) public nonces;

    event FeesUpdated(uint16 feeBps, uint128 settleReward);
    event OracleUpdated(address feed, uint16 maxDeviationBps, uint32 maxStaleness);
    event FeesWithdrawn(address indexed to, uint256 amount);

    error InvalidConfig();

    constructor(
        IERC20 base,
        IERC20 quote,
        uint256 priceMin,
        uint256 shards,
        uint256 minOrderSize,
        uint16 feeBps_,
        uint128 settleReward_,
        address owner_
    ) Ownable(owner_) {
        if (address(base) == address(quote) || priceMin == 0 || shards == 0 || shards > MAX_SHARDS) {
            revert InvalidConfig();
        }
        if (minOrderSize == 0 || feeBps_ > MAX_FEE_BPS) revert InvalidConfig();
        BASE = base;
        QUOTE = quote;
        BASE_DECIMALS = IERC20Metadata(address(base)).decimals();
        QUOTE_DECIMALS = IERC20Metadata(address(quote)).decimals();
        PRICE_MIN = priceMin;
        SHARDS = shards;
        MIN_ORDER_SIZE = minOrderSize;
        feeBps = feeBps_;
        settleReward = settleReward_;
        emit FeesUpdated(feeBps_, settleReward_);
    }

    // ------------------------------------------------------------------ trading

    /// @inheritdoc IMetronome
    function placeOrder(bool isBuy, uint16 tick, uint128 size)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        if (tick > TickMath.MAX_TICK) revert TickMath.TickOutOfRange(tick);
        if (size < MIN_ORDER_SIZE) revert OrderTooSmall(size, MIN_ORDER_SIZE);

        uint128 escrow = isBuy ? quoteBuyEscrow(size, tick).toUint128() : size;
        if (escrow == 0) revert ZeroEscrow();

        uint256 batchId = block.number;
        uint256 shard = shardOf(msg.sender);
        orderId = keccak256(abi.encode(msg.sender, nonces[msg.sender]++));
        _orders[orderId] = Order({
            owner: msg.sender,
            batchId: uint64(batchId),
            tick: tick,
            isBuy: isBuy,
            claimed: false,
            size: size,
            escrow: escrow
        });

        Book storage book = _books[batchId][shard];
        if (isBuy) book.levels[tick].buy += size;
        else book.levels[tick].sell += size;
        book.active.set(tick);

        (isBuy ? QUOTE : BASE).safeTransferFrom(msg.sender, address(this), escrow);
        emit OrderPlaced(orderId, msg.sender, batchId, isBuy, tick, size, escrow, shard);
    }

    /// @inheritdoc IMetronome
    function settle(uint256 batchId) external nonReentrant returns (BatchResult memory) {
        return _settle(batchId);
    }

    /// @inheritdoc IMetronome
    function claim(bytes32 orderId) external nonReentrant returns (uint256 baseOut, uint256 quoteOut) {
        return _claim(orderId);
    }

    /// @inheritdoc IMetronome
    function claimMany(bytes32[] calldata orderIds) external nonReentrant {
        _claimMany(orderIds);
    }

    /// @inheritdoc IMetronome
    function settleAndClaim(uint256 batchId, bytes32[] calldata orderIds) external nonReentrant {
        _settle(batchId);
        _claimMany(orderIds);
    }

    // ------------------------------------------------------------------ views

    /// @notice Price of `tick`: quote raw units per base raw unit, scaled by PRICE_SCALE.
    function price(uint256 tick) public view returns (uint256) {
        return TickMath.price(PRICE_MIN, tick);
    }

    /// @notice Quote a buy of `size` at `tick` escrows: the cost at the limit price plus the fee, rounded up.
    function quoteBuyEscrow(uint256 size, uint256 tick) public view returns (uint256) {
        uint256 cost = Math.mulDiv(size, price(tick), PRICE_SCALE, Math.Rounding.Ceil);
        return cost + _fee(cost);
    }

    function shardOf(address owner) public view returns (uint256) {
        return uint256(uint160(owner)) % SHARDS;
    }

    function getOrder(bytes32 orderId) external view returns (Order memory) {
        return _orders[orderId];
    }

    function getBatchResult(uint256 batchId) external view returns (BatchResult memory) {
        return _results[batchId];
    }

    /// @notice A batch's order book merged across shards: active ticks (ascending) with total buy and sell size.
    function getBook(uint256 batchId)
        external
        view
        returns (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells)
    {
        return _aggregate(batchId);
    }

    /// @notice What `claim(orderId)` would pay now. Returns zeros if the order is unknown, claimed or unsettled.
    function previewClaim(bytes32 orderId)
        external
        view
        returns (uint256 baseOut, uint256 quoteOut, uint256 fee, bool ready)
    {
        Order memory o = _orders[orderId];
        BatchResult memory r = _results[o.batchId];
        if (o.owner == address(0) || o.claimed || !r.settled) return (0, 0, 0, false);
        (baseOut, quoteOut, fee) = _payout(o, r);
        ready = true;
    }

    // ------------------------------------------------------------------ admin

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setFees(uint16 feeBps_, uint128 settleReward_) external onlyOwner {
        if (feeBps_ > MAX_FEE_BPS) revert InvalidConfig();
        feeBps = feeBps_;
        settleReward = settleReward_;
        emit FeesUpdated(feeBps_, settleReward_);
    }

    function setOracle(address feed, uint16 maxDeviationBps, uint32 maxStaleness) external onlyOwner {
        if (feed != address(0) && (maxDeviationBps == 0 || maxStaleness == 0)) revert InvalidConfig();
        oracle = OracleConfig(IAggregatorV3(feed), maxDeviationBps, maxStaleness);
        emit OracleUpdated(feed, maxDeviationBps, maxStaleness);
    }

    function withdrawFees(address to, uint256 amount) external onlyOwner {
        feesAccrued -= amount;
        QUOTE.safeTransfer(to, amount);
        emit FeesWithdrawn(to, amount);
    }

    // ------------------------------------------------------------------ internals

    function _settle(uint256 batchId) internal returns (BatchResult memory r) {
        r = _results[batchId];
        if (r.settled) return r;
        if (batchId >= block.number) revert BatchNotClosed(batchId);

        (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells) = _aggregate(batchId);
        ClearingLib.Result memory c = ClearingLib.clear(ticks, buys, sells);

        r.settled = true;
        if (c.volume > 0) {
            uint256 p = price(c.clearingTick);
            if (_priceGuardTrips(p)) {
                r.voided = true;
            } else {
                r.clearingTick = c.clearingTick;
                r.rationed = c.rationed;
                r.volume = c.volume;
                r.fillNum = c.fillNum;
                r.fillDen = c.fillDen;
                lastSettledBatch = uint64(batchId);
                lastClearingTick = c.clearingTick;
            }
        }
        _results[batchId] = r;
        emit BatchSettled(
            batchId, r.clearingTick, price(r.clearingTick), r.volume, r.rationed, r.fillNum, r.fillDen, r.voided
        );

        uint256 reward = settleReward;
        if (r.volume > 0 && reward > 0 && feesAccrued >= reward) {
            feesAccrued -= reward;
            QUOTE.safeTransfer(msg.sender, reward);
            emit SettleRewardPaid(batchId, msg.sender, reward);
        }
    }

    function _claimMany(bytes32[] calldata orderIds) internal {
        for (uint256 i; i < orderIds.length; ++i) {
            Order storage o = _orders[orderIds[i]];
            if (o.owner == address(0) || o.claimed) continue;
            _claim(orderIds[i]);
        }
    }

    function _claim(bytes32 orderId) internal returns (uint256 baseOut, uint256 quoteOut) {
        Order storage o = _orders[orderId];
        if (o.owner == address(0)) revert UnknownOrder(orderId);
        if (o.claimed) revert AlreadyClaimed(orderId);
        o.claimed = true;

        BatchResult memory r = _settle(o.batchId);
        uint256 fee;
        (baseOut, quoteOut, fee) = _payout(o, r);
        feesAccrued += fee;

        address owner_ = o.owner;
        if (baseOut > 0) BASE.safeTransfer(owner_, baseOut);
        if (quoteOut > 0) QUOTE.safeTransfer(owner_, quoteOut);
        emit Claimed(orderId, owner_, baseOut, quoteOut, fee);
    }

    /// @dev Rounding rule: what the user gives is rounded up, what they receive is rounded down, both from their
    ///      exact pro-rata share. Quote is priced from the exact fractional fill, not a rounded base amount.
    function _payout(Order memory o, BatchResult memory r)
        internal
        view
        returns (uint256 baseOut, uint256 quoteOut, uint256 fee)
    {
        (uint256 num, uint256 den) = _fillFraction(o, r);
        if (num == 0) {
            // Not filled: the whole escrow comes back.
            if (o.isBuy) return (0, o.escrow, 0);
            return (o.escrow, 0, 0);
        }

        uint256 p = price(r.clearingTick);
        // Exact quote value of the fill is size * num * p / (den * PRICE_SCALE). size, num < 2^128 so the product fits.
        uint256 fillTimesNum = uint256(o.size) * num;
        if (o.isBuy) {
            baseOut = Math.mulDiv(o.size, num, den); // receive: down
            uint256 cost = Math.mulDiv(fillTimesNum, p, den * PRICE_SCALE, Math.Rounding.Ceil); // give: up
            // Escrow covered the fee at placement time; cap it so a later fee increase can never lock funds.
            fee = Math.min(_fee(cost), o.escrow - cost);
            quoteOut = o.escrow - cost - fee; // refund
        } else {
            uint256 baseGiven = Math.mulDiv(o.size, num, den, Math.Rounding.Ceil); // give: up
            uint256 proceeds = Math.mulDiv(fillTimesNum, p, den * PRICE_SCALE); // receive: down
            fee = _fee(proceeds);
            quoteOut = proceeds - fee;
            baseOut = o.escrow - baseGiven; // refund
        }
    }

    function _fillFraction(Order memory o, BatchResult memory r) internal pure returns (uint256, uint256) {
        ClearingLib.Result memory c = ClearingLib.Result({
            clearingTick: r.clearingTick, rationed: r.rationed, volume: r.volume, fillNum: r.fillNum, fillDen: r.fillDen
        });
        return ClearingLib.fillFraction(c, o.isBuy, o.tick);
    }

    function _fee(uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, feeBps, BPS, Math.Rounding.Ceil);
    }

    /// @dev True if an oracle is set and the clearing price is stale-checked out or too far from it.
    function _priceGuardTrips(uint256 p) internal view returns (bool) {
        OracleConfig memory cfg = oracle;
        if (address(cfg.feed) == address(0)) return false;
        // Low-level calls: try/catch can't catch a feed with no code or malformed return data, and a broken feed
        // must void batches (refunding everyone) rather than block settle and, with it, every claim.
        (bool ok, bytes memory data) = address(cfg.feed).staticcall(abi.encodeCall(IAggregatorV3.latestRoundData, ()));
        if (!ok || data.length < 160) return true;
        (, int256 answer,, uint256 updatedAt,) = abi.decode(data, (uint80, int256, uint256, uint256, uint80));
        if (answer <= 0 || block.timestamp > updatedAt + cfg.maxStaleness) return true;

        (ok, data) = address(cfg.feed).staticcall(abi.encodeCall(IAggregatorV3.decimals, ()));
        if (!ok || data.length < 32) return true;
        uint256 feedDecimals = abi.decode(data, (uint256));
        if (feedDecimals > 36) return true;
        return _deviates(p, uint256(answer), feedDecimals, cfg.maxDeviationBps);
    }

    /// @dev The feed quotes whole base in whole quote; convert it to raw quote per raw base, scaled by PRICE_SCALE.
    function _deviates(uint256 p, uint256 answer, uint256 feedDecimals, uint16 maxDeviationBps)
        internal
        view
        returns (bool)
    {
        uint256 ref =
            Math.mulDiv(answer, 10 ** uint256(QUOTE_DECIMALS) * PRICE_SCALE, 10 ** (feedDecimals + BASE_DECIMALS));
        uint256 diff = p > ref ? p - ref : ref - p;
        return diff * BPS > ref * maxDeviationBps;
    }

    /// @dev Merges the shard books of a batch. Cost: 1 SLOAD per shard summary, 1 per non-empty bitmap word, and 1 per
    ///      (shard, tick) that actually has orders.
    function _aggregate(uint256 batchId)
        internal
        view
        returns (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells)
    {
        uint256 k = SHARDS;
        uint256[16][] memory shardWords = new uint256[16][](k);
        uint256[16] memory merged;
        for (uint256 s; s < k; ++s) {
            _books[batchId][s].active.orInto(shardWords[s]);
            for (uint256 w; w < 16; ++w) {
                merged[w] |= shardWords[s][w];
            }
        }

        uint256 count;
        for (uint256 w; w < 16; ++w) {
            count += _popcount(merged[w]);
        }
        ticks = new uint16[](count);
        buys = new uint256[](count);
        sells = new uint256[](count);

        uint256 i;
        for (uint256 w; w < 16; ++w) {
            uint256 bits = merged[w];
            while (bits != 0) {
                uint256 bit = TickBitmap.lowestBit(bits);
                bits &= bits - 1;
                uint256 tick = (w << 8) | bit;
                ticks[i] = uint16(tick);
                (buys[i], sells[i]) = _sumLevel(batchId, shardWords, w, bit);
                ++i;
            }
        }
    }

    /// @dev Total buy and sell size at one tick, reading only the shards whose bitmap has it.
    function _sumLevel(uint256 batchId, uint256[16][] memory shardWords, uint256 w, uint256 bit)
        internal
        view
        returns (uint256 buy, uint256 sell)
    {
        uint256 tick = (w << 8) | bit;
        for (uint256 s; s < shardWords.length; ++s) {
            if ((shardWords[s][w] >> bit) & 1 == 0) continue;
            Level storage l = _books[batchId][s].levels[tick];
            buy += l.buy;
            sell += l.sell;
        }
    }

    function _popcount(uint256 x) internal pure returns (uint256 c) {
        while (x != 0) {
            x &= x - 1;
            ++c;
        }
    }
}
