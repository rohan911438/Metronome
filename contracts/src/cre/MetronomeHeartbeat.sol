// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

import {IMetronome} from "../interfaces/IMetronome.sol";

/// @notice What a Chainlink CRE forwarder calls with a workflow's signed report.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title MetronomeHeartbeat
/// @notice Receiver for the `metronome-heartbeat` CRE workflow. The workflow watches the market and, when a batch is
///         waiting, sends a report holding a batch id; this contract settles every pending batch up to it. `settle` is
///         permissionless, so this adds no power: it lets Chainlink's network run the keeper instead of our server.
///         Settle rewards the market pays land here and the owner can sweep them.
contract MetronomeHeartbeat is IReceiver, Ownable2Step {
    using SafeERC20 for IERC20;

    IMetronome public immutable METRONOME;
    address public forwarder;

    event ForwarderSet(address forwarder);
    event Heartbeat(uint256 indexed batchId);

    error NotForwarder(address sender);

    constructor(IMetronome metronome, address forwarder_, address owner_) Ownable(owner_) {
        METRONOME = metronome;
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    /// @param report abi.encode(uint256 batchId): settle every pending batch <= batchId.
    function onReport(bytes calldata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder(msg.sender);
        uint256 batchId = abi.decode(report, (uint256));
        METRONOME.settle(batchId);
        emit Heartbeat(batchId);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /// @notice Switch between CRE's mock forwarder (simulation) and the real one (deployed workflow).
    function setForwarder(address forwarder_) external onlyOwner {
        forwarder = forwarder_;
        emit ForwarderSet(forwarder_);
    }

    function sweep(IERC20 token, address to) external onlyOwner {
        token.safeTransfer(to, token.balanceOf(address(this)));
    }
}
