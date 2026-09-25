// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {MetronomeTestBase} from "./Metronome.t.sol";
import {MiniAMM} from "../src/demo/MiniAMM.sol";
import {SandwichLab} from "../src/demo/SandwichLab.sol";

contract SandwichLabTest is MetronomeTestBase {
    MiniAMM internal amm;
    SandwichLab internal lab;

    function setUp() public override {
        super.setUp();
        amm = new MiniAMM(IERC20(address(wmon)), IERC20(address(ausd)));
        lab = new SandwichLab(m, amm);
        // Pool at 1.00 AUSD per MON, matching tick T.
        wmon.mint(address(this), 1_000_000e18);
        ausd.mint(address(this), 1_000_000e6);
        wmon.approve(address(amm), type(uint256).max);
        ausd.approve(address(amm), type(uint256).max);
        amm.addLiquidity(1_000_000e18, 1_000_000e6);
        vm.startPrank(alice);
        wmon.approve(address(lab), type(uint256).max);
        ausd.approve(address(lab), type(uint256).max);
        vm.stopPrank();
    }

    function test_victimLosesOnAmmButNotOnMetronome() public {
        uint256 base0 = wmon.balanceOf(alice);
        uint256 quote0 = ausd.balanceOf(alice);

        vm.recordLogs();
        vm.prank(alice);
        uint256 runId = lab.run(20_000e18, 20_000e18, T);
        (uint256 ammClean, uint256 ammAttacked, int256 ammPnl) = _ammEvent();

        _next();
        vm.prank(alice);
        lab.finish(runId);
        (uint256 mClean, uint256 mAttacked, int256 mPnl, int256 baseDelta, uint16 tick) = _metronomeEvent();

        // AMM: the victim overpays and the attacker profits.
        assertGt(ammAttacked, ammClean, "AMM victim should overpay");
        assertGt(ammPnl, 0, "AMM attacker should profit");
        // Metronome: the victim pays exactly the clean price; the attacker only pays fees.
        assertEq(tick, T, "clearing price moved");
        assertEq(mAttacked, mClean, "Metronome victim overpaid");
        assertLe(mPnl, 0, "Metronome attacker profited");
        assertEq(baseDelta, 0, "attacker base not flat");

        emit log_named_decimal_uint("AMM victim loss (bps)", (ammAttacked - ammClean) * 10_000 / ammClean, 0);
        emit log_named_decimal_int("AMM attacker profit (AUSD)", ammPnl, 6);
        emit log_named_decimal_int("Metronome attacker profit (AUSD)", mPnl, 6);

        // Lab keeps nothing; the caller got everything back except what the AMM sandwich and fees cost.
        assertEq(wmon.balanceOf(address(lab)), 0);
        assertEq(ausd.balanceOf(address(lab)), 0);
        assertEq(
            wmon.balanceOf(alice),
            base0 + 20_000e18,
            "caller nets the AMM victim's base (Metronome maker sells what its victim buys)"
        );
        assertLt(ausd.balanceOf(alice), quote0);
    }

    function test_onlyCallerCanFinishOnce() public {
        vm.prank(alice);
        uint256 runId = lab.run(10e18, 100e18, T);
        _next();
        vm.expectRevert(abi.encodeWithSelector(SandwichLab.NotCaller.selector, runId));
        lab.finish(runId);
        vm.prank(alice);
        lab.finish(runId);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(SandwichLab.AlreadyFinished.selector, runId));
        lab.finish(runId);
    }

    function _ammEvent() internal returns (uint256 clean, uint256 attacked, int256 pnl) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == SandwichLab.AmmSandwich.selector) {
                return abi.decode(logs[i].data, (uint256, uint256, int256));
            }
        }
        revert("no AmmSandwich event");
    }

    function _metronomeEvent()
        internal
        returns (uint256 clean, uint256 attacked, int256 pnl, int256 baseDelta, uint16 tick)
    {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] == SandwichLab.MetronomeSandwich.selector) {
                return abi.decode(logs[i].data, (uint256, uint256, int256, int256, uint16));
            }
        }
        revert("no MetronomeSandwich event");
    }
}
