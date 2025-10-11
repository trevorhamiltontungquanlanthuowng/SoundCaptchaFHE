// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract SoundCaptchaFHE is SepoliaConfig {
    struct AudioChallenge {
        uint256 id;
        euint32 encryptedAudioHash;    // Encrypted audio fingerprint
        euint32 encryptedInstrumentCode; // Encrypted instrument identifier
        euint32 encryptedSolution;      // Encrypted correct answer
        uint256 timestamp;
        bool isActive;
    }
    
    struct ChallengeResponse {
        euint32 encryptedUserAnswer;    // Encrypted user response
        euint32 encryptedValidation;    // Encrypted validation result
        bool isVerified;
    }
    
    struct DecryptedResult {
        uint32 userAnswer;
        uint32 validationResult;
        bool isRevealed;
    }

    uint256 public challengeCount;
    mapping(uint256 => AudioChallenge) public audioChallenges;
    mapping(uint256 => ChallengeResponse) public challengeResponses;
    mapping(uint256 => DecryptedResult) public decryptedResults;
    
    mapping(address => uint256) private userLastChallenge;
    mapping(address => uint256) private successCount;
    
    mapping(uint256 => uint256) private requestToChallengeId;
    
    event ChallengeCreated(uint256 indexed id);
    event ResponseSubmitted(uint256 indexed challengeId, address indexed user);
    event ValidationCompleted(uint256 indexed challengeId);
    event ResultDecrypted(uint256 indexed challengeId);
    
    address public captchaAdmin;
    
    modifier onlyAdmin() {
        require(msg.sender == captchaAdmin, "Not admin");
        _;
    }
    
    constructor() {
        captchaAdmin = msg.sender;
    }
    
    /// @notice Create a new audio CAPTCHA challenge
    function createAudioChallenge(
        euint32 encryptedAudioHash,
        euint32 encryptedInstrumentCode,
        euint32 encryptedSolution
    ) public onlyAdmin {
        challengeCount += 1;
        uint256 newId = challengeCount;
        
        audioChallenges[newId] = AudioChallenge({
            id: newId,
            encryptedAudioHash: encryptedAudioHash,
            encryptedInstrumentCode: encryptedInstrumentCode,
            encryptedSolution: encryptedSolution,
            timestamp: block.timestamp,
            isActive: true
        });
        
        emit ChallengeCreated(newId);
    }
    
    /// @notice Submit response to audio challenge
    function submitChallengeResponse(
        uint256 challengeId,
        euint32 encryptedUserAnswer
    ) public {
        AudioChallenge storage challenge = audioChallenges[challengeId];
        require(challenge.isActive, "Challenge inactive");
        require(userLastChallenge[msg.sender] != challengeId, "Already responded");
        
        challengeResponses[challengeId] = ChallengeResponse({
            encryptedUserAnswer: encryptedUserAnswer,
            encryptedValidation: FHE.asEuint32(0),
            isVerified: false
        });
        
        decryptedResults[challengeId] = DecryptedResult({
            userAnswer: 0,
            validationResult: 0,
            isRevealed: false
        });
        
        userLastChallenge[msg.sender] = challengeId;
        emit ResponseSubmitted(challengeId, msg.sender);
    }
    
    /// @notice Validate user response using FHE
    function validateResponse(uint256 challengeId) public {
        AudioChallenge storage challenge = audioChallenges[challengeId];
        ChallengeResponse storage response = challengeResponses[challengeId];
        require(!response.isVerified, "Already verified");
        
        // Compare user answer with encrypted solution
        ebool isCorrect = FHE.eq(
            response.encryptedUserAnswer,
            challenge.encryptedSolution
        );
        
        // Calculate confidence score
        euint32 confidenceScore = calculateConfidence(
            response.encryptedUserAnswer,
            challenge.encryptedSolution
        );
        
        // Combine results
        euint32 validationResult = FHE.cmux(
            isCorrect,
            FHE.add(confidenceScore, FHE.asEuint32(100)), // Bonus for correct
            confidenceScore
        );
        
        response.encryptedValidation = validationResult;
        response.isVerified = true;
        
        // Update success count if correct
        ebool correct = isCorrect;
        if (FHE.decrypt(correct)) {
            successCount[msg.sender] += 1;
        }
        
        emit ValidationCompleted(challengeId);
    }
    
    /// @notice Request decryption of validation result
    function requestValidationDecryption(uint256 challengeId) public {
        require(userLastChallenge[msg.sender] == challengeId, "Not your challenge");
        require(!decryptedResults[challengeId].isRevealed, "Already decrypted");
        
        ChallengeResponse storage response = challengeResponses[challengeId];
        require(response.isVerified, "Not verified");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(response.encryptedValidation);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptValidationResult.selector);
        requestToChallengeId[reqId] = challengeId;
    }
    
    /// @notice Process decrypted validation result
    function decryptValidationResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 challengeId = requestToChallengeId[requestId];
        require(challengeId != 0, "Invalid request");
        
        DecryptedResult storage dResult = decryptedResults[challengeId];
        require(!dResult.isRevealed, "Already decrypted");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 validationResult = abi.decode(cleartexts, (uint32));
        dResult.validationResult = validationResult;
        dResult.isRevealed = true;
        
        emit ResultDecrypted(challengeId);
    }
    
    /// @notice Calculate response confidence score
    function calculateConfidence(
        euint32 userAnswer,
        euint32 correctAnswer
    ) private view returns (euint32) {
        euint32 difference = FHE.sub(
            FHE.max(userAnswer, correctAnswer),
            FHE.min(userAnswer, correctAnswer)
        );
        
        return FHE.sub(
            FHE.asEuint32(100),
            FHE.div(
                FHE.mul(difference, FHE.asEuint32(100)),
                FHE.max(correctAnswer, FHE.asEuint32(1))
            )
        );
    }
    
    /// @notice Generate audio fingerprint
    function generateAudioFingerprint(
        euint32 frequencyData,
        euint32 amplitudeData,
        euint32 durationData
    ) public pure returns (euint32) {
        // Simplified fingerprint calculation
        return FHE.add(
            FHE.add(
                FHE.div(frequencyData, FHE.asEuint32(10)),
                FHE.div(amplitudeData, FHE.asEuint32(5))
            ),
            FHE.div(durationData, FHE.asEuint32(20))
        );
    }
    
    /// @notice Detect audio manipulation attempts
    function detectTampering(
        uint256 challengeId,
        euint32 currentAudioHash
    ) public view returns (ebool) {
        AudioChallenge storage challenge = audioChallenges[challengeId];
        return FHE.neq(challenge.encryptedAudioHash, currentAudioHash);
    }
    
    /// @notice Get user success count
    function getUserSuccessCount(address user) public view returns (uint256) {
        return successCount[user];
    }
    
    /// @notice Get challenge details
    function getChallengeDetails(uint256 challengeId) public view returns (
        euint32 encryptedInstrumentCode,
        uint256 timestamp,
        bool isActive
    ) {
        AudioChallenge storage c = audioChallenges[challengeId];
        return (c.encryptedInstrumentCode, c.timestamp, c.isActive);
    }
    
    /// @notice Get response details
    function getResponseDetails(uint256 challengeId) public view returns (
        euint32 encryptedUserAnswer,
        euint32 encryptedValidation,
        bool isVerified
    ) {
        ChallengeResponse storage r = challengeResponses[challengeId];
        return (r.encryptedUserAnswer, r.encryptedValidation, r.isVerified);
    }
    
    /// @notice Get decrypted result
    function getDecryptedResult(uint256 challengeId) public view returns (
        uint32 validationResult,
        bool isRevealed
    ) {
        DecryptedResult storage r = decryptedResults[challengeId];
        return (r.validationResult, r.isRevealed);
    }
    
    /// @notice Calculate difficulty level
    function calculateDifficulty(uint256 challengeId) public view returns (euint32) {
        AudioChallenge storage challenge = audioChallenges[challengeId];
        
        // Higher instrument codes indicate more complex sounds
        return FHE.div(
            challenge.encryptedInstrumentCode,
            FHE.asEuint32(10)
        );
    }
    
    /// @notice Verify audio uniqueness
    function verifyAudioUniqueness(
        euint32 audioHash,
        uint256 maxChallengeId
    ) public view returns (ebool) {
        for (uint i = 1; i <= maxChallengeId; i++) {
            if (audioChallenges[i].isActive) {
                ebool isDuplicate = FHE.eq(audioHash, audioChallenges[i].encryptedAudioHash);
                if (FHE.decrypt(isDuplicate)) {
                    return FHE.asEbool(false);
                }
            }
        }
        return FHE.asEbool(true);
    }
    
    /// @notice Update challenge status
    function updateChallengeStatus(uint256 challengeId, bool isActive) public onlyAdmin {
        audioChallenges[challengeId].isActive = isActive;
    }
    
    /// @notice Calculate bot detection score
    function calculateBotDetectionScore(address user) public view returns (euint32) {
        uint256 successes = successCount[user];
        uint256 challengesAttempted = userLastChallenge[user] > 0 ? 1 : 0;
        
        // Higher score indicates more human-like behavior
        return FHE.div(
            FHE.asEuint32(uint32(successes * 100)),
            FHE.asEuint32(uint32(challengesAttempted))
        );
    }
    
    /// @notice Generate next challenge difficulty
    function generateNextDifficulty(address user) public view returns (euint32) {
        uint256 successes = successCount[user];
        
        // Increase difficulty after successful attempts
        return FHE.add(
            FHE.asEuint32(50), // Base difficulty
            FHE.asEuint32(uint32(successes * 10))
        );
    }
}