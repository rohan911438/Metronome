// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Metronome} from "../src/Metronome.sol";
import {MiniAMM} from "../src/demo/MiniAMM.sol";
import {SandwichLab} from "../src/demo/SandwichLab.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {priceMinAt} from "./Deploy.s.sol";

/// @notice Full local stack on Anvil: mock WMON/AUSD, Metronome, MiniAMM (seeded at the same price) and SandwichLab.
///         Funds Anvil's first 6 accounts and writes deployments/31337.json.
///
///      anvil --block-time 1
///      forge script script/DeployLocal.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
///        --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DeployLocal is Script {
    uint256 internal constant REF_PRICE = 0.025e18; // 0.025 AUSD per MON, like testnet

    function run() external {
        require(block.chainid == 31_337, "local only");
        uint256 shards = vm.envOr("SHARDS", uint256(4));

        vm.startBroadcast();
        MockERC20 wmon = new MockERC20("Wrapped MON", "WMON", 18);
        MockERC20 ausd = new MockERC20("AUSD", "AUSD", 6);
        uint256 priceMin = priceMinAt(REF_PRICE, 18, 6, 2048);
        Metronome m =
            new Metronome(IERC20(address(wmon)), IERC20(address(ausd)), priceMin, shards, 1e18, 5, 0, msg.sender);
        MiniAMM amm = new MiniAMM(IERC20(address(wmon)), IERC20(address(ausd)));
        SandwichLab lab = new SandwichLab(m, amm);

        // AMM at the same reference price: 4M MON against 100k AUSD.
        wmon.mint(msg.sender, 4_000_000e18);
        ausd.mint(msg.sender, 100_000e6);
        wmon.approve(address(amm), type(uint256).max);
        ausd.approve(address(amm), type(uint256).max);
        amm.addLiquidity(4_000_000e18, 100_000e6);

        // Anvil accounts 0-5: 10M MON and 1M AUSD each.
        for (uint256 i; i < 6; ++i) {
            address a = vm.addr(vm.deriveKey("test test test test test test test test test test test junk", uint32(i)));
            wmon.mint(a, 10_000_000e18);
            ausd.mint(a, 1_000_000e6);
        }
        vm.stopBroadcast();

        console.log("Metronome:", address(m));
        console.log("WMON:", address(wmon), "AUSD:", address(ausd));
        console.log("MiniAMM:", address(amm), "SandwichLab:", address(lab));

        string memory obj = "metronome";
        vm.serializeAddress(obj, "address", address(m));
        vm.serializeAddress(obj, "base", address(wmon));
        vm.serializeAddress(obj, "quote", address(ausd));
        vm.serializeAddress(obj, "owner", msg.sender);
        vm.serializeAddress(obj, "miniAmm", address(amm));
        vm.serializeAddress(obj, "sandwichLab", address(lab));
        vm.serializeUint(obj, "priceMin", priceMin);
        vm.serializeUint(obj, "shards", shards);
        vm.serializeUint(obj, "minOrderSize", 1e18);
        string memory json = vm.serializeUint(obj, "deployBlock", block.number);
        string memory path = string.concat(vm.projectRoot(), "/deployments/31337.json");
        vm.writeJson("{}", path);
        vm.writeJson(json, path, ".metronome");
    }
}
