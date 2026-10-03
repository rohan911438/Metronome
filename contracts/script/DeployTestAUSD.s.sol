// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {TestAUSD} from "../src/mocks/TestAUSD.sol";

/// @notice Deploys TestAUSD on testnet, mints MINT_AMOUNT (default 10M) to the deployer and records it in
///         deployments/<chainId>.json as "testAusd". Then deploy the market on it:
///      forge script script/DeployTestAUSD.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
///      QUOTE_TOKEN=<testAusd> forge script script/Deploy.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
contract DeployTestAUSD is Script {
    function run() external returns (TestAUSD token) {
        require(block.chainid != 143, "testnet only");
        uint256 amount = vm.envOr("MINT_AMOUNT", uint256(10_000_000e6));

        vm.startBroadcast();
        token = new TestAUSD();
        token.mint(msg.sender, amount);
        vm.stopBroadcast();

        console.log("TestAUSD:", address(token));
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return token;

        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        string memory existing = vm.readFile(path);
        string memory obj = "testAusd";
        vm.serializeAddress(obj, "address", address(token));
        string memory entry = vm.serializeUint(obj, "deployBlock", block.number);
        vm.serializeJson("root", existing);
        vm.writeJson(vm.serializeString("root", "testAusd", entry), path);
    }
}
