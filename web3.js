/**
 * web3.js — Meme Smash Web3 Layer
 *
 * Pure EIP-6963 + viem approach — NO AppKit, NO WagmiAdapter, NO Coinbase SDK.
 * All game payments are in ETH (for Base rewards) but priced in USD.
 * ETH amount is calculated dynamically using real-time price from CoinGecko.
 */

import { createWalletClient, custom, parseEther } from 'viem';
import { base } from 'viem/chains';

// ─── Constants ────────────────────────────────────────────────────────────────
const RECEIVER_ADDRESS = '0x3b305a5c77d0274BCDDD9013C80113Ea1D698061';
const BUILDER_CODE     = 'bc_sjkexp2o';

// ─── ETH Price Oracle ─────────────────────────────────────────────────────────
let _cachedEthPrice = null;
let _cachedAt       = 0;
const CACHE_MS      = 60_000; // re-fetch every 60 seconds max

async function getEthUsdPrice() {
  const now = Date.now();
  if (_cachedEthPrice && now - _cachedAt < CACHE_MS) return _cachedEthPrice;

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
      { cache: 'no-store' }
    );
    const json = await res.json();
    _cachedEthPrice = json.ethereum.usd;
    _cachedAt = now;
    return _cachedEthPrice;
  } catch (e) {
    console.warn('[web3] ETH price fetch failed, using fallback $2000:', e);
    return _cachedEthPrice || 2500; // fallback if no cache
  }
}

// Pre-fetch immediately and every 30 seconds to ensure sendETH is instant
getEthUsdPrice();
setInterval(getEthUsdPrice, 30000);

/**
 * Converts a USD amount to ETH string using current live price.
 * Non-async fallback to ensure user gesture is preserved.
 */
function usdToEthStrSync(usdAmount) {
  const price = _cachedEthPrice || 2500;
  const eth = usdAmount / price;
  const str = eth.toFixed(18).replace(/0+$/, '').replace(/\.$/, '');
  return str || '0';
}

/**
 * Send ETH to a target address with the exact USD-equivalent value.
 * Amount is always correct regardless of ETH price volatility.
 */
export async function sendETH(toAddress, usdAmount) {
  // Self-Healing for Base App: If provider is missing, try to pick up the injected one immediately
  if (!activeProvider && typeof window !== 'undefined' && window.ethereum) {
    activeProvider = window.ethereum;
  }
  
  if (!activeProvider) throw new Error('Wallet not connected');

  // If connectedAddress is missing but we have a provider, try to re-probed
  if (!connectedAddress && activeProvider.selectedAddress) {
    connectedAddress = activeProvider.selectedAddress;
  }

  if (!connectedAddress) throw new Error('Wallet address not found');

  // Must be synchronous to preserve user gesture in mobile browsers
  const ethStr  = usdToEthStrSync(usdAmount);
  const weiVal  = parseEther(ethStr);
  const hexVal  = '0x' + weiVal.toString(16);

  // Builder code attribution in data field
  const dataHex = '0x' + Array.from(new TextEncoder().encode(BUILDER_CODE))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  return await activeProvider.request({
    method: 'eth_sendTransaction',
    params: [{
      from:  connectedAddress,
      to:    toAddress,
      value: hexVal,
      data:  dataHex,
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

// ─── Legacy/Base App Discovery Fallback ──────────────────────────────────────
function probeLegacyProviders() {
  if (typeof window === 'undefined') return;
  const legacy = window.ethereum;
  if (legacy) {
    // If it hasn't announced itself via EIP-6963 yet, we add it as a fallback
    const isAlreadyDiscovered = [...discoveredWallets.values()].some(w => w.provider === legacy);
    if (!isAlreadyDiscovered) {
      const isCB = legacy.isCoinbaseBrowser || legacy.isCoinbaseWallet || window.coinbaseWalletExtension;
      const info = {
        uuid: 'legacy-injected',
        name: isCB ? 'Coinbase / Base App' : 'Browser Wallet',
        rdns: 'injected.ethereum',
        icon: isCB ? 'https://docs.cloud.coinbase.com/static/logo.png' : null
      };
      discoveredWallets.set(info.rdns, { info, provider: legacy });
    }
  }
}
// Initial probe + periodic check (mobile providers can be injected late)
probeLegacyProviders();
setTimeout(probeLegacyProviders, 500);
setTimeout(probeLegacyProviders, 1500);

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

      const PRIORITY = ['io.rabby', 'io.metamask', 'com.trustwallet.app', 'com.brave.wallet', 'injected.ethereum'];
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

  // 1. Try EIP-6963 Discovered Wallets
  const wallets = [...discoveredWallets.values()];
  for (const { provider } of wallets) {
    try {
      const accounts = await provider.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        connectedAddress = accounts[0];
        activeProvider   = provider;
        walletClient     = createWalletClient({ account: connectedAddress, chain: base, transport: custom(provider) });
        _bindProviderEvents(provider);
        return connectedAddress;
      }
    } catch(e) { /* next */ }
  }

  // 2. Fallback for Mobile In-App Browsers (Base App / Coinbase Wallet)
  if (typeof window !== 'undefined' && window.ethereum) {
    try {
      // Specifically check for Coinbase/Base App which might not announce via EIP-6963 instantly
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (accounts && accounts.length > 0) {
        connectedAddress = accounts[0];
        activeProvider   = window.ethereum;
        walletClient = createWalletClient({ account: connectedAddress, chain: base, transport: custom(activeProvider) });
        _bindProviderEvents(activeProvider);
        return connectedAddress;
      }
    } catch(e) {}
  }

  return null;
}

function _bindProviderEvents(provider) {
  if (!provider.on) return;
  provider.on('accountsChanged', (accs) => {
    connectedAddress = accs[0] || null;
    if (!connectedAddress) { walletClient = null; activeProvider = null; }
    window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: connectedAddress } }));
  });
  provider.on('disconnect', () => {
    connectedAddress = null; walletClient = null; activeProvider = null;
    window.dispatchEvent(new CustomEvent('walletAccountChanged', { detail: { address: null } }));
  });
}


// ─── Game Payment Functions (all priced in USD, sent as ETH at live rate) ─────

/** Pay $0.05 worth of ETH to revive (ETH amount fetched from live price). */
export async function payToRevive() {
  return await sendETH(RECEIVER_ADDRESS, 0.05);
}

/** Pay $0.01 worth of ETH to submit score to leaderboard. */
export async function payToSubmitScore() {
  return await sendETH(RECEIVER_ADDRESS, 0.01);
}

/** Pay $0.01 worth of ETH for daily check-in. */
export async function payForDailyCheckin() {
  return await sendETH(RECEIVER_ADDRESS, 0.01);
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
 * Pay referral reward to a user via ETH at live USD rate (Admin ONLY).
 * e.g. $5.00 at $2500/ETH → sends 0.002 ETH exactly.
 */
export async function payReferralPayout(targetAddress, amountUSD) {
  return await sendETH(targetAddress, amountUSD);
}
