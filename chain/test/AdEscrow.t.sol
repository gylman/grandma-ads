// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdEscrow} from "../src/AdEscrow.sol";

contract MockERC20 {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public decimals = 6;

    mapping(address account => uint256 amount) public balanceOf;
    mapping(address owner => mapping(address spender => uint256 amount)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        uint256 senderBalance = balanceOf[msg.sender];
        require(senderBalance >= amount, "ERC20: insufficient balance");

        balanceOf[msg.sender] = senderBalance - amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 currentAllowance = allowance[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: insufficient allowance");

        allowance[from][msg.sender] = currentAllowance - amount;

        uint256 fromBalance = balanceOf[from];
        require(fromBalance >= amount, "ERC20: insufficient balance");

        balanceOf[from] = fromBalance - amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract Actor {
    function approve(MockERC20 token, address spender, uint256 amount) external {
        token.approve(spender, amount);
    }

    function deposit(AdEscrow escrow, address token, uint256 amount) external {
        escrow.deposit(token, amount);
    }

    function withdraw(AdEscrow escrow, address token, uint256 amount) external {
        escrow.withdraw(token, amount);
    }

    function createCampaignFromBalance(
        AdEscrow escrow,
        address poster,
        address token,
        uint256 amount,
        uint256 durationSeconds
    ) external returns (uint256) {
        return escrow.createCampaignFromBalance(poster, token, amount, durationSeconds);
    }

    function startCampaign(AdEscrow escrow, uint256 campaignId) external {
        escrow.startCampaign(campaignId);
    }

    function completeCampaign(AdEscrow escrow, uint256 campaignId) external {
        escrow.completeCampaign(campaignId);
    }

    function refundCampaign(AdEscrow escrow, uint256 campaignId) external {
        escrow.refundCampaign(campaignId);
    }
}

contract AdEscrowTest {
    uint256 private constant DEPOSIT = 1_000e6;
    uint256 private constant CAMPAIGN_AMOUNT = 250e6;
    uint256 private constant DURATION = 1 days;

    MockERC20 private token;
    AdEscrow private escrow;
    Actor private advertiser;
    Actor private poster;
    Actor private outsider;

    function setUp() public {
        token = new MockERC20();
        escrow = new AdEscrow(address(this));
        advertiser = new Actor();
        poster = new Actor();
        outsider = new Actor();
    }

    function testDeposit() public {
        _depositForAdvertiser(DEPOSIT);

        _assertEq(escrow.balances(address(advertiser), address(token)), DEPOSIT, "advertiser balance");
        _assertEq(token.balanceOf(address(escrow)), DEPOSIT, "escrow token balance");
    }

    function testWithdraw() public {
        _depositForAdvertiser(DEPOSIT);

        advertiser.withdraw(escrow, address(token), 400e6);

        _assertEq(escrow.balances(address(advertiser), address(token)), 600e6, "advertiser balance");
        _assertEq(token.balanceOf(address(advertiser)), 400e6, "advertiser token balance");
    }

    function testCannotWithdrawMoreThanBalance() public {
        _depositForAdvertiser(100e6);

        try advertiser.withdraw(escrow, address(token), 101e6) {
            revert("expected withdraw to fail");
        } catch {}
    }

    function testCreateCampaignFromBalance() public {
        _depositForAdvertiser(DEPOSIT);

        uint256 campaignId =
            advertiser.createCampaignFromBalance(escrow, address(poster), address(token), CAMPAIGN_AMOUNT, DURATION);

        (
            address campaignAdvertiser,
            address campaignPoster,
            address campaignToken,
            uint256 amount,
            uint256 durationSeconds,
            uint256 startedAt,
            AdEscrow.CampaignStatus status
        ) = escrow.campaigns(campaignId);

        _assertEq(campaignId, 1, "campaign id");
        _assertEq(campaignAdvertiser, address(advertiser), "campaign advertiser");
        _assertEq(campaignPoster, address(poster), "campaign poster");
        _assertEq(campaignToken, address(token), "campaign token");
        _assertEq(amount, CAMPAIGN_AMOUNT, "campaign amount");
        _assertEq(durationSeconds, DURATION, "campaign duration");
        _assertEq(startedAt, 0, "campaign startedAt");
        _assertStatus(status, AdEscrow.CampaignStatus.Funded, "campaign status");
        _assertEq(escrow.balances(address(advertiser), address(token)), DEPOSIT - CAMPAIGN_AMOUNT, "advertiser balance");
    }

    function testCannotCreateCampaignWithoutEnoughBalance() public {
        _depositForAdvertiser(100e6);

        try advertiser.createCampaignFromBalance(escrow, address(poster), address(token), 101e6, DURATION) {
            revert("expected create campaign to fail");
        } catch {}
    }

    function testLockedCampaignFundsAreNotWithdrawableByAdvertiser() public {
        _depositForAdvertiser(CAMPAIGN_AMOUNT);
        advertiser.createCampaignFromBalance(escrow, address(poster), address(token), CAMPAIGN_AMOUNT, DURATION);

        try advertiser.withdraw(escrow, address(token), 1) {
            revert("expected locked funds to be unavailable");
        } catch {}
    }

    function testOnlyVerifierCanStartCampaign() public {
        uint256 campaignId = _createFundedCampaign();

        try outsider.startCampaign(escrow, campaignId) {
            revert("expected non-verifier start to fail");
        } catch {}

        escrow.startCampaign(campaignId);

        (,,,,, uint256 startedAt, AdEscrow.CampaignStatus status) = escrow.campaigns(campaignId);
        _assertTrue(startedAt > 0, "startedAt");
        _assertStatus(status, AdEscrow.CampaignStatus.Active, "campaign status");
    }

    function testOnlyVerifierCanCompleteCampaign() public {
        uint256 campaignId = _createFundedCampaign();
        escrow.startCampaign(campaignId);

        try outsider.completeCampaign(escrow, campaignId) {
            revert("expected non-verifier complete to fail");
        } catch {}

        escrow.completeCampaign(campaignId);

        (,,,,,, AdEscrow.CampaignStatus status) = escrow.campaigns(campaignId);
        _assertStatus(status, AdEscrow.CampaignStatus.Completed, "campaign status");
    }

    function testCompleteCampaignCreditsPosterBalance() public {
        uint256 campaignId = _createFundedCampaign();
        escrow.startCampaign(campaignId);

        escrow.completeCampaign(campaignId);

        _assertEq(escrow.balances(address(poster), address(token)), CAMPAIGN_AMOUNT, "poster balance");
    }

    function testRefundCampaignCreditsAdvertiserBalance() public {
        uint256 campaignId = _createFundedCampaign();

        escrow.refundCampaign(campaignId);

        _assertEq(escrow.balances(address(advertiser), address(token)), DEPOSIT, "advertiser balance");
    }

    function testCannotCompleteRefundedCampaign() public {
        uint256 campaignId = _createFundedCampaign();
        escrow.refundCampaign(campaignId);

        try escrow.completeCampaign(campaignId) {
            revert("expected complete refunded campaign to fail");
        } catch {}
    }

    function testCannotRefundCompletedCampaign() public {
        uint256 campaignId = _createFundedCampaign();
        escrow.startCampaign(campaignId);
        escrow.completeCampaign(campaignId);

        try escrow.refundCampaign(campaignId) {
            revert("expected refund completed campaign to fail");
        } catch {}
    }

    function _createFundedCampaign() private returns (uint256) {
        _depositForAdvertiser(DEPOSIT);
        return advertiser.createCampaignFromBalance(escrow, address(poster), address(token), CAMPAIGN_AMOUNT, DURATION);
    }

    function _depositForAdvertiser(uint256 amount) private {
        token.mint(address(advertiser), amount);
        advertiser.approve(token, address(escrow), amount);
        advertiser.deposit(escrow, address(token), amount);
    }

    function _assertEq(uint256 actual, uint256 expected, string memory label) private pure {
        require(actual == expected, label);
    }

    function _assertEq(address actual, address expected, string memory label) private pure {
        require(actual == expected, label);
    }

    function _assertTrue(bool value, string memory label) private pure {
        require(value, label);
    }

    function _assertStatus(AdEscrow.CampaignStatus actual, AdEscrow.CampaignStatus expected, string memory label)
        private
        pure
    {
        require(actual == expected, label);
    }
}
