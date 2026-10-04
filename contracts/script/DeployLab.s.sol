// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Metronome} from "../src/Metronome.sol";
import {MiniAMM} from "../src/demo/MiniAMM.sol";
import {SandwichLab} from "../src/demo/SandwichLab.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {TestAUSD} from "../src/mocks/TestAUSD.sol";
import {priceMinAt} from "./Deploy.s.sol";

/// @notice The sandwich lab on testnet: a separate Metronome market on open-mint test tokens (tWMON/tAUSD), a MiniAMM
///         seeded at the same price, and SandwichLab. A lab run moves ~200k MON, far more testnet MON than exists for
///         us, so the lab trades test tokens anyone can mint. Same Metronome code and price grid as the real market.
///         Writes deployments/<chainId>.json as "lab".
///
///      TEST_AUSD=0xA89Cdf8C92eC4f84654b44c0768FEC1b594cd091 \
///      forge script script/DeployLab.s.sol --rpc-url monad_testnet --private-key $PRIVATE_KEY --broadcast
contract DeployLab is Script {
    uint256 internal constant REF_PRICE = 0.025e18; // tick 2048, like the testnet market
    uint256 internal constant AMM_BASE = 4_000_000e18;
    uint256 internal constant AMM_QUOTE = 100_000e6;

    function run() external {
        require(block.chainid != 143, "testnet only");

        vm.startBroadcast();
        MockERC20 wmon = new MockERC20("Test WMON", "tWMON", 18);
        address quoteAddr = vm.envOr("TEST_AUSD", address(0));
        TestAUSD ausd = quoteAddr == address(0) ? new TestAUSD() : TestAUSD(quoteAddr);

        uint256 priceMin = priceMinAt(REF_PRICE, 18, 6, 2048);
        Metronome m = new Metronome(IERC20(address(wmon)), IERC20(address(ausd)), priceMin, 1, 1e18, 5, 0, msg.sender);
        MiniAMM amm = new MiniAMM(IERC20(address(wmon)), IERC20(address(ausd)));
        SandwichLab lab = new SandwichLab(m, amm);

        wmon.mint(msg.sender, AMM_BASE);
        ausd.mint(msg.sender, AMM_QUOTE);
        wmon.approve(address(amm), AMM_BASE);
        ausd.approve(address(amm), AMM_QUOTE);
        amm.addLiquidity(AMM_BASE, AMM_QUOTE);
        vm.stopBroadcast();

        console.log("Lab Metronome:", address(m));
        console.log("tWMON:", address(wmon), "tAUSD:", address(ausd));
        console.log("MiniAMM:", address(amm), "SandwichLab:", address(lab));
        console.log("priceMin:", priceMin);
        if (!vm.isContext(VmSafe.ForgeContext.ScriptBroadcast)) return;

        string memory obj = "lab";
        vm.serializeAddress(obj, "metronome", address(m));
        vm.serializeAddress(obj, "base", address(wmon));
        vm.serializeAddress(obj, "quote", address(ausd));
        vm.serializeAddress(obj, "miniAmm", address(amm));
        vm.serializeAddress(obj, "sandwichLab", address(lab));
        vm.serializeBool(obj, "mintable", true);
        string memory json = vm.serializeUint(obj, "deployBlock", block.number);
        string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.serializeJson("root", vm.readFile(path));
        vm.writeJson(vm.serializeString("root", "lab", json), path);
    }
}
