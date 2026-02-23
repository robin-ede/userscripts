// ==UserScript==
// @name         Realestate.com.au Rent Converter (AUD & USD)
// @namespace    https://greasyfork.org/users/1572604
// @version      1.1.0
// @description  Converts weekly rent to monthly USD on realestate.com.au
// @match        https://www.realestate.com.au/*
// @grant        GM_xmlhttpRequest
// @connect      open.er-api.com
// @license MIT
// @downloadURL https://update.greasyfork.org/scripts/567187/Realestatecomau%20Rent%20Converter%20%28AUD%20%20USD%29.user.js
// @updateURL https://update.greasyfork.org/scripts/567187/Realestatecomau%20Rent%20Converter%20%28AUD%20%20USD%29.meta.js
// ==/UserScript==

(function() {
    'use strict';

    let audToUsdRate = 0.67; // Default fallback rate

    // 1. Fetch current exchange rate
    function updateExchangeRate() {
        GM_xmlhttpRequest({
            method: "GET",
            url: "https://open.er-api.com/v6/latest/AUD",
            onload: function(response) {
                try {
                    const data = JSON.parse(response.responseText);
                    if (data && data.rates && data.rates.USD) {
                        audToUsdRate = data.rates.USD;
                        console.log("Updated AUD to USD rate:", audToUsdRate);
                        // Re-process page after rate is fetched
                        convertPricesOnPage();
                    }
                } catch (e) {
                    console.error("Failed to parse exchange rate data", e);
                }
            }
        });
    }

    // 2. Inject the conversion label as a sibling <div> after the price element
    //    This avoids inline rendering issues caused by appending a block child
    //    into an inline element (span) or a flex-children paragraph.
    function insertConversionLabel(el, weeklyAud) {
        const monthlyUsd = (weeklyAud * 52) / 12 * audToUsdRate;

        const usdFormatted = monthlyUsd.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

        const label = document.createElement('div');
        label.className = 'rea-rent-converted';
        label.style.cssText = [
            'font-size: 0.78em',
            'color: #555',
            'font-weight: normal',
            'margin-top: 2px',
            'line-height: 1.3',
            'font-family: inherit',
        ].join(';');
        label.textContent = `~${usdFormatted} USD/month`;

        // Insert as next sibling so it always renders on its own line
        el.insertAdjacentElement('afterend', label);
        el.dataset.converted = 'true';
    }

    // 3. Conversion Logic
    function convertPricesOnPage() {
        // Named selectors for known stable class patterns on:
        //   - detail page + list cards:  .property-price / .property-info__price  (BEM, very stable)
        //   - map popup:                 [class*="HeadlineText"]  (styled-component name, stable across hash changes)
        // Note: .residential-card__price is intentionally excluded — it's a wrapper div that contains
        //   .property-price, so including it would cause a duplicate label on list view cards.
        const namedSelectors = [
            '.property-price',
            '.property-info__price',
            '.property-price__price',
            '[class*="HeadlineText"]',
            '[class*="PropertyPrice"]',
        ];

        // Text-content fallback: any leaf <p> or <span> containing a $ price and "per week"
        // Runs after named selectors, so anything already caught won't be double-processed
        const textFallback = Array.from(document.querySelectorAll('p, span, div'))
            .filter(el =>
                !el.querySelector('p, span, div') && // leaf-ish element
                /\$[\d,]+/.test(el.textContent) &&
                el.textContent.toLowerCase().includes('per week')
            );

        const seen = new Set();
        const candidates = [
            ...Array.from(document.querySelectorAll(namedSelectors.join(','))),
            ...textFallback,
        ];

        candidates.forEach(el => {
            if (seen.has(el) || el.dataset.converted) return;
            seen.add(el);

            const text = el.textContent.trim();
            // Match "$570", "$570 - $620", "$1,200" — take the first (lower) number
            const match = text.match(/\$([\d,]+)/);
            if (!match) return;

            const weeklyAud = parseFloat(match[1].replace(/,/g, ''));
            if (!isNaN(weeklyAud) && weeklyAud > 50) { // sanity: ignore tiny bond sub-values
                insertConversionLabel(el, weeklyAud);
            }
        });
    }

    // 4. Handle Dynamic Content (map popups, SPA navigation)
    const observer = new MutationObserver(() => {
        clearTimeout(window._rentConvertTimeout);
        window._rentConvertTimeout = setTimeout(convertPricesOnPage, 400);
    });

    // Start script
    updateExchangeRate();
    convertPricesOnPage();
    observer.observe(document.body, { childList: true, subtree: true });

})();
