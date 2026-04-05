// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IWeb3QLWritable {
    function write(bytes32 key, bytes calldata ciphertext, bytes calldata encryptedKey) external;
}

interface IWeb3QLCounterTarget {
    function increment(bytes32 targetKey, bytes32 field, uint256 amount) external;
}

interface IWeb3QLRecordOwner {
    function recordOwner(bytes32 key) external view returns (address);
}

interface IERC20Transfer {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title  Web3QLRelationWire
 * @notice Thin connector between a source table and a target table's counter fields.
 *
 *         When a user calls relatedWrite(), the wire atomically:
 *           1. Validates the token is allowed and amount is within min/max bounds
 *           2. Accepts payment — native CELO or any whitelisted ERC-20 token
 *           3. Writes a new record to the source table
 *           4. Increments one or more COUNTER fields on the target table
 *           5. Credits net payment to the target record's per-token balance
 *
 *         Per-project balances:
 *           Funds accumulate in projectBalance[targetKey][token].
 *           Only the record owner on the TARGET table can withdraw their balance.
 *           Ownership is verified directly on-chain via targetTable.recordOwner().
 *
 *         Payment rules (configurable by wire owner post-deploy):
 *           - allowedTokens list  — add/remove accepted tokens
 *           - minAmount / maxAmount per token  (0 = no limit)
 *           - feeBps / feeRecipient  — platform cut before crediting project
 *           - oncePerAddress  — restrict per-wallet per-project votes
 *
 * @dev    Deploy via `new Web3QLRelationWire(...)`, then call
 *         `targetTable.registerWire(wireAddr, fields)` (table owner only).
 */
contract Web3QLRelationWire {

    // ─────────────────────────────────────────────────────────────
    //  Immutable wiring
    // ─────────────────────────────────────────────────────────────

    IWeb3QLWritable      public immutable sourceTable;
    IWeb3QLCounterTarget public immutable targetTable;

    // Parallel arrays — same length, index-aligned.
    bytes32[] private _fields;        // keccak256(fieldName) for each counter
    bool[]    private _usePayment;    // true  → use netPayment; false → fixedAmounts[i]
    uint256[] private _fixedAmounts;  // constant increment when usePayment[i] = false

    // ─────────────────────────────────────────────────────────────
    //  Payment config (tunable post-deploy by wire owner)
    // ─────────────────────────────────────────────────────────────

    /// Ordered list of accepted payment tokens (address(0) = native CELO).
    address[] public allowedTokensList;
    mapping(address => bool)    public tokenAllowed;
    mapping(address => uint256) public tokenMinAmount;  // 0 = no minimum
    mapping(address => uint256) public tokenMaxAmount;  // 0 = no maximum

    bool    public oncePerAddress;   // each (caller, targetKey) fires at most once
    address public feeRecipient;     // receives feeBps of every payment
    uint256 public feeBps;           // basis points, max 1_000 (= 10 %)
    address public owner;

    // ─────────────────────────────────────────────────────────────
    //  State
    // ─────────────────────────────────────────────────────────────

    /// oncePerAddress guard
    mapping(address => mapping(bytes32 => bool)) private _used;

    /// Per-project, per-token claimable balance: targetKey → token → amount
    mapping(bytes32 => mapping(address => uint256)) public projectBalance;

    // ─────────────────────────────────────────────────────────────
    //  Events
    // ─────────────────────────────────────────────────────────────

    event RelatedWrite(
        bytes32 indexed sourceKey,
        bytes32 indexed targetKey,
        address indexed caller,
        address         token,
        uint256         grossAmount,
        uint256         netAmount
    );

    event ProjectWithdraw(
        bytes32 indexed targetKey,
        address indexed recipient,
        address         token,
        uint256         amount
    );

    event TokenAdded(address token, uint256 minAmount, uint256 maxAmount);
    event TokenRemoved(address token);
    event TokenLimitsUpdated(address token, uint256 minAmount, uint256 maxAmount);

    // ─────────────────────────────────────────────────────────────
    //  Constructor
    // ─────────────────────────────────────────────────────────────

    /**
     * @param _sourceTable     Source table address
     * @param _targetTable     Target table address (must implement recordOwner())
     * @param _allowedTokens   Initial accepted tokens; address(0) = native CELO
     * @param _minAmounts      Per-token minimums (parallel); 0 = none
     * @param _maxAmounts      Per-token maximums (parallel); 0 = none
     * @param fields           keccak256(fieldName) for each counter
     * @param usePayment       true = netPayment for counter; false = fixedAmounts[i]
     * @param fixedAmounts     Fixed increments (parallel to fields)
     * @param _oncePerAddress  Restrict each wallet to one fire per targetKey
     * @param _feeRecipient    Platform fee recipient (address(0) = no fee)
     * @param _feeBps          Fee in basis points, max 1000
     * @param _owner           Wire admin
     */
    constructor(
        address   _sourceTable,
        address   _targetTable,
        address[] memory _allowedTokens,
        uint256[] memory _minAmounts,
        uint256[] memory _maxAmounts,
        bytes32[] memory fields,
        bool[]    memory usePayment,
        uint256[] memory fixedAmounts,
        bool      _oncePerAddress,
        address   _feeRecipient,
        uint256   _feeBps,
        address   _owner
    ) {
        require(_sourceTable != address(0),                       "wire: zero source");
        require(_targetTable != address(0),                       "wire: zero target");
        require(_owner       != address(0),                       "wire: zero owner");
        require(_allowedTokens.length > 0,                        "wire: no allowed tokens");
        require(_allowedTokens.length == _minAmounts.length,      "wire: token/min mismatch");
        require(_allowedTokens.length == _maxAmounts.length,      "wire: token/max mismatch");
        require(fields.length > 0,                                "wire: no fields");
        require(fields.length == usePayment.length,               "wire: fields/usePayment mismatch");
        require(fields.length == fixedAmounts.length,             "wire: fields/fixed mismatch");
        require(_feeBps <= 1_000,                                 "wire: fee > 10%");

        sourceTable    = IWeb3QLWritable(_sourceTable);
        targetTable    = IWeb3QLCounterTarget(_targetTable);
        _fields        = fields;
        _usePayment    = usePayment;
        _fixedAmounts  = fixedAmounts;
        oncePerAddress = _oncePerAddress;
        feeRecipient   = _feeRecipient;
        feeBps         = _feeBps;
        owner          = _owner;

        for (uint256 i = 0; i < _allowedTokens.length; ) {
            address t = _allowedTokens[i];
            require(!tokenAllowed[t], "wire: duplicate token");
            tokenAllowed[t]   = true;
            tokenMinAmount[t] = _minAmounts[i];
            tokenMaxAmount[t] = _maxAmounts[i];
            allowedTokensList.push(t);
            emit TokenAdded(t, _minAmounts[i], _maxAmounts[i]);
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Core
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Write a record to the source table and atomically update counters
     *         + project balance on the target table — all in one transaction.
     *
     *         Native CELO  : token = address(0), amount = 0, send CELO as msg.value
     *         ERC-20       : token = tokenAddr, amount = desired; msg.value must be 0
     *                        Caller must pre-approve the wire for `amount`.
     *
     * @param sourceKey    bytes32 key for the new record on the SOURCE table
     * @param ciphertext   Encrypted record payload
     * @param encryptedKey Symmetric key encrypted with caller's public key
     * @param targetKey    bytes32 key of the target record (project)
     * @param token        Payment token (address(0) = native CELO)
     * @param amount       Token amount — ignored for native (use msg.value)
     */
    function relatedWrite(
        bytes32 sourceKey,
        bytes   calldata ciphertext,
        bytes   calldata encryptedKey,
        bytes32 targetKey,
        address token,
        uint256 amount
    ) external payable {
        require(tokenAllowed[token], "wire: token not allowed");

        uint256 grossPayment;
        if (token == address(0)) {
            require(amount == 0,    "wire: use msg.value for native; set amount=0");
            grossPayment = msg.value;
        } else {
            require(msg.value == 0, "wire: no native value for ERC-20 wire");
            require(amount > 0,     "wire: zero ERC-20 amount");
            bool ok = IERC20Transfer(token).transferFrom(msg.sender, address(this), amount);
            require(ok, "wire: transferFrom failed");
            grossPayment = amount;
        }

        uint256 minAmt = tokenMinAmount[token];
        uint256 maxAmt = tokenMaxAmount[token];
        require(minAmt == 0 || grossPayment >= minAmt, "wire: below min amount");
        require(maxAmt == 0 || grossPayment <= maxAmt, "wire: above max amount");

        if (oncePerAddress) {
            require(!_used[msg.sender][targetKey], "wire: already used for this target");
            _used[msg.sender][targetKey] = true;
        }

        // ── Fee split ───────────────────────────────────────────
        uint256 netPayment = grossPayment;
        if (feeBps > 0 && feeRecipient != address(0) && grossPayment > 0) {
            uint256 fee = (grossPayment * feeBps) / 10_000;
            netPayment  = grossPayment - fee;
            if (token == address(0)) {
                (bool ok2,) = feeRecipient.call{value: fee}("");
                require(ok2, "wire: native fee transfer failed");
            } else {
                bool ok2 = IERC20Transfer(token).transfer(feeRecipient, fee);
                require(ok2, "wire: ERC-20 fee transfer failed");
            }
        }

        // ── 1. Write to source table ────────────────────────────
        sourceTable.write(sourceKey, ciphertext, encryptedKey);

        // ── 2. Increment counters on target ─────────────────────
        uint256 len = _fields.length;
        for (uint256 i = 0; i < len; ) {
            uint256 inc = _usePayment[i] ? netPayment : _fixedAmounts[i];
            targetTable.increment(targetKey, _fields[i], inc);
            unchecked { ++i; }
        }

        // ── 3. Credit project balance ───────────────────────────
        if (netPayment > 0) {
            projectBalance[targetKey][token] += netPayment;
        }

        emit RelatedWrite(sourceKey, targetKey, msg.sender, token, grossPayment, netPayment);
    }

    // ─────────────────────────────────────────────────────────────
    //  Withdrawal — project record owner only
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Withdraw accumulated payments for a specific project.
     *         Only the record owner on the TARGET table can call this.
     *         Ownership is verified on-chain via targetTable.recordOwner().
     *
     * @param targetKey  bytes32 key of the project record
     * @param token      Token to withdraw (address(0) = native CELO)
     * @param to         Recipient address
     */
    function withdrawProjectFunds(
        bytes32        targetKey,
        address        token,
        address payable to
    ) external {
        address recOwner = IWeb3QLRecordOwner(address(targetTable)).recordOwner(targetKey);
        require(recOwner != address(0), "wire: project record does not exist");
        require(msg.sender == recOwner,  "wire: not the project owner");
        require(to != address(0),        "wire: zero recipient");

        uint256 bal = projectBalance[targetKey][token];
        require(bal > 0, "wire: no balance for this token");

        projectBalance[targetKey][token] = 0;   // zero before transfer

        if (token == address(0)) {
            (bool ok,) = to.call{value: bal}("");
            require(ok, "wire: native withdraw failed");
        } else {
            bool ok = IERC20Transfer(token).transfer(to, bal);
            require(ok, "wire: ERC-20 withdraw failed");
        }

        emit ProjectWithdraw(targetKey, to, token, bal);
    }

    /**
     * @notice Withdraw all token balances for a project in one call.
     *         Iterates allowedTokensList — skips tokens with zero balance.
     */
    function withdrawAllProjectFunds(bytes32 targetKey, address payable to) external {
        address recOwner = IWeb3QLRecordOwner(address(targetTable)).recordOwner(targetKey);
        require(recOwner != address(0), "wire: project record does not exist");
        require(msg.sender == recOwner,  "wire: not the project owner");
        require(to != address(0),        "wire: zero recipient");

        uint256 len = allowedTokensList.length;
        for (uint256 i = 0; i < len; ) {
            address t   = allowedTokensList[i];
            uint256 bal = projectBalance[targetKey][t];
            if (bal > 0) {
                projectBalance[targetKey][t] = 0;
                if (t == address(0)) {
                    (bool ok,) = to.call{value: bal}("");
                    require(ok, "wire: native withdraw failed");
                } else {
                    bool ok = IERC20Transfer(t).transfer(to, bal);
                    require(ok, "wire: ERC-20 withdraw failed");
                }
                emit ProjectWithdraw(targetKey, to, t, bal);
            }
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Views
    // ─────────────────────────────────────────────────────────────

    function getAllowedTokens() external view returns (address[] memory) {
        return allowedTokensList;
    }

    function getFields()       external view returns (bytes32[] memory) { return _fields; }
    function getUsePayment()   external view returns (bool[]    memory) { return _usePayment; }
    function getFixedAmounts() external view returns (uint256[] memory) { return _fixedAmounts; }

    function hasUsed(address user, bytes32 targetKey) external view returns (bool) {
        return _used[user][targetKey];
    }

    /// Returns balances across all allowed tokens for a given project key.
    function projectBalances(bytes32 targetKey)
        external view
        returns (address[] memory tokens, uint256[] memory balances)
    {
        uint256 len = allowedTokensList.length;
        tokens   = new address[](len);
        balances = new uint256[](len);
        for (uint256 i = 0; i < len; ) {
            tokens[i]   = allowedTokensList[i];
            balances[i] = projectBalance[targetKey][allowedTokensList[i]];
            unchecked { ++i; }
        }
    }

    // ─────────────────────────────────────────────────────────────
    //  Owner: manage tokens + rules
    // ─────────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "wire: not owner");
        _;
    }

    /// Add a new accepted payment token with min/max limits.
    function addToken(address token_, uint256 minAmount, uint256 maxAmount) external onlyOwner {
        require(!tokenAllowed[token_], "wire: already allowed");
        tokenAllowed[token_]   = true;
        tokenMinAmount[token_] = minAmount;
        tokenMaxAmount[token_] = maxAmount;
        allowedTokensList.push(token_);
        emit TokenAdded(token_, minAmount, maxAmount);
    }

    /// Remove an accepted token. Existing balances remain withdrawable.
    function removeToken(address token_) external onlyOwner {
        require(tokenAllowed[token_], "wire: not allowed");
        tokenAllowed[token_] = false;
        uint256 len = allowedTokensList.length;
        for (uint256 i = 0; i < len; ) {
            if (allowedTokensList[i] == token_) {
                allowedTokensList[i] = allowedTokensList[len - 1];
                allowedTokensList.pop();
                break;
            }
            unchecked { ++i; }
        }
        emit TokenRemoved(token_);
    }

    /// Update min/max amounts for an existing token.
    function setTokenLimits(address token_, uint256 minAmount, uint256 maxAmount)
        external onlyOwner
    {
        require(tokenAllowed[token_], "wire: not allowed");
        tokenMinAmount[token_] = minAmount;
        tokenMaxAmount[token_] = maxAmount;
        emit TokenLimitsUpdated(token_, minAmount, maxAmount);
    }

    function setOncePerAddress(bool _once) external onlyOwner { oncePerAddress = _once; }

    function setFee(address _recipient, uint256 _bps) external onlyOwner {
        require(_bps <= 1_000, "wire: fee > 10%");
        feeRecipient = _recipient;
        feeBps       = _bps;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "wire: zero address");
        owner = newOwner;
    }

    receive() external payable {}
}
