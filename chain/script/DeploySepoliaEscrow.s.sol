// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdEscrow} from "../src/AdEscrow.sol";
import {VM_ADDRESS, Vm} from "./Vm.sol";

contract DeploySepoliaEscrow {
    Vm private constant VM = Vm(VM_ADDRESS);

    event SepoliaEscrowDeployment(address indexed escrow, address indexed verifier);

    function run() external returns (AdEscrow escrow) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        address verifier = VM.envAddress("VERIFIER_ADDRESS");

        VM.startBroadcast(deployerPrivateKey);
        escrow = new AdEscrow(verifier);
        VM.stopBroadcast();

        emit SepoliaEscrowDeployment(address(escrow), verifier);
    }
}
