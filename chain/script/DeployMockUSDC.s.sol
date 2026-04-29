// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockUSDC} from "../src/MockUSDC.sol";
import {VM_ADDRESS, Vm} from "./Vm.sol";

contract DeployMockUSDC {
    Vm private constant VM = Vm(VM_ADDRESS);

    event MockUSDCDeployment(address indexed mockUsdc, address indexed initialRecipient, uint256 initialMint);

    function run() external returns (MockUSDC mockUsdc) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(deployerPrivateKey);
        address initialRecipient = VM.envOr("INITIAL_USDC_RECIPIENT", deployer);
        uint256 initialMint = VM.envOr("INITIAL_USDC_MINT", 1_000_000e6);

        VM.startBroadcast(deployerPrivateKey);
        mockUsdc = new MockUSDC();
        mockUsdc.mint(initialRecipient, initialMint);
        VM.stopBroadcast();

        emit MockUSDCDeployment(address(mockUsdc), initialRecipient, initialMint);
    }
}
