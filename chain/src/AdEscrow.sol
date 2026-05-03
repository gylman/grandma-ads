// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IERC20Permit {
    function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)
        external;
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

    string public constant NAME = "AdEscrow";
    string public constant VERSION = "1";

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant CREATE_CAMPAIGN_TYPEHASH = keccak256(
        "CreateCampaignAuthorization(address advertiser,address poster,address token,uint256 amount,uint256 durationSeconds,uint256 nonce,uint256 deadline)"
    );
    bytes32 private constant WITHDRAW_TYPEHASH =
        keccak256("WithdrawAuthorization(address user,address token,uint256 amount,address recipient,uint256 nonce,uint256 deadline)");
    uint256 private constant SECP256K1N_DIV_2 =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;

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
    error InvalidSignature();
    error SignatureExpired();

    mapping(address user => mapping(address token => uint256 amount)) public balances;
    mapping(address user => uint256 nonce) public nonces;
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

    function depositWithPermit(address tokenOwner, address token, uint256 amount, uint256 deadline, bytes calldata signature)
        external
        nonReentrant
    {
        if (tokenOwner == address(0) || token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert SignatureExpired();
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        IERC20Permit(token).permit(tokenOwner, address(this), amount, deadline, v, r, s);
        IERC20(token).safeTransferFrom(tokenOwner, address(this), amount);
        balances[tokenOwner][token] += amount;

        emit Deposited(tokenOwner, token, amount);
    }

    function withdraw(address token, uint256 amount) external nonReentrant {
        if (token == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        _withdraw(msg.sender, token, amount, msg.sender);

        emit Withdrawn(msg.sender, token, amount);
    }

    function withdrawBySig(
        address user,
        address token,
        uint256 amount,
        address recipient,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        if (user == address(0) || token == address(0) || recipient == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert SignatureExpired();

        uint256 nonce = nonces[user];
        bytes32 structHash =
            keccak256(abi.encode(WITHDRAW_TYPEHASH, user, token, amount, recipient, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparatorV4(), structHash));
        if (_recoverSigner(digest, signature) != user) revert InvalidSignature();

        nonces[user] = nonce + 1;
        _withdraw(user, token, amount, recipient);

        emit Withdrawn(user, token, amount);
    }

    function createCampaignFromBalance(address poster, address token, uint256 amount, uint256 durationSeconds)
        external
        returns (uint256 campaignId)
    {
        campaignId = _createCampaignFromBalance(msg.sender, poster, token, amount, durationSeconds);
    }

    function createCampaignFromBalanceBySig(
        address advertiser,
        address poster,
        address token,
        uint256 amount,
        uint256 durationSeconds,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 campaignId) {
        if (block.timestamp > deadline) revert SignatureExpired();

        uint256 nonce = nonces[advertiser];
        bytes32 structHash = keccak256(
            abi.encode(
                CREATE_CAMPAIGN_TYPEHASH,
                advertiser,
                poster,
                token,
                amount,
                durationSeconds,
                nonce,
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparatorV4(), structHash));
        if (_recoverSigner(digest, signature) != advertiser) revert InvalidSignature();

        nonces[advertiser] = nonce + 1;
        campaignId = _createCampaignFromBalance(advertiser, poster, token, amount, durationSeconds);
    }

    function domainSeparatorV4() public view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(NAME)),
                keccak256(bytes(VERSION)),
                block.chainid,
                address(this)
            )
        );
    }

    function _createCampaignFromBalance(address advertiser, address poster, address token, uint256 amount, uint256 durationSeconds)
        private
        returns (uint256 campaignId)
    {
        if (poster == address(0) || token == address(0) || advertiser == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (durationSeconds == 0) revert ZeroDuration();

        uint256 currentBalance = balances[advertiser][token];
        if (currentBalance < amount) revert InsufficientBalance();

        balances[advertiser][token] = currentBalance - amount;

        campaignId = nextCampaignId++;
        campaigns[campaignId] = Campaign({
            advertiser: advertiser,
            poster: poster,
            token: token,
            amount: amount,
            durationSeconds: durationSeconds,
            startedAt: 0,
            status: CampaignStatus.Funded
        });

        emit CampaignCreated(campaignId, advertiser, poster, token, amount, durationSeconds);
    }

    function _withdraw(address user, address token, uint256 amount, address recipient) private {
        uint256 currentBalance = balances[user][token];
        if (currentBalance < amount) revert InsufficientBalance();

        balances[user][token] = currentBalance - amount;
        IERC20(token).safeTransfer(recipient, amount);
    }

    function _recoverSigner(bytes32 digest, bytes calldata signature) private pure returns (address signer) {
        if (signature.length != 65) revert InvalidSignature();

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }

        if (uint256(s) > SECP256K1N_DIV_2) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();

        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
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
