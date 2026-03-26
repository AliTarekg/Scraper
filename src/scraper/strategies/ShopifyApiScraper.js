const axios = require('axios');
const BaseScraper = require('./BaseScraper');

/**
 * Scrapes Shopify stores via their public JSON APIs.
 * Respects the input URL: collection → only that collection, product → only that product.
 */
class ShopifyApiScraper extends BaseScraper {
  async scrape() {
    const scope = this.parseInputUrl();
    this.log('info', `Shopify scope: ${scope.type}${scope.slug ? ` (${scope.slug})` : ''}`);

    if (scope.type === 'product') {
      return this._scrapeSingleProduct(scope.slug);
    }

    // For collection / storefront
    const basePath = scope.type === 'category'
      ? `/collections/${encodeURIComponent(scope.slug)}`
      : '';

    return this._scrapeProductList(basePath);
  }

  /* ── Single product ───────────────────────────────── */
  async _scrapeSingleProduct(handle) {
    this.log('info', `Fetching single product: ${handle}`);
    try {
      const url = `${this.baseUrl}/products/${encodeURIComponent(handle)}.json`;
      const res = await axios.get(url, { timeout: 30000, headers: this._headers() });
      const p = res.data?.product;
      if (!p) { this.log('warn', 'Product not found'); return []; }
      const product = this._mapProduct(p);
      this.stats.productsFound = 1;
      this.stats.pagesCrawled = 1;
      this.emit('product', { product });
      this.emit('progress', { progress: 95, currentUrl: handle, stats: { ...this.stats } });
      return [product];
    } catch (err) {
      this.stats.errors++;
      this.log('error', `Single product fetch failed: ${err.message}`);
      return [];
    }
  }

  /* ── Paginated list (collection or all) ────────────── */
  async _scrapeProductList(basePath) {
    const products = [];
    let page = 1;
    const limit = 250;
    const maxPages = Math.ceil((this.job.config.maxPages || 200) / limit) + 1;

    this.log('info', `Starting Shopify API scrape${basePath ? ` for ${basePath}` : ''}`);

    while (!this.aborted && page <= maxPages) {
      try {
        const url = `${this.baseUrl}${basePath}/products.json?limit=${limit}&page=${page}`;
        this.log('debug', `Fetching ${url}`);

        const response = await axios.get(url, {
          timeout: this.job.config.timeoutMs || 30000,
          headers: this._headers(),
        });

        const data = response.data;
        if (!data.products || data.products.length === 0) {
          this.log('info', `No more products at page ${page}. Done.`);
          break;
        }

        for (const p of data.products) {
          const product = this._mapProduct(p);
          products.push(product);
          this.stats.productsFound++;
          this.emit('product', { product });
        }

        this.stats.pagesCrawled++;
        this.emit('progress', {
          progress: Math.min(95, Math.round((page / maxPages) * 100)),
          currentUrl: `products.json page ${page}`,
          stats: { ...this.stats },
        });

        page++;
        await this.sleep(this.job.config.delayMs || 500);
      } catch (err) {
        this.stats.errors++;
        this.log('error', `Failed to fetch page ${page}: ${err.message}`);
        break;
      }
    }

    this.log('info', `Shopify scrape complete. Found ${products.length} products.`);
    return products;
  }

  _mapProduct(p) {
    return this.normalizeProduct({
      name: p.title,
      price: p.variants?.[0]?.price,
      currency: null,
      description: this._stripHtml(p.body_html || ''),
      images: (p.images || []).map(img => img.src),
      sourceUrl: `${this.baseUrl}/products/${p.handle}`,
      metadata: {
        vendor: p.vendor,
        productType: p.product_type,
        tags: p.tags,
        variants: (p.variants || []).map(v => ({
          title: v.title,
          price: v.price,
          sku: v.sku,
          available: v.available,
        })),
      },
    });
  }

  _headers() {
    return { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' };
  }

  _stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

module.exports = ShopifyApiScraper;
