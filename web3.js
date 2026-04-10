/**
 * web3.js — Meme Smash Web3 Layer
 *
 * Pure EIP-6963 + viem approach — NO AppKit, NO WagmiAdapter, NO Coinbase SDK.
 * All game payments use USDC (ERC-20 stablecoin on Base) for fixed USD pricing.
 */

import { createWalletClient, custom, encodeFunctionData } from 'viem';
import { base } from 'viem/chains';

// ─── Constants ────────────────────────────────────────────────────────────────
const RECEIVER_ADDRESS = '0x3b305a5c77d0274BCDDD9013C80113Ea1D698061';

// USDC on Base (6 decimals — $1.00 = 1_000_000 units)
const USDC_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

// ERC-20 transfer ABI (only what we need)
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
 * $0.05 → 50_000 | $0.01 → 10_000 | $5.00 → 5_000_000
 */
function usdToUSDC(usdAmount) {
  return BigInt(Math.round(usdAmount * 1_000_000));
}

/**
 * Send an ERC-20 USDC transfer to a target address.
 * Value is always exact USD — immune to ETH price swings.
 */
async function sendUSDC(toAddress, usdAmount) {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');

  const data = encodeFunctionData({
    abi: ERC20_TRANSFER_ABI,
    functionName: 'transfer',
    args: [toAddress, usdToUSDC(usdAmount)],
  });

  return await activeProvider.request({
    method: 'eth_sendTransaction',
    params: [{
      from:  connectedAddress,
      to:    USDC_CONTRACT,
      value: '0x0',
      data,
    }],
  });
}

// ─── State ────────────────────────────────────────────────────────────────────
const discoveredWallets = new Map();
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
        btn.innerHTML = `${iconHtml}<span class="wm-name">${info.name}</span><span class="wm-arrow">›</span>`;

        btn.addEventListener('click', async () => {
          btn.classList.add('wm-connecting');
          btn.querySelector('.wm-arrow').textContent = '…';
          try {
            const accounts = await provider.request({ method: 'eth_requestAccounts' });
            if (!accounts || accounts.length === 0) throw new Error('No accounts returned');

            connectedAddress = accounts[0];
            activeProvider   = provider;
            walletClient     = createWalletClient({ account: connectedAddress, chain: base, transport: custom(provider) });

            try {
              const currentChainId = await provider.request({ method: 'eth_chainId' });
              if (currentChainId !== '0x2105' && currentChainId !== '8453') {
                await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
              }
            } catch (switchErr) {
              if (switchErr.code === 4902) {
                await provider.request({
                  method: 'wallet_addEthereumChain',
                  params: [{ chainId: '0x2105', chainName: 'Base', rpcUrls: ['https://mainnet.base.org'],
                    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
                    blockExplorerUrls: ['https://basescan.org'] }],
                });
              }
            }

            provider.on?.('accountsChanged', (accs) => {
              connectedAddress = accs[0] || null;
              if (!connectedAddress) { walletClient = null; activeProvider = null; }
              window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
            });
            provider.on?.('disconnect', () => {
              connectedAddress = null; walletClient = null; activeProvider = null;
              window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
            });

            closeModal();
            resolve(connectedAddress);
          } catch (err) {
            btn.classList.remove('wm-connecting');
            btn.querySelector('.wm-arrow').textContent = '›';
            console.error('[web3] Connect error:', err);
            if (err.code !== 4001) btn.querySelector('.wm-name').textContent = `${info.name} – Try again`;
          }
        });

        list.appendChild(btn);
      });

      document.getElementById('wm-overlay').style.display = 'flex';
    }, 150);
  });
}

function closeModal() {
  const overlay = document.getElementById('wm-overlay');
  if (overlay) overlay.style.display = 'none';
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function connectWallet() { return await openModal(); }

export async function disconnectWallet() {
  connectedAddress = null; walletClient = null; activeProvider = null;
}

export function getConnectedAddress() { return connectedAddress || null; }

export async function autoConnectWallet() {
  await new Promise(r => setTimeout(r, 200));
  const wallets = [...discoveredWallets.values()];
  for (const { provider } of wallets) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        connectedAddress = accounts[0];
        activeProvider   = provider;
        walletClient     = createWalletClient({ account: connectedAddress, chain: base, transport: custom(provider) });
        provider.on?.('accountsChanged', (accs) => {
          connectedAddress = accs[0] || null;
          if (!connectedAddress) { walletClient = null; activeProvider = null; }
          window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
        });
        provider.on?.('disconnect', () => {
          connectedAddress = null; walletClient = null; activeProvider = null;
          window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
        });
        return connectedAddress;
      }
    } catch(e) { /* try next */ }
  }
  return null;
}

// ─── Game Payment Functions (all use USDC stablecoin — always exact USD) ─────

/** Pay exactly $0.05 USDC to revive. */
export async function payToRevive() {
  return await sendUSDC(RECEIVER_ADDRESS, 0.05);
}

/** Pay exactly $0.01 USDC to submit score to leaderboard. */
export async function payToSubmitScore() {
  return await sendUSDC(RECEIVER_ADDRESS, 0.01);
}

/** Pay exactly $0.01 USDC for daily check-in. */
export async function payForDailyCheckin() {
  return await sendUSDC(RECEIVER_ADDRESS, 0.01);
}

/**
 * Bind referral permanently onchain (0-value tx with REFBIND calldata).
 * Creates an immutable on-chain record of the referral relationship.
 */
export async function bindReferralOnchain(referrerAddress) {
  if (!activeProvider || !connectedAddress) throw new Error('Wallet not connected');
  const prefix = '524546424e443a'; // "REFBND:" in hex
  const data = '0x' + prefix + referrerAddress.slice(2).toLowerCase();
  return await activeProvider.request({
    method: 'eth_sendTransaction',
    params: [{ from: connectedAddress, to: RECEIVER_ADDRESS, value: '0x0', data }],
  });
}

/**
 * Pay referral reward to a user via USDC (Admin ONLY).
 * amountUSD is sent as exact USDC — no ETH conversion or rate risk.
 */
export async function payReferralPayout(targetAddress, amountUSD) {
  return await sendUSDC(targetAddress, amountUSD);
}
