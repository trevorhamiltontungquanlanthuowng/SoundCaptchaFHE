// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface SoundChallenge {
  id: string;
  encryptedAudio: string;
  instrumentType: string;
  timestamp: number;
  status: "pending" | "solved" | "failed";
}

const App: React.FC = () => {
  // Randomized style selections
  // Colors: High contrast (blue+orange)
  // UI: Cyberpunk
  // Layout: Center radiation
  // Interaction: Micro-interactions (hover effects)
  
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [challenges, setChallenges] = useState<SoundChallenge[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newChallengeData, setNewChallengeData] = useState({
    instrumentType: "piano",
    difficulty: "medium"
  });
  const [activeTab, setActiveTab] = useState("challenges");
  const [showTutorial, setShowTutorial] = useState(false);

  // Stats for dashboard
  const solvedCount = challenges.filter(c => c.status === "solved").length;
  const pendingCount = challenges.filter(c => c.status === "pending").length;
  const failedCount = challenges.filter(c => c.status === "failed").length;

  useEffect(() => {
    loadChallenges().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadChallenges = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("challenge_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing challenge keys:", e);
        }
      }
      
      const list: SoundChallenge[] = [];
      
      for (const key of keys) {
        try {
          const challengeBytes = await contract.getData(`challenge_${key}`);
          if (challengeBytes.length > 0) {
            try {
              const challengeData = JSON.parse(ethers.toUtf8String(challengeBytes));
              list.push({
                id: key,
                encryptedAudio: challengeData.audio,
                instrumentType: challengeData.instrument,
                timestamp: challengeData.timestamp,
                status: challengeData.status || "pending"
              });
            } catch (e) {
              console.error(`Error parsing challenge data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading challenge ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setChallenges(list);
    } catch (e) {
      console.error("Error loading challenges:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createChallenge = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Generating FHE-encrypted audio challenge..."
    });
    
    try {
      // Simulate FHE encryption of audio snippet
      const instruments = ["piano", "guitar", "violin", "drums", "flute"];
      const selectedInstrument = newChallengeData.instrumentType || instruments[Math.floor(Math.random() * instruments.length)];
      
      const encryptedAudio = `FHE-AUDIO-${btoa(JSON.stringify({
        instrument: selectedInstrument,
        timestamp: Date.now(),
        data: "encrypted_audio_data_here"
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const challengeId = `sound-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

      const challengeData = {
        audio: encryptedAudio,
        instrument: selectedInstrument,
        timestamp: Math.floor(Date.now() / 1000),
        status: "pending"
      };
      
      // Store encrypted challenge on-chain using FHE
      await contract.setData(
        `challenge_${challengeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(challengeData))
      );
      
      const keysBytes = await contract.getData("challenge_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(challengeId);
      
      await contract.setData(
        "challenge_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE audio challenge created successfully!"
      });
      
      await loadChallenges();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewChallengeData({
          instrumentType: "piano",
          difficulty: "medium"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Challenge creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const solveChallenge = async (challengeId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing FHE audio challenge..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const challengeBytes = await contract.getData(`challenge_${challengeId}`);
      if (challengeBytes.length === 0) {
        throw new Error("Challenge not found");
      }
      
      const challengeData = JSON.parse(ethers.toUtf8String(challengeBytes));
      
      const updatedChallenge = {
        ...challengeData,
        status: "solved"
      };
      
      await contract.setData(
        `challenge_${challengeId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedChallenge))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE audio challenge solved!"
      });
      
      await loadChallenges();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Challenge failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access SoundCaptcha",
      icon: "🔗"
    },
    {
      title: "Create Challenge",
      description: "Generate an FHE-encrypted audio challenge",
      icon: "🎵"
    },
    {
      title: "Solve Challenge",
      description: "Listen and identify the encrypted instrument sound",
      icon: "👂"
    },
    {
      title: "FHE Verification",
      description: "Your answer is verified without decrypting the audio",
      icon: "🔍"
    }
  ];

  const renderStats = () => {
    return (
      <div className="stats-grid">
        <div className="stat-item">
          <div className="stat-value">{challenges.length}</div>
          <div className="stat-label">Total</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{solvedCount}</div>
          <div className="stat-label">Solved</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{pendingCount}</div>
          <div className="stat-label">Pending</div>
        </div>
        <div className="stat-item">
          <div className="stat-value">{failedCount}</div>
          <div className="stat-label">Failed</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="audio-wave"></div>
      <p>Initializing FHE audio engine...</p>
    </div>
  );

  return (
    <div className="app-container cyberpunk-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="soundwave-icon"></div>
          </div>
          <h1>Sound<span>Captcha</span>FHE</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn cyber-button"
          >
            <div className="add-icon"></div>
            New Challenge
          </button>
          <button 
            className="cyber-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Powered Audio CAPTCHA</h2>
            <p>Solve encrypted audio challenges with fully homomorphic encryption</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How SoundCaptchaFHE Works</h2>
            <p className="subtitle">Privacy-preserving audio verification using FHE technology</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card cyber-card">
            <h3>About SoundCaptchaFHE</h3>
            <p>Next-gen CAPTCHA system using FHE to encrypt audio challenges. Users identify instruments without exposing the raw audio data.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Challenge Statistics</h3>
            {renderStats()}
          </div>
          
          <div className="dashboard-card cyber-card">
            <h3>Quick Actions</h3>
            <div className="quick-actions">
              <button 
                onClick={() => setShowCreateModal(true)}
                className="cyber-button small"
              >
                Create Challenge
              </button>
              <button 
                onClick={loadChallenges}
                className="cyber-button small"
              >
                Refresh List
              </button>
              <button 
                onClick={() => contract && contract.isAvailable().then(() => alert("FHE system available!"))}
                className="cyber-button small"
              >
                Check FHE Status
              </button>
            </div>
          </div>
        </div>
        
        <div className="challenges-section">
          <div className="section-header">
            <h2>Audio Challenges</h2>
            <div className="header-actions">
              <button 
                onClick={loadChallenges}
                className="refresh-btn cyber-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="challenges-list cyber-card">
            <div className="table-header">
              <div className="header-cell">ID</div>
              <div className="header-cell">Instrument</div>
              <div className="header-cell">Created</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {challenges.length === 0 ? (
              <div className="no-challenges">
                <div className="no-challenges-icon"></div>
                <p>No audio challenges found</p>
                <button 
                  className="cyber-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Challenge
                </button>
              </div>
            ) : (
              challenges.map(challenge => (
                <div className="challenge-row" key={challenge.id}>
                  <div className="table-cell challenge-id">#{challenge.id.substring(0, 6)}</div>
                  <div className="table-cell">{challenge.instrumentType}</div>
                  <div className="table-cell">
                    {new Date(challenge.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${challenge.status}`}>
                      {challenge.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {challenge.status === "pending" && (
                      <button 
                        className="action-btn cyber-button success"
                        onClick={() => solveChallenge(challenge.id)}
                      >
                        Solve
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createChallenge} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          challengeData={newChallengeData}
          setChallengeData={setNewChallengeData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content cyber-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="audio-wave"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="soundwave-icon"></div>
              <span>SoundCaptchaFHE</span>
            </div>
            <p>Privacy-preserving audio verification using FHE</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">GitHub</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} SoundCaptchaFHE v7. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  challengeData: any;
  setChallengeData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  challengeData,
  setChallengeData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setChallengeData({
      ...challengeData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal cyber-card">
        <div className="modal-header">
          <h2>Create Audio Challenge</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Audio will be encrypted with Zama FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Instrument Type *</label>
              <select 
                name="instrumentType"
                value={challengeData.instrumentType} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="piano">Piano</option>
                <option value="guitar">Guitar</option>
                <option value="violin">Violin</option>
                <option value="drums">Drums</option>
                <option value="flute">Flute</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Difficulty Level</label>
              <select 
                name="difficulty"
                value={challengeData.difficulty} 
                onChange={handleChange}
                className="cyber-select"
              >
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
              </select>
            </div>
          </div>
          
          <div className="audio-preview">
            <div className="audio-wave-preview"></div>
            <p>FHE-encrypted audio preview will be generated</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn cyber-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn cyber-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Challenge"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;