const axios = require('axios');
const cheerio = require('cheerio');

/**
 * Detects the platform/CMS type of a given website URL.
 * Returns: { siteType: 'shopify'|'woocommerce'|'wordpress'|'generic', confidence: number, signals: string[] }
 */
class SiteDetector {
  constructor(url) {
    this.url = url;
    this.baseUrl = new URL(url).origin;
    this.signals = [];
    this.html = null;
    this.$ = null;
  }

  async detect() {
    try {
      const response = await axios.get(this.url, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        maxRedirects: 5,
      });
      this.html = response.data;
      this.$ = cheerio.load(this.html);
    } catch (err) {
      return { siteType: 'generic', confidence: 0, signals: [`Failed to fetch: ${err.message}`] };
    }

    // Check in order of specificity
    const shopify = await this._checkShopify();
    if (shopify.confidence >= 60) return shopify;

    const woo = await this._checkWooCommerce();
    if (woo.confidence >= 60) return woo;

    const wp = this._checkWordPress();
    if (wp.confidence >= 60) return wp;

    return { siteType: 'generic', confidence: 100, signals: ['No known CMS detected'] };
  }

  async _checkShopify() {
    const signals = [];
    let confidence = 0;

    if (this.html.includes('cdn.shopify.com')) {
      signals.push('Shopify CDN detected');
      confidence += 30;
    }
    if (this.html.includes('Shopify.theme') || this.html.includes('window.Shopify')) {
      signals.push('Shopify JS object detected');
      confidence += 25;
    }
    if (this.$('meta[name="shopify-checkout-api-token"]').length) {
      signals.push('Shopify checkout token found');
      confidence += 25;
    }
    if (this.html.includes('/shopify/') || this.html.includes('shopify-section')) {
      signals.push('Shopify section patterns found');
      confidence += 10;
    }

    // Try products.json endpoint
    if (confidence >= 30) {
      try {
        const res = await axios.get(`${this.baseUrl}/products.json?limit=1`, { timeout: 5000 });
        if (res.data && res.data.products) {
          signals.push('products.json API accessible');
          confidence += 30;
        }
      } catch { /* not available */ }
    }

    return { siteType: 'shopify', confidence: Math.min(confidence, 100), signals };
  }

  async _checkWooCommerce() {
    const signals = [];
    let confidence = 0;

    const bodyClass = this.$('body').attr('class') || '';
    if (bodyClass.includes('woocommerce') || this.html.includes('woocommerce')) {
      signals.push('WooCommerce class/reference detected');
      confidence += 30;
    }
    if (this.html.includes('wp-content/plugins/woocommerce')) {
      signals.push('WooCommerce plugin path found');
      confidence += 25;
    }
    if (this.html.includes('wc-add-to-cart') || this.html.includes('add_to_cart_button')) {
      signals.push('WooCommerce add-to-cart found');
      confidence += 15;
    }

    // Try WC Store API
    if (confidence >= 20) {
      try {
        const res = await axios.get(`${this.baseUrl}/wp-json/wc/store/v1/products?per_page=1`, { timeout: 5000 });
        if (res.data && Array.isArray(res.data)) {
          signals.push('WC Store API accessible');
          confidence += 30;
        }
      } catch { /* not available */ }
    }

    return { siteType: 'woocommerce', confidence: Math.min(confidence, 100), signals };
  }

  _checkWordPress() {
    const signals = [];
    let confidence = 0;

    const generator = this.$('meta[name="generator"]').attr('content') || '';
    if (generator.toLowerCase().includes('wordpress')) {
      signals.push('WordPress generator meta found');
      confidence += 40;
    }
    if (this.html.includes('/wp-content/') || this.html.includes('/wp-includes/')) {
      signals.push('WordPress content paths detected');
      confidence += 30;
    }
    if (this.html.includes('wp-json')) {
      signals.push('WordPress REST API reference found');
      confidence += 20;
    }

    return { siteType: 'wordpress', confidence: Math.min(confidence, 100), signals };
  }
}

module.exports = SiteDetector;
