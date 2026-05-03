// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {VM_ADDRESS, Vm} from "./Vm.sol";

interface IERC20Like {
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IUniswapV2FactoryLike {
    function getPair(address tokenA, address tokenB) external view returns (address pair);
}

interface IUniswapV2PairLike {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
}

interface IUniswapV2Router02Like {
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);
}

contract SeedSepoliaUniswapV2StablePool {
    Vm private constant VM = Vm(VM_ADDRESS);

    address private constant DEFAULT_UNISWAP_V2_FACTORY = 0xF62c03E08ada871A0bEb309762E260a7a6a880E6;
    address private constant DEFAULT_UNISWAP_V2_ROUTER = 0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3;

    event UniswapV2StablePoolSeeded(
        address indexed provider,
        address indexed pair,
        address indexed lpRecipient,
        address router,
        address tokenA,
        address tokenB,
        uint256 amountA,
        uint256 amountB,
        uint256 liquidity
    );

    error PairNotCreated();

    struct SeedConfig {
        address provider;
        address tokenA;
        address tokenB;
        address router;
        address factory;
        address lpRecipient;
        uint256 desiredA;
        uint256 desiredB;
    }

    function run() external returns (address pair, uint256 amountA, uint256 amountB, uint256 liquidity) {
        uint256 deployerPrivateKey = VM.envUint("DEPLOYER_PRIVATE_KEY");
        SeedConfig memory config = SeedConfig({
            provider: VM.addr(deployerPrivateKey),
            tokenA: VM.envAddress("USDC_TOKEN_ADDRESS"),
            tokenB: VM.envAddress("USDT_TOKEN_ADDRESS"),
            router: VM.envOr("UNISWAP_V2_ROUTER_ADDRESS", DEFAULT_UNISWAP_V2_ROUTER),
            factory: VM.envOr("UNISWAP_V2_FACTORY_ADDRESS", DEFAULT_UNISWAP_V2_FACTORY),
            lpRecipient: address(0),
            desiredA: VM.envOr("UNISWAP_LIQUIDITY_USDC", 250_000e6),
            desiredB: VM.envOr("UNISWAP_LIQUIDITY_USDT", 250_000e6)
        });
        config.lpRecipient = VM.envOr("UNISWAP_LP_RECIPIENT", config.provider);

        pair = IUniswapV2FactoryLike(config.factory).getPair(config.tokenA, config.tokenB);
        if (pair != address(0)) {
            (config.desiredA, config.desiredB) =
                _matchExistingPoolRatio(pair, config.tokenA, config.desiredA, config.desiredB);
        }

        uint256 minA = (config.desiredA * 995) / 1000;
        uint256 minB = (config.desiredB * 995) / 1000;
        uint256 deadline = block.timestamp + 30 minutes;

        VM.startBroadcast(deployerPrivateKey);
        IERC20Like(config.tokenA).approve(config.router, config.desiredA);
        IERC20Like(config.tokenB).approve(config.router, config.desiredB);

        (amountA, amountB, liquidity) = IUniswapV2Router02Like(config.router)
            .addLiquidity(
                config.tokenA, config.tokenB, config.desiredA, config.desiredB, minA, minB, config.lpRecipient, deadline
            );
        VM.stopBroadcast();

        pair = IUniswapV2FactoryLike(config.factory).getPair(config.tokenA, config.tokenB);
        if (pair == address(0)) revert PairNotCreated();

        emit UniswapV2StablePoolSeeded(
            config.provider,
            pair,
            config.lpRecipient,
            config.router,
            config.tokenA,
            config.tokenB,
            amountA,
            amountB,
            liquidity
        );
    }

    function _matchExistingPoolRatio(address pair, address tokenA, uint256 desiredA, uint256 desiredB)
        private
        view
        returns (uint256 adjustedA, uint256 adjustedB)
    {
        IUniswapV2PairLike existingPair = IUniswapV2PairLike(pair);
        (uint112 reserve0, uint112 reserve1,) = existingPair.getReserves();
        if (reserve0 == 0 || reserve1 == 0) {
            return (desiredA, desiredB);
        }

        (uint256 reserveA, uint256 reserveB) =
            existingPair.token0() == tokenA ? (reserve0, reserve1) : (reserve1, reserve0);

        uint256 optimalB = (desiredA * reserveB) / reserveA;
        if (optimalB <= desiredB) {
            return (desiredA, optimalB);
        }

        uint256 optimalA = (desiredB * reserveA) / reserveB;
        return (optimalA, desiredB);
    }
}
