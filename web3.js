/**
 * web3.js — Meme Smash Web3 Layer
 *
 * Pure EIP-6963 + viem approach — NO AppKit, NO WagmiAdapter, NO Coinbase SDK.
 *
 * Flow:
 *  1. On init, listen for EIP-6963 announceProvider events → build wallet list
 *  2. On "Connect Wallet" click → show custom modal with discovered wallets
 *  3. User picks a wallet → connect via eth_requestAccounts
 *  4. Transactions sent via viem walletClient
 *  5. Builder code bc_sjkexp2o appended as dataSuffix on every tx
 */

import { createWalletClient, custom, parseEther, encodeFunctionData, numberToHex } from 'viem';
import { base } from 'viem/chains';
import { Attribution } from 'ox/erc8021';

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

async function sendTx(valueWei) {
  const hexValue = numberToHex(valueWei);
  
  // 1. Try EIP-5792 wallet_sendCalls (Coinbase Smart Wallet / capabilities support)
  try {
    const txHash = await activeProvider.request({
      method: 'wallet_sendCalls',
      params: [{
        version: '1.0',
        chainId: '0x2105', 
        from: connectedAddress,
        calls: [{
          to: RECEIVER_ADDRESS,
          value: hexValue,
          data: '0x'
        }],
        capabilities: {
          dataSuffix: { value: DATA_SUFFIX, optional: true }
        }
      }]
    });
    return txHash;
  } catch (err) {
    if (err.code === 4001) throw err; // User specifically rejected

    // 2. Fallback to raw eth_sendTransaction
    // We bypass viem's sendTransaction here because viem runs eth_estimateGas prior to sending.
    // In strict mobile environments (like the Base App), manually sending data to an EOA 
    // can cause eth_estimateGas to hang/fail silently, preventing the popup from ever showing.
    // Calling the provider directly forces the mobile wallet to handle its own estimation natively.
    return await activeProvider.request({
      method: 'eth_sendTransaction',
      params: [{
        from: connectedAddress,
        to: RECEIVER_ADDRESS,
        value: hexValue,
        data: DATA_SUFFIX,
      }]
    });
  }
}

/**
 * Pay ~$0.05 ETH to revive.
 * Builder code bc_sjkexp2o appended to data field.
 */
export async function payToRevive() {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');
  return await sendTx(parseEther('0.000025'));
}

/**
 * Pay ~$0.01 ETH to submit score.
 * Builder code bc_sjkexp2o appended to data field.
 */
export async function payToSubmitScore() {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');
  return await sendTx(parseEther('0.000005'));
}
