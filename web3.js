import { createWalletClient, custom, encodeFunctionData, numberToHex } from 'viem';
import { base } from 'viem/chains';
import { Attribution } from 'ox/erc8021';

// ─── Constants ────────────────────────────────────────────────────────────────
const BUILDER_CODE     = 'bc_sjkexp2o';
const RECEIVER_ADDRESS = '0x3b305a5c77d0274BCDDD9013C80113Ea1D698061';

// USDC on Base (6 decimals, always $1 = 1_000_000 units)
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// Base builder-code data suffix — appended to every transaction
const DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

// ERC-20 transfer ABI selector
const ERC20_TRANSFER_ABI = [{
  name: 'transfer',
  type: 'function',
  inputs: [
    { name: 'to',    type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
  outputs: [{ type: 'bool' }],
}];

/**
 * Convert a USD dollar amount to USDC token units (6 decimals).
 * $0.05 → 50_000 units, $0.01 → 10_000 units, $5.00 → 5_000_000 units
 */
function usdToUSDC(usdAmount) {
  return BigInt(Math.round(usdAmount * 1_000_000));
}

/**
 * Send an ERC-20 USDC transfer to RECEIVER_ADDRESS with builder attribution.
 * All game fees go through this function — amount is always exact USD.
 */
async function sendUSDC(toAddress, usdAmount) {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');

  const tokenUnits = usdToUSDC(usdAmount);

  // Encode ERC-20 transfer calldata: transfer(address to, uint256 value)
  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [toAddress, tokenUnits],
  });

  return await activeProvider.request({
    method: 'eth_sendTransaction',
    params: [{
      from: connectedAddress,
      to:   USDC_CONTRACT,
      value: '0x0',   // No ETH sent — it's a token transfer
      data,
    }]
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
const discoveredWallets = new Map();   // rdns → { info, provider }
let connectedAddress = null;
let walletClient     = null;
let activeProvider   = null;

// ─── EIP-6963 Wallet Discovery ────────────────────────────────────────────────
window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail;
  if (!discoveredWallets.has(info.rdns)) {
    discoveredWallets.set(info.rdns, { info, provider });
  }
});

// Fire the request — all installed EIP-6963 wallets will respond
window.dispatchEvent(new Event('eip6963:requestProvider'));

// ─── Custom Wallet Picker Modal ───────────────────────────────────────────────
function buildModal() {
  if (document.getElementById('wm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'wm-overlay';
  overlay.innerHTML = `
    <div id="wm-modal">
      <div id="wm-header">
        <span id="wm-title">Connect Wallet</span>
        <button id="wm-close" aria-label="Close">✕</button>
      </div>
      <p id="wm-subtitle">Choose your wallet to continue</p>
      <div id="wm-list"></div>
      <p id="wm-footer">Powered by EIP-6963</p>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('wm-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
}

function openModal() {
  return new Promise((resolve, reject) => {
    buildModal();

    const list = document.getElementById('wm-list');
    list.innerHTML = '';

    // Re-request in case wallets announced after first load
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    setTimeout(() => {
      const wallets = [...discoveredWallets.values()];

      if (wallets.length === 0) {
        list.innerHTML = `
          <div class="wm-empty">
            <span>No EVM wallet found in your browser.</span>
            <a href="https://rabby.io" target="_blank" rel="noopener">Install Rabby →</a>
          </div>`;
        document.getElementById('wm-overlay').style.display = 'flex';
        reject(new Error('No wallets found'));
        return;
      }

      // Sort: put common known wallets first
      const PRIORITY = ['io.rabby', 'io.metamask', 'com.trustwallet.app', 'com.brave.wallet'];
      wallets.sort((a, b) => {
        const ai = PRIORITY.indexOf(a.info.rdns);
        const bi = PRIORITY.indexOf(b.info.rdns);
        if (ai === -1 && bi === -1) return a.info.name.localeCompare(b.info.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      wallets.forEach(({ info, provider }) => {
        const btn = document.createElement('button');
        btn.className = 'wm-wallet-btn';

        const iconHtml = info.icon
          ? `<img src="${info.icon}" alt="${info.name}" class="wm-icon" />`
          : `<span class="wm-icon wm-icon-fallback">🔑</span>`;

        btn.innerHTML = `
          ${iconHtml}
          <span class="wm-name">${info.name}</span>
          <span class="wm-arrow">›</span>
        `;

        btn.addEventListener('click', async () => {
          btn.classList.add('wm-connecting');
          btn.querySelector('.wm-arrow').textContent = '…';
          try {
            const accounts = await provider.request({ method: 'eth_requestAccounts' });
            if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

            connectedAddress = accounts[0];
            activeProvider   = provider;
            walletClient     = createWalletClient({
              account: connectedAddress,
              chain:   base,
              transport: custom(provider),
            });

            // Check and switch to Base network if needed
            try {
              const currentChainId = await provider.request({ method: 'eth_chainId' });
              if (currentChainId !== '0x2105' && currentChainId !== '8453') {
                await provider.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x2105' }],  // Base mainnet = 8453
                });
              }
            } catch (switchErr) {
              if (switchErr.code === 4902) {
                await provider.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: '0x2105',
                    chainName: 'Base',
                    rpcUrls: ['https://mainnet.base.org'],
                    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                    blockExplorerUrls: ['https://basescan.org'],
                  }],
                });
              }
            }

            // Listen for account/chain changes
            provider.on?.('accountsChanged', (accounts) => {
              connectedAddress = accounts[0] || null;
              if (!connectedAddress) {
                walletClient = null;
                activeProvider = null;
              }
              window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
            });

            provider.on?.('disconnect', () => {
              connectedAddress = null;
              walletClient = null;
              activeProvider = null;
              window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
            });

            closeModal();
            resolve(connectedAddress);
          } catch (err) {
            btn.classList.remove('wm-connecting');
            btn.querySelector('.wm-arrow').textContent = '›';
            console.error('[web3] Connect error:', err);
            if (err.code !== 4001) {   // 4001 = user rejected, don't show error
              btn.querySelector('.wm-name').textContent = `${info.name} – Try again`;
            }
          }
        });

        list.appendChild(btn);
      });

      document.getElementById('wm-overlay').style.display = 'flex';
    }, 150);  // Short delay so EIP-6963 providers can announce
  });
}

function closeModal() {
  const overlay = document.getElementById('wm-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function connectWallet() {
  return await openModal();
}

export async function disconnectWallet() {
  connectedAddress = null;
  walletClient     = null;
  activeProvider   = null;
}

export function getConnectedAddress() {
  return connectedAddress || null;
}

export async function autoConnectWallet() {
  // Wait a tiny bit for providers to announce themselves
  await new Promise(r => setTimeout(r, 200));
  
  const wallets = [...discoveredWallets.values()];
  for (const { provider, info } of wallets) {
    try {
      // eth_accounts asks if already connected without prompting a popup!
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        connectedAddress = accounts[0];
        activeProvider   = provider;
        walletClient     = createWalletClient({
          account: connectedAddress,
          chain:   base,
          transport: custom(provider),
        });

        // Setup listeners
        provider.on?.('accountsChanged', (accs) => {
          connectedAddress = accs[0] || null;
          if (!connectedAddress) {
            walletClient = null;
            activeProvider = null;
          }
          window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
        });

        provider.on?.('disconnect', () => {
          connectedAddress = null;
          walletClient = null;
          activeProvider = null;
          window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
        });

        return connectedAddress;
      }
    } catch(e) {
      // ignore and try next
    }
  }
  return null;
}

/**
 * Pay exactly $0.05 USDC to revive.
 */
export async function payToRevive() {
  return await sendUSDC(RECEIVER_ADDRESS, 0.05);
}

/**
 * Pay exactly $0.01 USDC to submit score to leaderboard.
 */
export async function payToSubmitScore() {
  return await sendUSDC(RECEIVER_ADDRESS, 0.01);
}

/**
 * Pay exactly $0.01 USDC for daily check-in.
 */
export async function payForDailyCheckin() {
  return await sendUSDC(RECEIVER_ADDRESS, 0.01);
}

/**
 * Bind referral permanently onchain (0-value tx with REFBIND calldata).
 * Creates immutable on-chain record of referral relationship.
 */
export async function bindReferralOnchain(referrerAddress) {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');
  // Encode "REFBIND:" + referrer address as hex data
  const prefix = '524546424e443a'.replace(/\s/g,''); // "REFBND:" in hex
  const addrHex = referrerAddress.slice(2).toLowerCase();
  const data = '0x' + prefix + addrHex;
  return await activeProvider.request({
    method: 'eth_sendTransaction',
    params: [{ from: connectedAddress, to: RECEIVER_ADDRESS, value: '0x0', data }]
  });
}

/**
 * Pay referral reward to a user via USDC (Admin ONLY feature).
 * amountUSD is sent as exact USDC — no ETH conversion needed.
 */
export async function payReferralPayout(targetAddress, amountUSD) {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');
  return await sendUSDC(targetAddress, amountUSD);
}


// ─── Constants ────────────────────────────────────────────────────────────────
const BUILDER_CODE     = 'bc_sjkexp2o';
const RECEIVER_ADDRESS = '0x3b305a5c77d0274BCDDD9013C80113Ea1D698061';

// Base builder-code data suffix — appended to every transaction
const DATA_SUFFIX = Attribution.toDataSuffix({ codes: [BUILDER_CODE] });

// ─── State ────────────────────────────────────────────────────────────────────
const discoveredWallets = new Map();   // rdns → { info, provider }
let connectedAddress = null;
let walletClient     = null;
let activeProvider   = null;

// ─── EIP-6963 Wallet Discovery ────────────────────────────────────────────────
window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail;
  if (!discoveredWallets.has(info.rdns)) {
    discoveredWallets.set(info.rdns, { info, provider });
  }
});

// Fire the request — all installed EIP-6963 wallets will respond
window.dispatchEvent(new Event('eip6963:requestProvider'));

// ─── Custom Wallet Picker Modal ───────────────────────────────────────────────
function buildModal() {
  if (document.getElementById('wm-overlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'wm-overlay';
  overlay.innerHTML = `
    <div id="wm-modal">
      <div id="wm-header">
        <span id="wm-title">Connect Wallet</span>
        <button id="wm-close" aria-label="Close">✕</button>
      </div>
      <p id="wm-subtitle">Choose your wallet to continue</p>
      <div id="wm-list"></div>
      <p id="wm-footer">Powered by EIP-6963</p>
    </div>
  `;

  document.body.appendChild(overlay);

  document.getElementById('wm-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
}

function openModal() {
  return new Promise((resolve, reject) => {
    buildModal();

    const list = document.getElementById('wm-list');
    list.innerHTML = '';

    // Re-request in case wallets announced after first load
    window.dispatchEvent(new Event('eip6963:requestProvider'));

    setTimeout(() => {
      const wallets = [...discoveredWallets.values()];

      if (wallets.length === 0) {
        list.innerHTML = `
          <div class="wm-empty">
            <span>No EVM wallet found in your browser.</span>
            <a href="https://rabby.io" target="_blank" rel="noopener">Install Rabby →</a>
          </div>`;
        document.getElementById('wm-overlay').style.display = 'flex';
        reject(new Error('No wallets found'));
        return;
      }

      // Sort: put common known wallets first
      const PRIORITY = ['io.rabby', 'io.metamask', 'com.trustwallet.app', 'com.brave.wallet'];
      wallets.sort((a, b) => {
        const ai = PRIORITY.indexOf(a.info.rdns);
        const bi = PRIORITY.indexOf(b.info.rdns);
        if (ai === -1 && bi === -1) return a.info.name.localeCompare(b.info.name);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });

      wallets.forEach(({ info, provider }) => {
        const btn = document.createElement('button');
        btn.className = 'wm-wallet-btn';

        const iconHtml = info.icon
          ? `<img src="${info.icon}" alt="${info.name}" class="wm-icon" />`
          : `<span class="wm-icon wm-icon-fallback">🔑</span>`;

        btn.innerHTML = `
          ${iconHtml}
          <span class="wm-name">${info.name}</span>
          <span class="wm-arrow">›</span>
        `;

        btn.addEventListener('click', async () => {
          btn.classList.add('wm-connecting');
          btn.querySelector('.wm-arrow').textContent = '…';
          try {
            const accounts = await provider.request({ method: 'eth_requestAccounts' });
            if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

            connectedAddress = accounts[0];
            activeProvider   = provider;
            walletClient     = createWalletClient({
              account: connectedAddress,
              chain:   base,
              transport: custom(provider),
            });

            // Check and switch to Base network if needed
            try {
              const currentChainId = await provider.request({ method: 'eth_chainId' });
              if (currentChainId !== '0x2105' && currentChainId !== '8453') {
                await provider.request({
                  method: 'wallet_switchEthereumChain',
                  params: [{ chainId: '0x2105' }],  // Base mainnet = 8453
                });
              }
            } catch (switchErr) {
              if (switchErr.code === 4902) {
                await provider.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: '0x2105',
                    chainName: 'Base',
                    rpcUrls: ['https://mainnet.base.org'],
                    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                    blockExplorerUrls: ['https://basescan.org'],
                  }],
                });
              }
            }

            // Listen for account/chain changes
            provider.on?.('accountsChanged', (accounts) => {
              connectedAddress = accounts[0] || null;
              if (!connectedAddress) {
                walletClient = null;
                activeProvider = null;
              }
              window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
            });

            provider.on?.('disconnect', () => {
              connectedAddress = null;
              walletClient = null;
              activeProvider = null;
              window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
            });

            closeModal();
            resolve(connectedAddress);
          } catch (err) {
            btn.classList.remove('wm-connecting');
            btn.querySelector('.wm-arrow').textContent = '›';
            console.error('[web3] Connect error:', err);
            if (err.code !== 4001) {   // 4001 = user rejected, don't show error
              btn.querySelector('.wm-name').textContent = `${info.name} – Try again`;
            }
          }
        });

        list.appendChild(btn);
      });

      document.getElementById('wm-overlay').style.display = 'flex';
    }, 150);  // Short delay so EIP-6963 providers can announce
  });
}

function closeModal() {
  const overlay = document.getElementById('wm-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function connectWallet() {
  return await openModal();
}

export async function disconnectWallet() {
  connectedAddress = null;
  walletClient     = null;
  activeProvider   = null;
}

export function getConnectedAddress() {
  return connectedAddress || null;
}

export async function autoConnectWallet() {
  // Wait a tiny bit for providers to announce themselves
  await new Promise(r => setTimeout(r, 200));
  
  const wallets = [...discoveredWallets.values()];
  for (const { provider, info } of wallets) {
    try {
      // eth_accounts asks if already connected without prompting a popup!
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        connectedAddress = accounts[0];
        activeProvider   = provider;
        walletClient     = createWalletClient({
          account: connectedAddress,
          chain:   base,
          transport: custom(provider),
        });

        // Setup listeners
        provider.on?.('accountsChanged', (accs) => {
          connectedAddress = accs[0] || null;
          if (!connectedAddress) {
            walletClient = null;
            activeProvider = null;
          }
          window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
        });

        provider.on?.('disconnect', () => {
          connectedAddress = null;
          walletClient = null;
          activeProvider = null;
          window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
        });

        return connectedAddress;
      }
    } catch(e) {
      // ignore and try next
    }
  }
  return null;
}

