// ==UserScript==
// @name         Realestate.com.au Rent Converter (AUD & USD)
// @namespace    https://github.com/robin-ede/userscripts
// @version      1.1.0
// @description  Converts weekly rent to monthly USD on realestate.com.au
// @author       robin-ede
// @license      MIT
// @match        https://www.realestate.com.au/*
// @grant        GM_xmlhttpRequest
// @connect      open.er-api.com
// ==/UserScript==

(function () {
  'use strict';

  const FALLBACK_RATE = 0.67;
  const RATE_API_URL = 'https://open.er-api.com/v6/latest/AUD';
  const DEBOUNCE_MS = 400;
  const CONVERTED_ATTR = 'data-converted';
  const CONVERTED_CLASS = 'rea-rent-converted';

  // --- Exchange rate ---

  let audToUsdRate = FALLBACK_RATE;

  function fetchRate() {
    GM_xmlhttpRequest({
      method: 'GET',
      url: RATE_API_URL,
      onload(response) {
        try {
          const data = JSON.parse(response.responseText);
          if (data && data.rates && data.rates.USD) {
            audToUsdRate = data.rates.USD;
            convertPricesOnPage();
          }
        } catch (e) {
          console.warn('[realestate-aud-usd] Failed to parse exchange rate', e);
        }
      },
    });
  }

  // --- Price conversion ---

  function audPerWeekToUsdPerMonth(aud) {
    return Math.round((aud * 52) / 12 * audToUsdRate);
  }

  function formatUsd(amount) {
    return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  }

  // --- DOM transformation ---

  function insertConversionLabel(el, weeklyAud) {
    const usdPerMonth = audPerWeekToUsdPerMonth(weeklyAud);

    const label = document.createElement('div');
    label.className = CONVERTED_CLASS;
    label.style.cssText = [
      'font-size: 0.78em',
      'color: #555',
      'font-weight: normal',
      'margin-top: 2px',
      'line-height: 1.3',
      'font-family: inherit',
    ].join(';');
    label.textContent = `~${formatUsd(usdPerMonth)} USD/month`;

    el.insertAdjacentElement('afterend', label);
    el.dataset.converted = 'true';
  }

  function convertPricesOnPage() {
    // Named selectors for known stable class patterns:
    //   - detail page + list cards:  .property-price / .property-info__price  (BEM, very stable)
    //   - map popup:                 [class*="HeadlineText"]  (styled-component, stable across hash changes)
    // Note: .residential-card__price is intentionally excluded — it wraps .property-price,
    //   so including it would cause duplicate labels on list view cards.
    const namedSelectors = [
      '.property-price',
      '.property-info__price',
      '.property-price__price',
      '[class*="HeadlineText"]',
      '[class*="PropertyPrice"]',
    ];

    // Text-content fallback: any leaf element containing a $ price and "per week"
    const textFallback = Array.from(document.querySelectorAll('p, span, div')).filter(
      (el) =>
        !el.querySelector('p, span, div') &&
        /\$[\d,]+/.test(el.textContent) &&
        el.textContent.toLowerCase().includes('per week')
    );

    const seen = new Set();
    const candidates = [
      ...Array.from(document.querySelectorAll(namedSelectors.join(','))),
      ...textFallback,
    ];

    for (const el of candidates) {
      if (seen.has(el) || el.dataset.converted) continue;
      seen.add(el);

      const match = el.textContent.trim().match(/\$([\d,]+)/);
      if (!match) continue;

      const weeklyAud = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(weeklyAud) && weeklyAud > 50) {
        insertConversionLabel(el, weeklyAud);
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

  fetchRate();
  convertPricesOnPage();

  const observer = new MutationObserver(debounce(convertPricesOnPage, DEBOUNCE_MS));
  observer.observe(document.body, { childList: true, subtree: true });
})();
