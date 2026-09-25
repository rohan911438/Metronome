// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IMetronome
/// @notice A frequent batch auction market. All orders placed in one block clear together at one uniform price.
///         Taker orders live for one batch. Resting orders join a per-price pool and stay in every batch until filled
///         or cancelled, so makers post once instead of every block.
interface IMetronome {
    struct Order {
        address owner;
        uint56 batchId; // batch it was placed in (for resting orders: the batch it joined its pool)
        uint16 tick;
        bool isBuy;
        bool resting;
        bool closed; // fully claimed or cancelled
        uint128 size; // base units
        uint128 escrow; // quote (buy) or base (sell) still locked for this order
    }

    struct BatchResult {
        bool settled;
        bool voided; // price guard tripped: nothing traded, everyone refunded
        uint16 clearingTick;
        uint8 rationed; // ClearingLib.RATIONED_*
        uint128 volume;
        uint128 fillNum;
        uint128 fillDen;
    }

    event OrderPlaced(
        bytes32 indexed orderId,
        address indexed owner,
        uint256 indexed batchId,
        bool isBuy,
        bool resting,
        uint16 tick,
        uint128 size,
        uint128 escrow,
        uint256 shard
    );
    event BatchSettled(
        uint256 indexed batchId,
        uint16 clearingTick,
        uint256 price,
        uint128 volume,
        uint8 rationed,
        uint128 fillNum,
        uint128 fillDen,
        bool voided
    );
    /// @notice A resting pool changed at settle or cancel. `remaining` is base still offered (sell) or wanted (buy).
    event PoolUpdated(bool indexed isBuy, uint16 indexed tick, uint32 gen, uint128 remaining);
    event Claimed(bytes32 indexed orderId, address indexed owner, uint256 baseOut, uint256 quoteOut, bool closed);
    event OrderCancelled(bytes32 indexed orderId, address indexed owner, uint256 baseOut, uint256 quoteOut);
    event SettleRewardPaid(uint256 indexed batchId, address indexed settler, uint256 amount);

    error BatchNotClosed(uint256 batchId);
    error UnknownOrder(bytes32 orderId);
    error AlreadyClosed(bytes32 orderId);
    error NotOwner(bytes32 orderId);
    error NotResting(bytes32 orderId);
    error OrderTooSmall(uint256 size, uint256 minSize);
    error ZeroEscrow();

    /// @notice Places an order in the current block's batch and escrows the funds it needs.
    /// @param isBuy true to buy base with quote, false to sell base for quote.
    /// @param tick Limit price tick. A buy fills at or below it; a sell fills at or above it.
    /// @param size Order size in base units.
    /// @param resting false: one batch only, the unfilled part is refunded. true: stays until filled or cancelled.
    function placeOrder(bool isBuy, uint16 tick, uint128 size, bool resting) external returns (bytes32 orderId);

    /// @notice Settles every pending batch up to and including `batchId`, in order. Anyone can call it once
    ///         `block.number > batchId`. Idempotent.
    function settle(uint256 batchId) external;

    /// @notice Pays an order's fills to its owner (never to the caller), settling first if needed. Taker orders close
    ///         here. Resting orders pay what has filled so far and stay open until their pool is used up.
    function claim(bytes32 orderId) external returns (uint256 baseOut, uint256 quoteOut);

    /// @notice Claims many orders for their owners, skipping unknown or closed ones.
    function claimMany(bytes32[] calldata orderIds) external;

    /// @notice settle(batchId) then claimMany(orderIds), in one transaction.
    function settleAndClaim(uint256 batchId, bytes32[] calldata orderIds) external;

    /// @notice Cancels a resting order: pays out its fills so far and returns what is still unfilled. Owner only.
    function cancel(bytes32 orderId) external returns (uint256 baseOut, uint256 quoteOut);
}
