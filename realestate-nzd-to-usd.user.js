// ==UserScript==
// @name         realestate.co.nz NZD/wk → USD/mo
// @namespace    https://greasyfork.org/users/1572604
// @version      1.6.0
// @description  Converts rental prices from NZD/week to USD/month on realestate.co.nz
// @match        *://*.realestate.co.nz/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const CACHE_KEY_RATE = 'nzd_usd_rate';
  const CACHE_KEY_TIME = 'nzd_usd_rate_time';
  const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
  const FALLBACK_RATE = 0.59;
  const RATE_API_URL = 'https://open.er-api.com/v6/latest/NZD';
  // Must end with "per week" — won't match already-converted "/wk · US$..." text
  // \u00a0 = non-breaking space, used in sidebar split-element layout
  const PRICE_REGEX = /\$([\d,]+)[\s\u00a0]*per week/i;
  // Matches just the dollar amount for split-element layouts
  const PRICE_AMOUNT_REGEX = /\$([\d,]+)/;
  const DEBOUNCE_MS = 200;

  // --- Exchange rate (cached in localStorage) ---

  function getCachedRate() {
    try {
      const rate = parseFloat(localStorage.getItem(CACHE_KEY_RATE));
      const time = parseInt(localStorage.getItem(CACHE_KEY_TIME), 10);
      if (rate && time && Date.now() - time < CACHE_TTL_MS) {
        return Promise.resolve(rate);
      }
    } catch (e) {}
    return null;
  }

  async function fetchRate() {
    try {
      const res = await fetch(RATE_API_URL);
      const data = await res.json();
      const rate = data.rates && data.rates.USD;
      if (rate) {
        localStorage.setItem(CACHE_KEY_RATE, rate);
        localStorage.setItem(CACHE_KEY_TIME, Date.now());
        return rate;
      }
    } catch (e) {
      console.warn('[realestate-nzd-usd] Fetch failed, using fallback rate', e);
    }
    return FALLBACK_RATE;
  }

  async function getRate() {
    return getCachedRate() ?? (await fetchRate());
  }

  // --- Price conversion ---

  function nzdPerWeekToUsdPerMonth(nzd, rate) {
    return Math.round((nzd * 52) / 12 * rate);
  }

  function formatUsd(amount) {
    return 'US$' + amount.toLocaleString('en-US');
  }

  // --- Sidebar fast path (data-test="price-display__price-method") ---
  // The map-view sidebar uses a split layout:
  //   <div data-test="price-display__price-method">$560 <span>&nbsp;per week</span></div>
  // where the dollar amount is a bare text node and "per week" lives in a child span.

  function transformPriceDisplayElements(root, rate) {
    const sel = '[data-test="price-display__price-method"]';
    const containers =
      root.nodeType === Node.ELEMENT_NODE && root.matches && root.matches(sel)
        ? [root]
        : root.nodeType === Node.ELEMENT_NODE
          ? [...root.querySelectorAll(sel)]
          : [];
    for (const el of containers) {
      if (el.dataset.nzdConverted) continue;
      const amountNode = [...el.childNodes].find(
        (n) => n.nodeType === Node.TEXT_NODE && /\$[\d,]+/.test(n.textContent)
      );
      if (!amountNode) continue;
      const match = amountNode.textContent.match(/\$([\d,]+)/);
      if (!match) continue;
      const nzd = parseInt(match[1].replace(/,/g, ''), 10);
      if (isNaN(nzd)) continue;
      const usd = nzdPerWeekToUsdPerMonth(nzd, rate);
      el.dataset.nzdConverted = 'true';
      amountNode.textContent = `$${nzd.toLocaleString('en-NZ')}/wk \u00b7 ${formatUsd(usd)}/mo `;
      for (const child of [...el.querySelectorAll('*')]) {
        if (/^[\s\u00a0]*per week[\s\u00a0]*$/i.test(child.textContent)) child.remove();
      }
    }
  }

  // --- DOM transformation ---

  function hasConvertedAncestor(el, stopAt) {
    let node = el;
    while (node && node !== stopAt) {
      if (node.dataset && node.dataset.nzdConverted) return true;
      node = node.parentElement;
    }
    return false;
  }

  function transformSubtree(root, rate) {
    // --- Fast path: sidebar split-element layout ---
    transformPriceDisplayElements(root, rate);

    // --- Pass 1: single text node contains full "$NNN per week" pattern ---
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((tn) => {
      if (!PRICE_REGEX.test(tn.textContent)) return;
      if (hasConvertedAncestor(tn.parentElement, root.parentElement)) return;

      const match = tn.textContent.match(PRICE_REGEX);
      if (!match) return;

      const nzd = parseInt(match[1].replace(/,/g, ''), 10);
      if (isNaN(nzd)) return;

      const usdPerMonth = nzdPerWeekToUsdPerMonth(nzd, rate);
      const replacement = `$${nzd.toLocaleString('en-NZ')}/wk \u00b7 ${formatUsd(usdPerMonth)}/mo`;

      if (tn.parentElement) tn.parentElement.dataset.nzdConverted = 'true';
      tn.textContent = tn.textContent.replace(PRICE_REGEX, () => replacement);
    });

    // --- Pass 2: split-element layout (price and "per week" in separate child nodes) ---
    // e.g. <div>$760 <span>per week</span></div>
    // Strategy: find the tightest element whose combined textContent matches the price pattern
    // but contains no single descendant text node that matches it alone (pass 1 didn't fire).
    const elWalker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    const candidateEls = [];
    if (root.nodeType === Node.ELEMENT_NODE) candidateEls.push(root);
    while (elWalker.nextNode()) candidateEls.push(elWalker.currentNode);

    for (const el of candidateEls) {
      // Skip already-converted or any element with a converted ancestor
      if (hasConvertedAncestor(el, root.parentElement)) continue;
      // Combined text must match
      if (!PRICE_REGEX.test(el.textContent)) continue;
      // Skip if any descendant text node alone matches — pass 1 already handled (or will handle) it
      const deepWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let hasFullMatch = false;
      while (deepWalker.nextNode()) {
        if (PRICE_REGEX.test(deepWalker.currentNode.textContent)) { hasFullMatch = true; break; }
      }
      if (hasFullMatch) continue;

      // Only process compact price containers — skip large containers (cards, sections)
      // that happen to contain a price somewhere deep. A real price element has few text nodes.
      const allTextNodes = [];
      const countWalker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      while (countWalker.nextNode()) allTextNodes.push(countWalker.currentNode);
      // More than 6 text nodes → this is a wider container, not the price element itself
      if (allTextNodes.length > 6) continue;

      // Find the text node holding the dollar amount
      const priceNode = allTextNodes.find((n) => PRICE_AMOUNT_REGEX.test(n.textContent)) ?? null;
      if (!priceNode) continue;

      const amountMatch = priceNode.textContent.match(PRICE_AMOUNT_REGEX);
      if (!amountMatch) continue;

      const nzd = parseInt(amountMatch[1].replace(/,/g, ''), 10);
      if (isNaN(nzd)) continue;

      const usdPerMonth = nzdPerWeekToUsdPerMonth(nzd, rate);
      const replacement = `$${nzd.toLocaleString('en-NZ')}/wk \u00b7 ${formatUsd(usdPerMonth)}/mo`;

      // Mark before mutating
      el.dataset.nzdConverted = 'true';

      // Replace the price text node
      priceNode.textContent = priceNode.textContent.replace(PRICE_AMOUNT_REGEX, replacement);

      // Remove child elements whose sole content is "per week"
      for (const child of [...el.querySelectorAll('*')]) {
        if (/^\s*(?:\u00a0\s*)?per week\s*$/i.test(child.textContent)) child.remove();
      }
    }
  }

  // --- MutationObserver with debounce ---

  function debounce(fn, ms) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  // --- Init ---

  function initWithRate(rate) {
    if (!document.body) {
      // Body not ready yet — cached rate may resolve synchronously before DOM is parsed.
      // Re-attempt once the parser is done.
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => initWithRate(rate), { once: true });
      } else {
        setTimeout(() => initWithRate(rate), 0);
      }
      return;
    }

    // Initial pass over the full document
    transformSubtree(document.body, rate);

    // On subsequent mutations, only scan the newly added subtrees — not the whole page
    const debouncedTransform = debounce((roots) => {
      roots.forEach((root) => transformSubtree(root, rate));
    }, DEBOUNCE_MS);

    const observer = new MutationObserver((mutations) => {
      const newRoots = [];
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) newRoots.push(node);
        }
      }
      if (newRoots.length > 0) debouncedTransform(newRoots);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Fallback sweep: catch any elements the observer may have missed during
    // rapid framework re-renders or infinite-scroll loads.
    const SWEEP_INTERVAL_MS = 1500;
    const SWEEP_IDLE_MS = 10000; // stop if no scroll activity for this long
    let lastScrollTime = Date.now();
    window.addEventListener('scroll', () => { lastScrollTime = Date.now(); }, { passive: true });
    const sweepInterval = setInterval(() => {
      if (Date.now() - lastScrollTime > SWEEP_IDLE_MS) return;
      transformSubtree(document.body, rate);
    }, SWEEP_INTERVAL_MS);
  }

  getRate().then(initWithRate);
})();
