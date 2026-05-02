// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract EthyAdsOffchainResolver {
    error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData);
    error Unauthorized();

    bytes4 private constant ADDR_SELECTOR = 0x3b3b57de;
    bytes4 private constant ADDR_COIN_SELECTOR = 0xf1cb7e06;
    bytes4 private constant TEXT_SELECTOR = 0x59d1d43c;
    bytes4 private constant RESOLVE_SELECTOR = 0x9061b923;

    string public gatewayUrl;
    address public owner;

    event GatewayUrlUpdated(string gatewayUrl);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    constructor(string memory initialGatewayUrl) {
        owner = msg.sender;
        gatewayUrl = initialGatewayUrl;
        emit GatewayUrlUpdated(initialGatewayUrl);
    }

    function setGatewayUrl(string calldata newGatewayUrl) external onlyOwner {
        gatewayUrl = newGatewayUrl;
        emit GatewayUrlUpdated(newGatewayUrl);
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    function addr(bytes32 node) external view returns (address) {
        bytes memory callData = abi.encodeWithSelector(ADDR_SELECTOR, node);
        revert OffchainLookup(address(this), urls(), callData, EthyAdsOffchainResolver.addrCallback.selector, "");
    }

    function addr(bytes32 node, uint256 coinType) external view returns (bytes memory) {
        bytes memory callData = abi.encodeWithSelector(ADDR_COIN_SELECTOR, node, coinType);
        revert OffchainLookup(address(this), urls(), callData, EthyAdsOffchainResolver.bytesCallback.selector, "");
    }

    function text(bytes32 node, string calldata key) external view returns (string memory) {
        bytes memory callData = abi.encodeWithSelector(TEXT_SELECTOR, node, key);
        revert OffchainLookup(address(this), urls(), callData, EthyAdsOffchainResolver.textCallback.selector, "");
    }

    function resolve(bytes calldata name, bytes calldata data) external view returns (bytes memory) {
        bytes memory callData = abi.encodeWithSelector(RESOLVE_SELECTOR, name, data);
        revert OffchainLookup(address(this), urls(), callData, EthyAdsOffchainResolver.bytesCallback.selector, "");
    }

    function addrCallback(bytes calldata response, bytes calldata) external pure returns (address) {
        return abi.decode(response, (address));
    }

    function textCallback(bytes calldata response, bytes calldata) external pure returns (string memory) {
        return abi.decode(response, (string));
    }

    function bytesCallback(bytes calldata response, bytes calldata) external pure returns (bytes memory) {
        return response;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == 0x01ffc9a7 // ERC165
            || interfaceId == 0x3b3b57de // addr(bytes32)
            || interfaceId == 0xf1cb7e06 // addr(bytes32,uint256)
            || interfaceId == 0x59d1d43c // text(bytes32,string)
            || interfaceId == 0x9061b923; // resolve(bytes,bytes)
    }

    function urls() private view returns (string[] memory result) {
        result = new string[](1);
        result[0] = gatewayUrl;
    }
}
