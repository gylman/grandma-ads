// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "../src/MockUSDC.sol";
import {MockUSDT} from "../src/MockUSDT.sol";
import {VM_ADDRESS, Vm} from "./Vm.sol";

contract DeploySepoliaMockStables {
    Vm private constant VM = Vm(VM_ADDRESS);

    event SepoliaMockStablesDeployed(
        address indexed deployer,
        address indexed liquidityRecipient,
        address mockUsdc,
        address mockUsdt,
        uint256 usdcMint,
        uint256 usdtMint
    );

    function run() external returns (MockUSDC mockUsdc, MockUSDT mockUsdt) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(deployerPrivateKey);
        address liquidityRecipient = VM.envOr("INITIAL_STABLE_LIQUIDITY_RECIPIENT", deployer);
        uint256 initialUsdcMint = VM.envOr("INITIAL_USDC_MINT", 2_500_000e6);
        uint256 initialUsdtMint = VM.envOr("INITIAL_USDT_MINT", 2_500_000e6);

        VM.startBroadcast(deployerPrivateKey);
        mockUsdc = new MockUSDC();
        mockUsdt = new MockUSDT();

        mockUsdc.mint(liquidityRecipient, initialUsdcMint);
        mockUsdt.mint(liquidityRecipient, initialUsdtMint);
        VM.stopBroadcast();

        emit SepoliaMockStablesDeployed(
            deployer, liquidityRecipient, address(mockUsdc), address(mockUsdt), initialUsdcMint, initialUsdtMint
        );
    }
}
