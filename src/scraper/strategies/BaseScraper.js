const crypto = require('crypto');

/**
 * Base class for all scraper strategies.
 * Subclasses implement scrape() which yields products.
 */
class BaseScraper {
  constructor(job, emitter) {
    this.job = job;
    this.baseUrl = new URL(job.url).origin;
    this.emitter = emitter; // EventEmitter for real-time updates
    this.stats = { pagesCrawled: 0, productsFound: 0, errors: 0 };
    this.aborted = false;
  }

  /**
   * Main entry point. Must be overridden by subclasses.
   * Should return an array of product objects.
   */
  async scrape() {
    throw new Error('scrape() must be implemented by subclass');
  }

  abort() {
    this.aborted = true;
  }

  /**
   * Analyse the user-supplied URL to decide scope:
   *  - 'product'   → single product page
   *  - 'category'  → category / collection listing
   *  - 'storefront'→ whole site
   * Returns { type, slug, path }
   */
  parseInputUrl() {
    const parsed = new URL(this.job.url);
    const path = parsed.pathname.replace(/\/+$/, ''); // strip trailing slashes

    // WooCommerce category: /product-category/<slug>(/<sub-slug>...) (may have /page/N)
    // For nested categories like /product-category/parent/child, we want the LAST
    // (most specific) segment, decoded from percent-encoding (handles Arabic etc.).
    const wcCatIdx = path.indexOf('/product-category/');
    if (wcCatIdx !== -1) {
      const afterPrefix = path.slice(wcCatIdx + '/product-category/'.length);
      const segments = afterPrefix.split('/').filter(s => s && !/^page$/i.test(s) && !/^\d+$/.test(s));
      const slug = segments.length > 0 ? decodeURIComponent(segments[segments.length - 1]) : null;
      if (slug) return { type: 'category', slug, rawSlug: segments[segments.length - 1], path };
    }

    // WooCommerce single product: /product/<slug>
    const wcProd = path.match(/\/product\/([^/]+)/);
    if (wcProd) return { type: 'product', slug: decodeURIComponent(wcProd[1]), path };

    // Shopify collection: /collections/<handle>
    const shopColl = path.match(/\/collections\/([^/]+)/);
    if (shopColl && shopColl[1] !== 'all') return { type: 'category', slug: shopColl[1], path };

    // Shopify single product: /products/<handle>
    const shopProd = path.match(/\/products\/([^/]+)/);
    if (shopProd) return { type: 'product', slug: shopProd[1], path };

    // Generic category hints: /category/*, /shop/*, /c/*
    const genCat = path.match(/\/(category|shop|categor[iy]|c)\/([^/]+)/);
    if (genCat) return { type: 'category', slug: decodeURIComponent(genCat[2]), path };

    return { type: 'storefront', slug: null, path };
  }

  generateFingerprint(domain, name, price) {
    const raw = `${domain}||${(name || '').toLowerCase().trim()}||${price || ''}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }

  normalizeProduct(raw) {
    const price = this._parsePrice(raw.price);
    return {
      name: (raw.name || '').trim().substring(0, 500),
      price: price,
      priceCurrency: raw.currency || raw.priceCurrency || null,
      description: (raw.description || '').trim(),
      images: Array.isArray(raw.images) ? raw.images.filter(Boolean).map(u => this._absoluteUrl(u)) : [],
      sourceUrl: raw.sourceUrl || raw.url || null,
      metadata: raw.metadata || {},
      fingerprint: this.generateFingerprint(new URL(this.job.url).hostname, raw.name, price),
    };
  }

  _parsePrice(val) {
    if (val == null) return null;
    if (typeof val === 'number') return val;
    const cleaned = String(val).replace(/[^0-9.,]/g, '');
    // Handle comma as decimal separator (European): 1.234,56 → 1234.56
    if (/\d+\.\d{3},\d{2}$/.test(cleaned)) {
      return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
    }
    // Handle comma as thousands separator: 1,234.56 → 1234.56
    return parseFloat(cleaned.replace(/,/g, '')) || null;
  }

  _absoluteUrl(url) {
    if (!url) return null;
    if (url.startsWith('//')) return 'https:' + url;
    if (url.startsWith('http')) return url;
    try {
      return new URL(url, this.baseUrl).href;
    } catch {
      return null;
    }
  }

  emit(event, data) {
    if (this.emitter) {
      this.emitter.emit(event, { jobId: this.job.id, ...data });
    }
  }

  log(level, message, context = null) {
    this.emit('log', { level, message, context });
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = BaseScraper;
