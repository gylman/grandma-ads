// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdEscrow} from "../src/AdEscrow.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {VM_ADDRESS, Vm} from "./Vm.sol";

contract DeployLocal {
    Vm private constant VM = Vm(VM_ADDRESS);

    event LocalDeployment(
        address indexed escrow, address indexed mockUsdc, address indexed verifier, address initialRecipient
    );

    function run() external returns (AdEscrow escrow, MockUSDC mockUsdc) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = VM.addr(deployerPrivateKey);
        address verifier = VM.envOr("VERIFIER_ADDRESS", deployer);
        address initialRecipient = VM.envOr("INITIAL_USDC_RECIPIENT", deployer);
        uint256 initialMint = VM.envOr("INITIAL_USDC_MINT", 1_000_000e6);

        VM.startBroadcast(deployerPrivateKey);
        mockUsdc = new MockUSDC();
        escrow = new AdEscrow(verifier);
        mockUsdc.mint(initialRecipient, initialMint);
        VM.stopBroadcast();

        emit LocalDeployment(address(escrow), address(mockUsdc), verifier, initialRecipient);
    }
}
