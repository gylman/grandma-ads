// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EthyAdsOffchainResolver} from "../src/EthyAdsOffchainResolver.sol";
import {VM_ADDRESS, Vm} from "./Vm.sol";

contract DeployEthyAdsOffchainResolver {
    Vm private constant VM = Vm(VM_ADDRESS);

    event EthyAdsOffchainResolverDeployment(address indexed resolver, string gatewayUrl);

    function run() external returns (EthyAdsOffchainResolver resolver) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        string memory gatewayUrl = VM.envString("ENS_CCIP_GATEWAY_URL");

        VM.startBroadcast(deployerPrivateKey);
        resolver = new EthyAdsOffchainResolver(gatewayUrl);
        VM.stopBroadcast();

        emit EthyAdsOffchainResolverDeployment(address(resolver), gatewayUrl);
    }
}
