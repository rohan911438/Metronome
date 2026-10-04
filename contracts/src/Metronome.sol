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
/// @dev Two kinds of liquidity meet in each batch:
///      - Taker orders live in the batch's sharded book and are filled pro-rata by the batch result.
///      - Resting orders join a per-(side, tick) pool at the settle of the batch they were placed in, and stay in every
///        later batch. A pool is one big order: fills update per-share accumulators, so settle stays O(ticks) and each
///        order's claim is O(1).
///      placeOrder writes only the caller's order and nonce plus its shard's book and batch chain: no global state.
///      Batches with orders must settle in order (pools carry state between them); each shard keeps a chain of the
///      batches it has orders in, so that ordering also needs no global writes. See docs/architecture.md.
contract Metronome is IMetronome, Ownable2Step, Pausable, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    using TickBitmap for TickBitmap.Map;

    /// @notice Prices are quote raw units per base raw unit, scaled by 1e36.
    uint256 public constant PRICE_SCALE = 1e36;
    uint256 public constant MAX_SHARDS = 64;
    uint256 public constant MAX_FEE_BPS = 100; // 1%
    /// @notice Extra quote escrowed by resting buys to absorb per-fill rounding across many batches. Refunded on close.
    uint256 public constant RESTING_BUY_BUFFER = 1000;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant ACC = 1e36; // accumulator scale
    /// @dev A pool whose shares outgrow its remaining size by this factor is frozen, bounding share inflation.
    uint256 internal constant MAX_SHARE_RATIO = 1e12;
    /// @notice Once the market has traded, orders must be within this many ticks (~13.7%) of the last clearing price,
    ///         and only resting pools inside that band take part in a batch (the others wait until the price returns).
    /// @dev Bounds the work of settle no matter how many pools exist: without it, 1-MON resting orders spread over
    ///      ~1,500 ticks could push settle past the per-transaction gas limit and freeze the market. The band moves
    ///      with the price, like an exchange's price limits.
    uint256 public constant PRICE_BAND = 128;

    struct Level {
        uint128 buy;
        uint128 sell;
    }

    /// @dev One per (batch, shard). Fixed arrays so neighbouring ticks share a Monad storage page.
    struct Book {
        TickBitmap.Map active;
        Level[4096] takers; // one-batch orders
        Level[4096] resting; // resting orders placed this batch; they join their pool at settle
    }

    /// @dev Current generation of one side's pool at one tick. shares == 0 iff remaining == 0.
    struct Pool {
        uint32 gen;
        uint128 remaining; // base offered (sell) or still wanted (buy)
        uint256 shares;
    }

    /// @dev Accumulators of one pool generation. Sell: accA = quote received per share.
    ///      Buy: accA = base received per share, accB = quote spent per share. Scaled by ACC. Makers pay no fee.
    struct PoolAcc {
        uint256 accA;
        uint256 accB;
        bool frozen;
        uint128 frozenRemaining;
        uint256 frozenShares;
    }

    /// @dev Resting orders of one (batch, side, tick) join their pool together.
    struct Join {
        uint32 gen;
        uint128 groupSize;
        uint256 minted;
        uint256 accA;
        uint256 accB;
    }

    /// @dev A resting order's accumulator snapshot after its last claim.
    struct Snap {
        bool init;
        uint256 accA;
        uint256 accB;
    }

    /// @dev Per-tick batch totals, merged across shards.
    struct TickTotals {
        uint16 tick;
        uint256 takerBuy;
        uint256 takerSell;
        uint256 restBuy;
        uint256 restSell;
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

    uint56 public lastSettledBatch;
    uint16 public lastClearingTick;

    mapping(uint256 batchId => mapping(uint256 shard => Book)) internal _books;
    mapping(uint256 batchId => BatchResult) internal _results;
    mapping(bytes32 orderId => Order) internal _orders;
    mapping(address owner => uint256) public nonces;

    // Per-shard chains of batches with orders: next[s][b] is the shard's next batch after b; cursor[s] is the last
    // settled one; last[s] the newest.
    mapping(uint256 shard => mapping(uint256 batchId => uint256)) internal _shardNext;
    mapping(uint256 shard => uint256) internal _shardCursor;
    mapping(uint256 shard => uint256) internal _shardLast;

    Pool[4096] internal _buyPools;
    Pool[4096] internal _sellPools;
    TickBitmap.Map internal _buyPoolTicks;
    TickBitmap.Map internal _sellPoolTicks;
    mapping(uint256 sideTick => mapping(uint32 gen => PoolAcc)) internal _acc;
    mapping(uint256 batchId => mapping(uint256 sideTick => Join)) internal _joins;
    mapping(bytes32 orderId => Snap) internal _snaps;

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

    // ================================================================== trading

    /// @inheritdoc IMetronome
    function placeOrder(bool isBuy, uint16 tick, uint128 size, bool resting)
        external
        whenNotPaused
        nonReentrant
        returns (bytes32 orderId)
    {
        if (tick > TickMath.MAX_TICK) revert TickMath.TickOutOfRange(tick);
        if (size < MIN_ORDER_SIZE) revert OrderTooSmall(size, MIN_ORDER_SIZE);
        if (lastSettledBatch != 0) {
            (uint256 lo, uint256 hi) = _band();
            if (tick < lo || tick > hi) revert OutsidePriceBand(tick, lastClearingTick);
        }

        uint128 escrow = size;
        if (isBuy) escrow = (resting ? restingBuyEscrow(size, tick) : quoteBuyEscrow(size, tick)).toUint128();
        if (escrow == 0) revert ZeroEscrow();

        uint256 batchId = block.number;
        uint256 shard = shardOf(msg.sender);
        orderId = keccak256(abi.encode(msg.sender, nonces[msg.sender]++));
        _orders[orderId] = Order({
            owner: msg.sender,
            batchId: uint56(batchId),
            tick: tick,
            isBuy: isBuy,
            resting: resting,
            closed: false,
            size: size,
            escrow: escrow
        });

        Book storage book = _books[batchId][shard];
        if (book.active.summary == 0) {
            // First order of this shard in this batch: append the batch to the shard's chain.
            _shardNext[shard][_shardLast[shard]] = batchId;
            _shardLast[shard] = batchId;
        }
        Level storage level = resting ? book.resting[tick] : book.takers[tick];
        if (isBuy) level.buy += size;
        else level.sell += size;
        book.active.set(tick);

        (isBuy ? QUOTE : BASE).safeTransferFrom(msg.sender, address(this), escrow);
        emit OrderPlaced(orderId, msg.sender, batchId, isBuy, resting, tick, size, escrow, shard);
    }

    /// @inheritdoc IMetronome
    function settle(uint256 batchId) external nonReentrant {
        _settleThrough(batchId);
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
        _settleThrough(batchId);
        _claimMany(orderIds);
    }

    /// @inheritdoc IMetronome
    function cancel(bytes32 orderId) external nonReentrant returns (uint256 baseOut, uint256 quoteOut) {
        Order storage o = _orders[orderId];
        if (o.owner == address(0)) revert UnknownOrder(orderId);
        if (o.owner != msg.sender) revert NotOwner(orderId);
        if (!o.resting) revert NotResting(orderId);
        if (o.closed) revert AlreadyClosed(orderId);

        if (o.batchId == block.number) {
            // Not joined yet: take it back out of this batch's book and refund everything.
            Level storage level = _books[block.number][shardOf(o.owner)].resting[o.tick];
            if (o.isBuy) level.buy -= o.size;
            else level.sell -= o.size;
            (baseOut, quoteOut) = o.isBuy ? (uint256(0), uint256(o.escrow)) : (uint256(o.escrow), uint256(0));
            o.escrow = 0;
        } else {
            // Cancels take effect from this block on: every earlier batch must be settled first, so a maker can
            // never pull liquidity out of a batch that has already closed.
            _settleThrough(block.number - 1);
            (baseOut, quoteOut) = _harvest(orderId, o);
            if (!o.closed) {
                (uint256 b, uint256 q) = _withdrawFromPool(orderId, o);
                baseOut += b;
                quoteOut += q;
            }
        }
        o.closed = true;
        _pay(o.owner, baseOut, quoteOut);
        emit OrderCancelled(orderId, o.owner, baseOut, quoteOut);
    }

    // ================================================================== views

    /// @notice Price of `tick`: quote raw units per base raw unit, scaled by PRICE_SCALE.
    function price(uint256 tick) public view returns (uint256) {
        return TickMath.price(PRICE_MIN, tick);
    }

    /// @notice Quote a taker buy of `size` at `tick` escrows: the cost at the limit price plus the fee, rounded up.
    function quoteBuyEscrow(uint256 size, uint256 tick) public view returns (uint256) {
        uint256 cost = Math.mulDiv(size, price(tick), PRICE_SCALE, Math.Rounding.Ceil);
        return cost + _fee(cost);
    }

    /// @notice Quote a resting buy escrows: the cost at the limit price plus RESTING_BUY_BUFFER. Makers pay no fee.
    function restingBuyEscrow(uint256 size, uint256 tick) public view returns (uint256) {
        return Math.mulDiv(size, price(tick), PRICE_SCALE, Math.Rounding.Ceil) + RESTING_BUY_BUFFER;
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

    /// @notice Oldest batch with orders that isn't settled yet, or 0 if none.
    function nextPendingBatch() public view returns (uint256 next) {
        for (uint256 s; s < SHARDS; ++s) {
            uint256 n = _shardNext[s][_shardCursor[s]];
            if (n != 0 && (next == 0 || n < next)) next = n;
        }
    }

    /// @notice A batch's own orders merged across shards: taker and newly placed resting size per active tick.
    function getBatchBook(uint256 batchId)
        external
        view
        returns (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells)
    {
        (TickTotals[] memory t,) = _aggregateBatch(batchId);
        ticks = new uint16[](t.length);
        buys = new uint256[](t.length);
        sells = new uint256[](t.length);
        for (uint256 i; i < t.length; ++i) {
            ticks[i] = t[i].tick;
            buys[i] = t[i].takerBuy + t[i].restBuy;
            sells[i] = t[i].takerSell + t[i].restSell;
        }
    }

    /// @notice The resting pools as of the last settled batch: base wanted (buys) and offered (sells) per tick.
    function getRestingBook()
        external
        view
        returns (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells)
    {
        uint256[16] memory words;
        _buyPoolTicks.orInto(words);
        _sellPoolTicks.orInto(words);
        uint256 count;
        for (uint256 w; w < 16; ++w) {
            count += _popcount(words[w]);
        }
        ticks = new uint16[](count);
        buys = new uint256[](count);
        sells = new uint256[](count);
        uint256 i;
        for (uint256 w; w < 16; ++w) {
            uint256 bits = words[w];
            while (bits != 0) {
                uint256 tick = (w << 8) | TickBitmap.lowestBit(bits);
                bits &= bits - 1;
                ticks[i] = uint16(tick);
                buys[i] = _buyPools[tick].remaining;
                sells[i] = _sellPools[tick].remaining;
                ++i;
            }
        }
    }

    function getPool(bool isBuy, uint16 tick) external view returns (Pool memory) {
        return isBuy ? _buyPools[tick] : _sellPools[tick];
    }

    /// @notice What `claim(orderId)` would pay now, given batches settled so far. `ready` is false if the order is
    ///         unknown, closed, or its batch isn't settled yet.
    function previewClaim(bytes32 orderId) external view returns (uint256 baseOut, uint256 quoteOut, bool ready) {
        Order memory o = _orders[orderId];
        if (o.owner == address(0) || o.closed || !_results[o.batchId].settled) return (0, 0, false);
        ready = true;
        if (!o.resting) {
            (baseOut, quoteOut,) = _takerPayout(o, _results[o.batchId]);
        } else {
            (baseOut, quoteOut,,,) = _restingPayout(orderId, o);
        }
    }

    // ================================================================== admin

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

    // ================================================================== settle

    /// @dev Settles every pending batch <= batchId in order, then marks batchId settled even if it had no orders.
    function _settleThrough(uint256 batchId) internal {
        if (batchId >= block.number) revert BatchNotClosed(batchId);
        if (_results[batchId].settled) return;
        while (true) {
            uint256 next = nextPendingBatch();
            if (next == 0 || next > batchId) break;
            _settleOne(next);
        }
        if (!_results[batchId].settled) {
            _results[batchId].settled = true;
            emit BatchSettled(batchId, 0, price(0), 0, 0, 0, 0, false);
        }
    }

    function _settleOne(uint256 batchId) internal {
        for (uint256 s; s < SHARDS; ++s) {
            if (_shardNext[s][_shardCursor[s]] == batchId) _shardCursor[s] = batchId;
        }

        (TickTotals[] memory bt, uint256[16] memory words) = _aggregateBatch(batchId);

        // 1. Resting orders placed in this batch join their pools before clearing, so they trade in it too.
        for (uint256 i; i < bt.length; ++i) {
            if (bt[i].restBuy > 0) _join(batchId, true, bt[i].tick, bt[i].restBuy);
            if (bt[i].restSell > 0) _join(batchId, false, bt[i].tick, bt[i].restSell);
        }

        // 2. Clear takers + pools together: every pool before the first trade, then the pools inside the price band.
        if (lastSettledBatch == 0) {
            _buyPoolTicks.orInto(words);
            _sellPoolTicks.orInto(words);
        } else {
            (uint256 lo, uint256 hi) = _band();
            _buyPoolTicks.orIntoRange(words, lo, hi);
            _sellPoolTicks.orIntoRange(words, lo, hi);
        }
        (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells) = _mergeWithPools(bt, words);
        ClearingLib.Result memory c = ClearingLib.clear(ticks, buys, sells);

        BatchResult memory r;
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
                lastSettledBatch = uint56(batchId);
                lastClearingTick = c.clearingTick;
                // 3. Fill the pools that traded.
                for (uint256 i; i < ticks.length; ++i) {
                    _fillPool(true, ticks[i], c, p);
                    _fillPool(false, ticks[i], c, p);
                }
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

    function _join(uint256 batchId, bool isBuy, uint16 tick, uint256 groupSize) internal {
        uint256 key = _sideTick(isBuy, tick);
        Pool storage pool = isBuy ? _buyPools[tick] : _sellPools[tick];
        uint256 minted = pool.shares == 0 ? groupSize : Math.mulDiv(groupSize, pool.shares, pool.remaining);
        PoolAcc storage acc = _acc[key][pool.gen];
        _joins[batchId][key] =
            Join({gen: pool.gen, groupSize: groupSize.toUint128(), minted: minted, accA: acc.accA, accB: acc.accB});
        pool.remaining += groupSize.toUint128();
        pool.shares += minted;
        (isBuy ? _buyPoolTicks : _sellPoolTicks).set(tick);
        emit PoolUpdated(isBuy, tick, pool.gen, pool.remaining);
    }

    /// @dev Treats the pool as one order of size `remaining` and applies the batch's fill to it, with the same rounding
    ///      rule as single orders: what the pool gives is rounded up, what it receives is rounded down. Resting orders
    ///      are makers and pay no fee, so a fee change can never outgrow what a maker escrowed.
    function _fillPool(bool isBuy, uint16 tick, ClearingLib.Result memory c, uint256 p) internal {
        Pool storage pool = isBuy ? _buyPools[tick] : _sellPools[tick];
        uint256 remaining = pool.remaining;
        if (remaining == 0) return;
        (uint256 num, uint256 den) = ClearingLib.fillFraction(c, isBuy, tick);
        if (num == 0) return;

        PoolAcc storage acc = _acc[_sideTick(isBuy, tick)][pool.gen];
        uint256 shares = pool.shares;
        uint256 remTimesNum = remaining * num;
        if (isBuy) {
            uint256 received = Math.mulDiv(remaining, num, den);
            uint256 spent = Math.mulDiv(remTimesNum, p, den * PRICE_SCALE, Math.Rounding.Ceil);
            acc.accA += Math.mulDiv(received, ACC, shares);
            acc.accB += Math.mulDiv(spent, ACC, shares, Math.Rounding.Ceil);
            remaining -= received;
        } else {
            uint256 given = Math.mulDiv(remaining, num, den, Math.Rounding.Ceil);
            uint256 proceeds = Math.mulDiv(remTimesNum, p, den * PRICE_SCALE);
            acc.accA += Math.mulDiv(proceeds, ACC, shares);
            remaining -= given;
        }
        pool.remaining = uint128(remaining);
        if (remaining < MIN_ORDER_SIZE || shares / MAX_SHARE_RATIO > remaining) _freeze(isBuy, tick);
        else emit PoolUpdated(isBuy, tick, pool.gen, uint128(remaining));
    }

    /// @dev Ends a pool generation: its leftover (dust, or a pool with inflated shares) is no longer offered, and its
    ///      holders withdraw their share of it when they next claim.
    function _freeze(bool isBuy, uint16 tick) internal {
        Pool storage pool = isBuy ? _buyPools[tick] : _sellPools[tick];
        PoolAcc storage acc = _acc[_sideTick(isBuy, tick)][pool.gen];
        acc.frozen = true;
        acc.frozenRemaining = pool.remaining;
        acc.frozenShares = pool.shares;
        pool.gen++;
        pool.remaining = 0;
        pool.shares = 0;
        (isBuy ? _buyPoolTicks : _sellPoolTicks).unset(tick);
        emit PoolUpdated(isBuy, tick, pool.gen, 0);
    }

    // ================================================================== claims

    function _claimMany(bytes32[] calldata orderIds) internal {
        for (uint256 i; i < orderIds.length; ++i) {
            Order storage o = _orders[orderIds[i]];
            if (o.owner == address(0) || o.closed) continue;
            _claim(orderIds[i]);
        }
    }

    function _claim(bytes32 orderId) internal returns (uint256 baseOut, uint256 quoteOut) {
        Order storage o = _orders[orderId];
        if (o.owner == address(0)) revert UnknownOrder(orderId);
        if (o.closed) revert AlreadyClosed(orderId);
        _settleThrough(o.batchId);

        if (o.resting) {
            (baseOut, quoteOut) = _harvest(orderId, o);
        } else {
            uint256 fee;
            (baseOut, quoteOut, fee) = _takerPayout(o, _results[o.batchId]);
            feesAccrued += fee;
            o.escrow = 0;
            o.closed = true;
        }
        _pay(o.owner, baseOut, quoteOut);
        emit Claimed(orderId, o.owner, baseOut, quoteOut, o.closed);
    }

    /// @dev Rounding rule: what the user gives is rounded up, what they receive is rounded down, both from their
    ///      exact pro-rata share. Quote is priced from the exact fractional fill, not a rounded base amount.
    function _takerPayout(Order memory o, BatchResult memory r)
        internal
        view
        returns (uint256 baseOut, uint256 quoteOut, uint256 fee)
    {
        (uint256 num, uint256 den) = ClearingLib.fillFraction(_toClearing(r), o.isBuy, o.tick);
        if (num == 0) {
            // Not filled: the whole escrow comes back.
            if (o.isBuy) return (0, o.escrow, 0);
            return (o.escrow, 0, 0);
        }

        uint256 p = price(r.clearingTick);
        // Exact quote value of the fill is size * num * p / (den * PRICE_SCALE). size, num < 2^128 so the product fits.
        uint256 sizeTimesNum = uint256(o.size) * num;
        if (o.isBuy) {
            baseOut = Math.mulDiv(o.size, num, den); // receive: down
            uint256 cost = Math.mulDiv(sizeTimesNum, p, den * PRICE_SCALE, Math.Rounding.Ceil); // give: up
            // Escrow covered the fee at placement time; cap it so a later fee increase can never lock funds.
            fee = Math.min(_fee(cost), o.escrow - cost);
            quoteOut = o.escrow - cost - fee; // refund
        } else {
            uint256 baseGiven = Math.mulDiv(o.size, num, den, Math.Rounding.Ceil); // give: up
            uint256 proceeds = Math.mulDiv(sizeTimesNum, p, den * PRICE_SCALE); // receive: down
            fee = _fee(proceeds);
            quoteOut = proceeds - fee;
            baseOut = o.escrow - baseGiven; // refund
        }
    }

    /// @dev Pays a resting order what its pool has earned since its last claim, and closes it if its pool generation
    ///      has been frozen (used up).
    function _harvest(bytes32 orderId, Order storage o) internal returns (uint256 baseOut, uint256 quoteOut) {
        uint256 spent;
        bool closes;
        (baseOut, quoteOut, spent, closes,) = _restingPayout(orderId, o);
        PoolAcc storage acc = _acc[_sideTick(o.isBuy, o.tick)][_joins[o.batchId][_sideTick(o.isBuy, o.tick)].gen];
        _snaps[orderId] = Snap({init: true, accA: acc.accA, accB: acc.accB});
        if (o.isBuy) o.escrow -= uint128(spent + (closes ? quoteOut : 0));
        if (closes) {
            if (!o.isBuy) o.escrow = 0;
            o.closed = true;
        }
    }

    /// @return baseOut Base to pay now.
    /// @return quoteOut Quote to pay now.
    /// @return spent Quote spent from a buy's escrow since the last claim.
    /// @return closes True if the pool generation is frozen, so this claim closes the order.
    /// @return shares The order's shares in its pool generation.
    function _restingPayout(bytes32 orderId, Order memory o)
        internal
        view
        returns (uint256 baseOut, uint256 quoteOut, uint256 spent, bool closes, uint256 shares)
    {
        uint256 key = _sideTick(o.isBuy, o.tick);
        Join memory j = _joins[o.batchId][key];
        shares = Math.mulDiv(j.minted, o.size, j.groupSize);
        Snap memory sn = _snaps[orderId];
        (uint256 lastA, uint256 lastB) = sn.init ? (sn.accA, sn.accB) : (j.accA, j.accB);
        PoolAcc memory acc = _acc[key][j.gen];

        if (o.isBuy) {
            baseOut = Math.mulDiv(shares, acc.accA - lastA, ACC);
            spent = Math.min(Math.mulDiv(shares, acc.accB - lastB, ACC, Math.Rounding.Ceil), o.escrow);
        } else {
            quoteOut = Math.mulDiv(shares, acc.accA - lastA, ACC);
        }
        closes = acc.frozen;
        if (closes) {
            if (o.isBuy) quoteOut = o.escrow - spent; // everything not spent comes back
            else baseOut = Math.mulDiv(acc.frozenRemaining, shares, acc.frozenShares);
        }
    }

    /// @dev Removes a resting order's unfilled part from its live pool. Assumes it was just harvested.
    function _withdrawFromPool(bytes32 orderId, Order storage o) internal returns (uint256 baseOut, uint256 quoteOut) {
        (,,,, uint256 shares) = _restingPayout(orderId, o);
        Pool storage pool = o.isBuy ? _buyPools[o.tick] : _sellPools[o.tick];
        uint256 remaining = pool.remaining;
        uint256 mine = Math.mulDiv(remaining, shares, pool.shares);
        remaining -= mine;
        pool.shares -= shares;

        if (o.isBuy) {
            quoteOut = o.escrow; // unspent escrow, including the buffer
        } else {
            baseOut = mine;
        }
        o.escrow = 0;

        if (pool.shares == 0) {
            // Last holder left; any rounding dust stays with the contract.
            pool.remaining = 0;
            (o.isBuy ? _buyPoolTicks : _sellPoolTicks).unset(o.tick);
            emit PoolUpdated(o.isBuy, o.tick, pool.gen, 0);
        } else {
            pool.remaining = uint128(remaining);
            if (remaining < MIN_ORDER_SIZE) _freeze(o.isBuy, o.tick);
            else emit PoolUpdated(o.isBuy, o.tick, pool.gen, uint128(remaining));
        }
    }

    // ================================================================== helpers

    function _pay(address to, uint256 baseOut, uint256 quoteOut) internal {
        if (baseOut > 0) BASE.safeTransfer(to, baseOut);
        if (quoteOut > 0) QUOTE.safeTransfer(to, quoteOut);
    }

    function _sideTick(bool isBuy, uint256 tick) internal pure returns (uint256) {
        return (tick << 1) | (isBuy ? 1 : 0);
    }

    function _toClearing(BatchResult memory r) internal pure returns (ClearingLib.Result memory) {
        return ClearingLib.Result({
            clearingTick: r.clearingTick, rationed: r.rationed, volume: r.volume, fillNum: r.fillNum, fillDen: r.fillDen
        });
    }

    /// @dev Ticks within PRICE_BAND of the last clearing price, clamped to the grid.
    function _band() internal view returns (uint256 lo, uint256 hi) {
        uint256 ref = lastClearingTick;
        lo = ref > PRICE_BAND ? ref - PRICE_BAND : 0;
        hi = Math.min(ref + PRICE_BAND, TickMath.MAX_TICK);
    }

    function _fee(uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, feeBps, BPS, Math.Rounding.Ceil);
    }

    /// @dev True if an oracle is set and the feed is broken, stale, or too far from the clearing price.
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

    /// @dev Merges the shard books of a batch. Returns per-tick totals and the merged bitmap words.
    function _aggregateBatch(uint256 batchId)
        internal
        view
        returns (TickTotals[] memory totals, uint256[16] memory merged)
    {
        uint256 k = SHARDS;
        uint256[16][] memory shardWords = new uint256[16][](k);
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
        totals = new TickTotals[](count);

        uint256 i;
        for (uint256 w; w < 16; ++w) {
            uint256 bits = merged[w];
            while (bits != 0) {
                uint256 bit = TickBitmap.lowestBit(bits);
                bits &= bits - 1;
                totals[i] = _sumTick(batchId, shardWords, w, bit);
                ++i;
            }
        }
    }

    /// @dev Totals at one tick, reading only the shards whose bitmap has it.
    function _sumTick(uint256 batchId, uint256[16][] memory shardWords, uint256 w, uint256 bit)
        internal
        view
        returns (TickTotals memory t)
    {
        uint256 tick = (w << 8) | bit;
        t.tick = uint16(tick);
        for (uint256 s; s < shardWords.length; ++s) {
            if ((shardWords[s][w] >> bit) & 1 == 0) continue;
            Book storage b = _books[batchId][s];
            Level memory taker = b.takers[tick];
            Level memory rest = b.resting[tick];
            t.takerBuy += taker.buy;
            t.takerSell += taker.sell;
            t.restBuy += rest.buy;
            t.restSell += rest.sell;
        }
    }

    /// @dev Clearing input: every tick with taker orders or a live pool, with taker size plus pool remaining.
    ///      `words` is the union bitmap; `bt` (sorted) supplies the taker sizes.
    function _mergeWithPools(TickTotals[] memory bt, uint256[16] memory words)
        internal
        view
        returns (uint16[] memory ticks, uint256[] memory buys, uint256[] memory sells)
    {
        uint256 count;
        for (uint256 w; w < 16; ++w) {
            count += _popcount(words[w]);
        }
        ticks = new uint16[](count);
        buys = new uint256[](count);
        sells = new uint256[](count);

        uint256 i;
        uint256 j; // cursor into bt
        for (uint256 w; w < 16; ++w) {
            uint256 bits = words[w];
            while (bits != 0) {
                uint256 tick = (w << 8) | TickBitmap.lowestBit(bits);
                bits &= bits - 1;
                ticks[i] = uint16(tick);
                buys[i] = _buyPools[tick].remaining;
                sells[i] = _sellPools[tick].remaining;
                if (j < bt.length && bt[j].tick == tick) {
                    buys[i] += bt[j].takerBuy;
                    sells[i] += bt[j].takerSell;
                    ++j;
                }
                ++i;
            }
        }
    }

    function _popcount(uint256 x) internal pure returns (uint256 c) {
        while (x != 0) {
            x &= x - 1;
            ++c;
        }
    }
}
