// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {MetronomeTestBase} from "./Metronome.t.sol";

/// @notice Gas numbers for the README. Run with: forge test --match-contract Gas -vv
contract GasTest is MetronomeTestBase {
    function test_gas_placeOrder() public {
        _buy(alice, T, 1e18); // warm up alice's nonce slot and the token balances
        _next();
        vm.prank(alice);
        uint256 g = gasleft();
        m.placeOrder(true, T, 1e18);
        console.log("placeOrder (new tick in batch):     ", g - gasleft());

        vm.prank(bob);
        g = gasleft();
        m.placeOrder(true, T, 1e18);
        console.log("placeOrder (tick already active):   ", g - gasleft());
    }

    function test_gas_claim() public {
        bytes32 id = _buy(alice, T, 1e18);
        _sell(bob, T, 1e18);
        _next();
        m.settle(block.number - 1);
        uint256 g = gasleft();
        m.claim(id);
        console.log("claim (filled buy):                 ", g - gasleft());
    }

    function test_gas_settleScaling() public {
        uint256[5] memory counts = [uint256(1), 10, 50, 100, 400];
        for (uint256 c; c < counts.length; ++c) {
            uint256 b = block.number;
            for (uint256 i; i < counts[c]; ++i) {
                // Alternate buyers and sellers across distinct ticks so every order adds an active tick.
                address u = i % 2 == 0 ? alice : bob;
                vm.prank(u);
                m.placeOrder(i % 2 == 0, uint16(T - 200 + i), 1e18);
            }
            _next();
            uint256 g = gasleft();
            m.settle(b);
            console.log("settle, active ticks:", counts[c], "gas:", g - gasleft());
        }
    }

    function test_gas_settleIndependentOfOrderCount() public {
        // 200 orders on only 2 ticks: settle cost tracks ticks, not orders.
        uint256 b = block.number;
        for (uint256 i; i < 100; ++i) {
            _buy(alice, T, 1e18);
            _sell(bob, T - 1, 1e18);
        }
        _next();
        uint256 g = gasleft();
        m.settle(b);
        console.log("settle, 200 orders on 2 ticks:      ", g - gasleft());
    }
}
