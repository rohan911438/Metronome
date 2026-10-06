// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IMetronome} from "../interfaces/IMetronome.sol";

/// @notice What a Chainlink CRE forwarder calls with a workflow's signed report.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title MetronomeHeartbeat
/// @notice Receiver for the `metronome-heartbeat` CRE workflow. Each report carries the MON/USD price the DON fetched
///         from an off-chain API (median across nodes) and, when a batch is waiting, a batch id to settle through.
///         The price is stored and served as an `IAggregatorV3` feed, so the market's oracle guard can read it; then
///         every pending batch up to the batch id is settled. `settle` is permissionless, so this adds no power: it lets
///         Chainlink's network run the keeper instead of our server. Settle rewards land here for the owner to sweep.
/// @dev The forwarder checks the DON's signatures, but any CRE workflow can target any receiver through it. Set
///      `workflowOwner` before the price feeds the market's oracle guard, or a stranger's workflow could write prices.
contract MetronomeHeartbeat is IReceiver, IAggregatorV3, Ownable2Step {
    using SafeERC20 for IERC20;

    uint8 public constant decimals = 8;

    IMetronome public immutable METRONOME;
    address public forwarder;
    /// @notice The only workflow owner whose reports are accepted; address(0) accepts any (the mock forwarder's simulations).
    address public workflowOwner;

    int256 public price;
    uint256 public priceUpdatedAt;
    uint80 public round;

    event ForwarderSet(address forwarder);
    event WorkflowOwnerSet(address workflowOwner);
    event PriceUpdated(uint80 indexed round, int256 price, uint256 observedAt);
    event Heartbeat(uint256 indexed batchId);

    error NotForwarder(address sender);
    error WrongWorkflowOwner(address workflowOwner);

    constructor(IMetronome metronome, address forwarder_, address owner_) Ownable(owner_) {
        METRONOME = metronome;
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @param report abi.encode(uint256 batchId, int256 price, uint256 observedAt): store `price` (8 decimals, observed
    ///        at unix time `observedAt`) unless it is older than the stored one, then settle every pending batch
    ///        <= batchId. batchId 0 is a price-only update.
    /// @param metadata abi.encodePacked(bytes32 workflowId, bytes10 workflowName, address workflowOwner), from the forwarder.
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        address expected = workflowOwner;
        if (expected != address(0)) {
            address author = metadata.length >= 62 ? address(bytes20(metadata[42:62])) : address(0);
            if (author != expected) revert WrongWorkflowOwner(author);
        }
        (uint256 batchId, int256 price_, uint256 observedAt) = abi.decode(report, (uint256, int256, uint256));
        if (price_ > 0 && observedAt > priceUpdatedAt && observedAt <= block.timestamp) {
            price = price_;
            priceUpdatedAt = observedAt;
            emit PriceUpdated(++round, price_, observedAt);
        }
        if (batchId != 0) {
            METRONOME.settle(batchId);
            emit Heartbeat(batchId);
        }
    }

    /// @notice The latest CRE price, Chainlink-style. A feed with no price yet reports answer 0 (the guard treats it as
    ///         broken).
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (round, price, priceUpdatedAt, priceUpdatedAt, round);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Switch between CRE's mock forwarder (simulation) and the real one (deployed workflow).
    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @notice Accept reports only from workflows owned by `workflowOwner_` (address(0) turns the check off).
    function setWorkflowOwner(address workflowOwner_) external onlyOwner {
        workflowOwner = workflowOwner_;
        emit WorkflowOwnerSet(workflowOwner_);
    }

    function sweep(IERC20 token, address to) external onlyOwner {
        token.safeTransfer(to, token.balanceOf(address(this)));
    }
}
