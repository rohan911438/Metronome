// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {IMetronome} from "../src/interfaces/IMetronome.sol";
import {MetronomeHeartbeat} from "../src/cre/MetronomeHeartbeat.sol";

/// @notice Deploys the CRE receiver for the market in deployments/<chainId>.json and records it there as "heartbeat".
/// @dev Config via env:
///      CRE_FORWARDER   default on testnet: CRE's mock forwarder, which `cre workflow simulate --broadcast` uses.
///                      Switch to the real forwarder with setForwarder once the workflow is deployed.
///      OWNER           default: the deployer
///
///      forge script script/DeployHeartbeat.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
contract DeployHeartbeat is Script {
    address internal constant TESTNET_MOCK_FORWARDER = 0xB9F79d863261869B234c481D1f9A7af84AeAd192;

    function run() external returns (MetronomeHeartbeat hb) {
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory existing = vm.readFile(path);
        address metronome = vm.parseJsonAddress(existing, ".metronome.address");
        address forwarder = block.chainid == 10_143
            ? vm.envOr("CRE_FORWARDER", TESTNET_MOCK_FORWARDER)
            : vm.envAddress("CRE_FORWARDER");

        vm.startBroadcast();
        address owner = vm.envOr("OWNER", msg.sender);
        hb = new MetronomeHeartbeat(IMetronome(metronome), forwarder, owner);
        vm.stopBroadcast();

        console.log("MetronomeHeartbeat:", address(hb));
        console.log("forwarder:", forwarder);
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return hb;

        string memory obj = "heartbeat";
        vm.serializeAddress(obj, "address", address(hb));
        vm.serializeAddress(obj, "metronome", metronome);
        vm.serializeAddress(obj, "forwarder", forwarder);
        vm.serializeAddress(obj, "owner", owner);
        string memory entry = vm.serializeUint(obj, "deployBlock", block.number);

        vm.serializeJson("root", existing);
        vm.writeJson(vm.serializeString("root", "heartbeat", entry), path);
    }
}
