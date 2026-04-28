// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

library SafeERC20 {
    error SafeERC20CallFailed();

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        _call(token, abi.encodeCall(IERC20.transferFrom, (from, to, amount)));
    }

    function _call(IERC20 token, bytes memory data) private {
        (bool success, bytes memory result) = address(token).call(data);
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert SafeERC20CallFailed();
        }
    }
}

contract AdEscrow {
    using SafeERC20 for IERC20;

    enum CampaignStatus {
        None,
        Funded,
        Active,
        Completed,
        Refunded,
        Cancelled
    }

    struct Campaign {
        address advertiser;
        address poster;
        address token;
        uint256 amount;
        uint256 durationSeconds;
        uint256 startedAt;
        CampaignStatus status;
    }

    error ZeroAddress();
    error ZeroAmount();
    error ZeroDuration();
    error InsufficientBalance();
    error Unauthorized();
    error InvalidCampaignStatus(CampaignStatus current);
    error Reentrancy();

    mapping(address user => mapping(address token => uint256 amount)) public balances;
    mapping(uint256 campaignId => Campaign campaign) public campaigns;

    uint256 public nextCampaignId = 1;
    address public owner;
    address public verifier;

    uint256 private locked = 1;

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event CampaignCreated(
        uint256 indexed campaignId,
        address indexed advertiser,
        address indexed poster,
        address token,
        uint256 amount,
        uint256 durationSeconds
    );
    event CampaignStarted(uint256 indexed campaignId, uint256 startedAt);
    event CampaignCompleted(uint256 indexed campaignId);
    event CampaignRefunded(uint256 indexed campaignId);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier);

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    modifier onlyVerifier() {
        _onlyVerifier();
        _;
    }

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    constructor(address initialVerifier) {
        if (initialVerifier == address(0)) revert ZeroAddress();

        owner = msg.sender;
        verifier = initialVerifier;
        emit VerifierUpdated(address(0), initialVerifier);
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    function _onlyVerifier() internal view {
        if (msg.sender != verifier) revert Unauthorized();
    }

    function _nonReentrantBefore() internal {
        if (locked != 1) revert Reentrancy();
        locked = 2;
    }

    function _nonReentrantAfter() internal {
        locked = 1;
    }

    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert ZeroAddress();

        address oldVerifier = verifier;
        verifier = newVerifier;
        emit VerifierUpdated(oldVerifier, newVerifier);
    }

    function deposit(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        balances[msg.sender][token] += amount;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(msg.sender, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 currentBalance = balances[msg.sender][token];
        if (currentBalance < amount) revert InsufficientBalance();

        balances[msg.sender][token] = currentBalance - amount;
        IERC20(token).safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, token, amount);
    }

    function createCampaignFromBalance(address poster, address token, uint256 amount, uint256 durationSeconds)
        external
        returns (uint256 campaignId)
    {
        if (poster == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (durationSeconds == 0) revert ZeroDuration();

        uint256 currentBalance = balances[msg.sender][token];
        if (currentBalance < amount) revert InsufficientBalance();

        balances[msg.sender][token] = currentBalance - amount;

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            advertiser: msg.sender,
            poster: poster,
            token: token,
            amount: amount,
            durationSeconds: durationSeconds,
            startedAt: 0,
            status: CampaignStatus.Funded
        });

        emit CampaignCreated(campaignId, msg.sender, poster, token, amount, durationSeconds);
    }

    function startCampaign(uint256 campaignId) external onlyVerifier {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Funded) revert InvalidCampaignStatus(campaign.status);

        campaign.status = CampaignStatus.Active;
        campaign.startedAt = block.timestamp;

        emit CampaignStarted(campaignId, block.timestamp);
    }

    function completeCampaign(uint256 campaignId) external onlyVerifier {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Active) revert InvalidCampaignStatus(campaign.status);

        campaign.status = CampaignStatus.Completed;
        balances[campaign.poster][campaign.token] += campaign.amount;

        emit CampaignCompleted(campaignId);
    }

    function refundCampaign(uint256 campaignId) external onlyVerifier {
        Campaign storage campaign = campaigns[campaignId];
        if (campaign.status != CampaignStatus.Funded && campaign.status != CampaignStatus.Active) {
            revert InvalidCampaignStatus(campaign.status);
        }

        campaign.status = CampaignStatus.Refunded;
        balances[campaign.advertiser][campaign.token] += campaign.amount;

        emit CampaignRefunded(campaignId);
    }
}
