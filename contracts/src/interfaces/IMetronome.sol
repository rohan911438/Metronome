// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IMetronome
/// @notice A frequent batch auction market. All orders placed in one block clear together at one uniform price.
interface IMetronome {
    struct Order {
        address owner;
        uint64 batchId;
        uint16 tick;
        bool isBuy;
        bool claimed;
        uint128 size; // base units
        uint128 escrow; // quote (buy) or base (sell) locked at placement
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
    event Claimed(bytes32 indexed orderId, address indexed owner, uint256 baseOut, uint256 quoteOut, uint256 fee);
    event SettleRewardPaid(uint256 indexed batchId, address indexed settler, uint256 amount);

    error BatchNotClosed(uint256 batchId);
    error UnknownOrder(bytes32 orderId);
    error AlreadyClaimed(bytes32 orderId);
    error OrderTooSmall(uint256 size, uint256 minSize);
    error ZeroEscrow();

    /// @notice Places an order in the current block's batch and escrows the funds it needs.
    /// @param isBuy true to buy base with quote, false to sell base for quote.
    /// @param tick Limit price tick. A buy fills at or below it; a sell fills at or above it.
    /// @param size Order size in base units.
    function placeOrder(bool isBuy, uint16 tick, uint128 size) external returns (bytes32 orderId);

    /// @notice Clears a finished batch. Anyone can call it once `block.number > batchId`. Idempotent.
    function settle(uint256 batchId) external returns (BatchResult memory);

    /// @notice Pays out an order's fill and refunds the rest to its owner (never to the caller). Settles if needed.
    function claim(bytes32 orderId) external returns (uint256 baseOut, uint256 quoteOut);

    /// @notice Claims many orders for their owners, skipping ones already claimed.
    function claimMany(bytes32[] calldata orderIds) external;

    /// @notice settle(batchId) then claimMany(orderIds), in one transaction.
    function settleAndClaim(uint256 batchId, bytes32[] calldata orderIds) external;
}
