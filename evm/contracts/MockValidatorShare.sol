// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title MockValidatorShare
 * @notice Amoy-deployable mock of Polygon's ValidatorShare contract.
 *
 * @dev Polygon's real StakeManager and ValidatorShare contracts live on
 *      Ethereum L1 (mainnet) or Sepolia (testnet) — NOT on Polygon PoS.
 *      For hackathon purposes we deploy a simplified mock on Amoy that
 *      exposes the same interface and emits the same events, so the
 *      frontend and backend can exercise the REAL buyVoucher/sellVoucher
 *      flow against real on-chain transactions.
 *
 *      Differences from the production contract (documented for honesty):
 *        - No fx/share-price drift (1:1 shares:POL). Production uses a
 *          dynamic exchangeRate based on accumulated rewards.
 *        - Rewards accrue linearly at a fixed APR. Production accrues via
 *          checkpoint distribution from the StakeManager.
 *        - Unbonding period defaults to 60s (not 21 days/80 checkpoints).
 *        - No slashing, no commissions, no signer keys.
 *
 *      Everything else — including event signatures — matches Polygon's
 *      real contract so this is a drop-in swap for the mainnet flow when
 *      the app is productionized on Ethereum.
 */
contract MockValidatorShare {
    // --- State ---

    string public constant name = "MockValidatorShare";
    string public constant symbol = "mVALIDATOR";
    uint8  public constant decimals = 18;

    uint256 public totalStaked;
    uint256 public totalShares;
    uint256 public constant EXCHANGE_RATE_PRECISION = 1e29;  // Polygon's precision
    uint256 public unbondingPeriodSeconds = 60;  // mock: 60s (prod: 21 days)
    uint256 public aprBasisPoints = 800;          // 8% APR

    address public owner;

    struct Delegation {
        uint256 shares;
        uint256 stakedAt;     // For reward accrual
        uint256 claimedRewards;
    }

    struct UnbondInfo {
        uint256 shares;
        uint256 withdrawEpoch; // Unix timestamp when claimable
        uint256 amount;        // POL owed to delegator
    }

    mapping(address => Delegation) public delegations;
    mapping(address => mapping(uint256 => UnbondInfo)) public unbonds;
    mapping(address => uint256) public unbondNonces;

    // --- Events (match Polygon's real ValidatorShare) ---

    event ShareMinted(address indexed user, uint256 amount, uint256 tokens);
    event ShareBurnedWithId(
        address indexed user,
        uint256 amount,
        uint256 tokens,
        uint256 nonce
    );
    event DelegatorUnstaked(address indexed user, uint256 amount, uint256 nonce);
    event DelegatorClaimedRewards(address indexed user, uint256 rewards);

    // --- Errors ---

    error MinAmountUnmet();
    error MaxSharesExceeded();
    error NothingToClaim();
    error UnbondNotReady(uint256 readyAt);
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // --- Core delegation API (matches Polygon interface) ---

    /**
     * @notice Delegates POL to this validator and mints shares.
     * @param _amount Amount of POL (native) sent as msg.value.
     * @param _minSharesToMint Slippage protection.
     */
    function buyVoucher(
        uint256 _amount,
        uint256 _minSharesToMint
    ) external payable returns (uint256 amountStaked) {
        if (msg.value != _amount) revert MinAmountUnmet();
        if (_amount == 0) revert MinAmountUnmet();

        // 1:1 shares for simplicity.
        uint256 shares = _amount;
        if (shares < _minSharesToMint) revert MaxSharesExceeded();

        Delegation storage d = delegations[msg.sender];

        // If delegation is fresh, stake timestamp is now.
        if (d.shares == 0) {
            d.stakedAt = block.timestamp;
        }
        d.shares += shares;

        totalStaked += _amount;
        totalShares += shares;

        emit ShareMinted(msg.sender, _amount, shares);
        return _amount;
    }

    /**
     * @notice Burns shares and starts an unbonding period.
     * @param _claimAmount Amount of POL to unbond.
     * @param _maximumSharesToBurn Slippage protection.
     */
    function sellVoucher_new(
        uint256 _claimAmount,
        uint256 _maximumSharesToBurn
    ) external returns (uint256 nonce) {
        Delegation storage d = delegations[msg.sender];
        if (d.shares == 0) revert NothingToClaim();

        uint256 sharesToBurn = _claimAmount;  // 1:1 for mock
        if (sharesToBurn > _maximumSharesToBurn) revert MaxSharesExceeded();
        if (sharesToBurn > d.shares) revert MaxSharesExceeded();

        d.shares -= sharesToBurn;
        totalShares -= sharesToBurn;
        totalStaked -= _claimAmount;

        unbondNonces[msg.sender] += 1;
        nonce = unbondNonces[msg.sender];

        unbonds[msg.sender][nonce] = UnbondInfo({
            shares: sharesToBurn,
            withdrawEpoch: block.timestamp + unbondingPeriodSeconds,
            amount: _claimAmount
        });

        emit ShareBurnedWithId(msg.sender, _claimAmount, sharesToBurn, nonce);
        emit DelegatorUnstaked(msg.sender, _claimAmount, nonce);
        return nonce;
    }

    /**
     * @notice Claims POL after the unbonding period elapses.
     * @param unbondNonce The nonce returned by sellVoucher_new.
     */
    function unstakeClaimTokens_new(uint256 unbondNonce) external {
        UnbondInfo memory u = unbonds[msg.sender][unbondNonce];
        if (u.amount == 0) revert NothingToClaim();
        if (block.timestamp < u.withdrawEpoch) {
            revert UnbondNotReady(u.withdrawEpoch);
        }

        delete unbonds[msg.sender][unbondNonce];

        (bool ok, ) = msg.sender.call{value: u.amount}("");
        require(ok, "POL transfer failed");
    }

    /**
     * @notice Claims accrued rewards without unbonding principal.
     */
    function withdrawRewards() external {
        Delegation storage d = delegations[msg.sender];
        if (d.shares == 0) revert NothingToClaim();

        uint256 rewards = _pendingRewards(msg.sender);
        if (rewards == 0) revert NothingToClaim();

        d.claimedRewards += rewards;

        // Pay rewards from contract balance (pre-funded by owner).
        (bool ok, ) = msg.sender.call{value: rewards}("");
        require(ok, "Reward transfer failed");

        emit DelegatorClaimedRewards(msg.sender, rewards);
    }

    // --- Views ---

    function balanceOf(address user) external view returns (uint256) {
        return delegations[user].shares;
    }

    function pendingRewards(address user) external view returns (uint256) {
        return _pendingRewards(user);
    }

    function _pendingRewards(address user) internal view returns (uint256) {
        Delegation memory d = delegations[user];
        if (d.shares == 0) return 0;
        uint256 timeElapsed = block.timestamp - d.stakedAt;
        // APR basis points -> reward: shares * apr / 10000 * time / 365 days
        return (d.shares * aprBasisPoints * timeElapsed) / (10000 * 365 days)
               - d.claimedRewards;
    }

    function getUnbondNonce(address user) external view returns (uint256) {
        return unbondNonces[user];
    }

    // --- Admin (for demo tuning) ---

    function setUnbondingPeriod(uint256 secs) external onlyOwner {
        unbondingPeriodSeconds = secs;
    }

    function setAPR(uint256 bps) external onlyOwner {
        aprBasisPoints = bps;
    }

    // Fund the contract for rewards.
    receive() external payable {}
}
