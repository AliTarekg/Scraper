const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const BaseScraper = require('./BaseScraper');

/**
 * Generic DOM-based scraper that:
 * 1. Crawls links on the site (BFS, depth-limited)
 * 2. Scores pages for "product-likeness"
 * 3. Extracts product data from high-scoring pages using structured data + heuristics
 */
class DomScraper extends BaseScraper {
  constructor(job, emitter) {
    super(job, emitter);
    this.visited = new Set();
    this.queue = [];
    this.maxDepth = job.config.maxDepth || 3;
    this.maxPages = job.config.maxPages || 200;
    this.domain = new URL(job.url).hostname;
    this.scope = this.parseInputUrl();
  }

  async scrape() {
    const products = [];

    // Single product URL → just scrape that one page, no crawling
    if (this.scope.type === 'product') {
      this.log('info', `Single product mode: ${this.job.url}`);
      return this._scrapeSinglePage(this.job.url, products);
    }

    this.queue.push({ url: this.job.url, depth: 0 });

    this.log('info', `Starting DOM scrape on ${this.domain} [${this.scope.type}], maxDepth=${this.maxDepth}, maxPages=${this.maxPages}`);

    while (this.queue.length > 0 && !this.aborted && this.stats.pagesCrawled < this.maxPages) {
      const { url, depth } = this.queue.shift();
      const normalized = this._normalizeUrl(url);
      if (!normalized || this.visited.has(normalized)) continue;
      this.visited.add(normalized);

      try {
        const response = await axios.get(normalized, {
          timeout: this.job.config.timeoutMs || 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml',
          },
          maxRedirects: 5,
          validateStatus: s => s < 400,
        });

        const contentType = response.headers['content-type'] || '';
        if (!contentType.includes('text/html')) continue;

        const $ = cheerio.load(response.data);
        this.stats.pagesCrawled++;

        // Score this page
        const score = this._scoreProductPage($, normalized);
        this.emit('page', { url: normalized, statusCode: response.status, score, depth });

        if (score >= 40) {
          // Extract product data
          const extracted = this._extractProduct($, normalized, response.data);
          if (extracted && extracted.name) {
            const product = this.normalizeProduct(extracted);
            // Dedup check
            const isDup = products.some(p => p.fingerprint === product.fingerprint);
            if (!isDup) {
              products.push(product);
              this.stats.productsFound++;
              this.emit('product', { product });
            }
          }
        }

        // Discover links for further crawling
        if (depth < this.maxDepth) {
          this._discoverLinks($, normalized, depth);
        }

        this.emit('progress', {
          progress: Math.min(95, Math.round((this.stats.pagesCrawled / this.maxPages) * 100)),
          currentUrl: normalized,
          stats: { ...this.stats },
        });

        await this.sleep(this.job.config.delayMs || 1000);
      } catch (err) {
        this.stats.errors++;
        this.log('warn', `Failed to scrape ${normalized}: ${err.message}`);
      }
    }

    this.log('info', `DOM scrape complete. Crawled ${this.stats.pagesCrawled} pages, found ${products.length} products.`);
    return products;
  }

  /**
   * Scores a page for product-likeness (0-100+).
   */
  _scoreProductPage($, url) {
    let score = 0;

    // JSON-LD Product structured data
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const ld = JSON.parse($(el).html());
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
            score += 50;
          }
        }
      } catch { /* malformed JSON-LD */ }
    });

    // OpenGraph product type
    if ($('meta[property="og:type"]').attr('content')?.includes('product')) {
      score += 30;
    }

    // Price patterns on page
    const text = $('body').text();
    if (/\$\s?\d+[\d,.]*|\€\s?\d+[\d,.]*|£\s?\d+[\d,.]*|USD|EUR|GBP/.test(text)) {
      score += 20;
    }

    // Add to cart button
    const htmlLower = $.html().toLowerCase();
    if (htmlLower.includes('add-to-cart') || htmlLower.includes('add_to_cart') || htmlLower.includes('addtocart')) {
      score += 20;
    }

    // URL contains product
    if (/\/product[s]?\//i.test(url) || /\/item[s]?\//i.test(url) || /\/p\//i.test(url)) {
      score += 15;
    }

    // Image gallery (multiple images in a container)
    const imgCount = $('img[src*="product"], .product-image img, .gallery img, [class*="product"] img').length;
    if (imgCount >= 3) score += 10;

    return score;
  }

  /**
   * Extracts product data using multiple approaches (JSON-LD first, then OG tags, then heuristics).
   */
  _extractProduct($, url, html) {
    // 1. Try JSON-LD
    const ldProduct = this._extractJsonLd($);
    if (ldProduct) return { ...ldProduct, sourceUrl: url };

    // 2. Try OpenGraph + meta tags
    const ogProduct = this._extractOpenGraph($);

    // 3. Heuristic extraction
    const heuristic = this._extractHeuristic($, url);

    // Merge (OG fills gaps in heuristic)
    return {
      name: ogProduct.name || heuristic.name,
      price: heuristic.price || ogProduct.price,
      description: ogProduct.description || heuristic.description,
      images: [...new Set([...(ogProduct.images || []), ...(heuristic.images || [])])],
      sourceUrl: url,
      metadata: heuristic.metadata || {},
    };
  }

  _extractJsonLd($) {
    let product = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        const ld = JSON.parse($(el).html());
        const items = Array.isArray(ld) ? ld : [ld];
        for (const item of items) {
          if (item['@type'] === 'Product' || item['@type']?.includes?.('Product')) {
            const offers = item.offers || item.Offers || {};
            const offerList = Array.isArray(offers) ? offers : [offers];
            const firstOffer = offerList[0] || {};
            product = {
              name: item.name,
              price: firstOffer.price || firstOffer.lowPrice,
              currency: firstOffer.priceCurrency,
              description: item.description,
              images: item.image ? (Array.isArray(item.image) ? item.image : [item.image]) : [],
              metadata: {
                brand: item.brand?.name || item.brand,
                sku: item.sku,
                rating: item.aggregateRating?.ratingValue,
              },
            };
          }
        }
      } catch { /* skip */ }
    });
    return product;
  }

  _extractOpenGraph($) {
    return {
      name: $('meta[property="og:title"]').attr('content') || null,
      description: $('meta[property="og:description"]').attr('content') || null,
      images: [$('meta[property="og:image"]').attr('content')].filter(Boolean),
      price: $('meta[property="product:price:amount"]').attr('content') || null,
      currency: $('meta[property="product:price:currency"]').attr('content') || null,
    };
  }

  _extractHeuristic($, url) {
    // Title: try common selectors
    const name = $('h1.product-title, h1.product_title, h1[itemprop="name"], .product-name h1, .product-info h1, h1').first().text().trim() || null;

    // Price: look for price containers
    const priceText = $('[class*="price"] .amount, [class*="price"]:not(del), [itemprop="price"], .product-price, .price').first().text().trim();
    const priceMatch = priceText?.match(/[\d,.]+/);
    const price = priceMatch ? priceMatch[0] : null;

    // Description
    const description = $('[itemprop="description"], .product-description, .product-details, #product-description').first().text().trim() || $('meta[name="description"]').attr('content') || null;

    // Images
    const images = [];
    $('img').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      if (src && !this._isIconOrLogo(src)) {
        images.push(src);
      }
    });

    return { name, price, description, images: images.slice(0, 20), metadata: {} };
  }

  _isIconOrLogo(src) {
    const lower = src.toLowerCase();
    return lower.includes('logo') || lower.includes('icon') || lower.includes('favicon') ||
           lower.includes('sprite') || lower.includes('placeholder') ||
           lower.endsWith('.svg') || lower.endsWith('.gif');
  }

  _discoverLinks($, currentUrl, currentDepth) {
    const links = new Set();
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      const abs = this._absoluteUrl(href);
      if (abs && this._isSameDomain(abs) && !this.visited.has(abs) && this._isInScope(abs)) {
        links.add(abs);
      }
    });

    // Prioritize product-like URLs
    const sorted = [...links].sort((a, b) => {
      const scoreA = this._urlPriority(a);
      const scoreB = this._urlPriority(b);
      return scoreB - scoreA;
    });

    for (const link of sorted) {
      if (this.queue.length + this.visited.size < this.maxPages * 2) {
        this.queue.push({ url: link, depth: currentDepth + 1 });
      }
    }
  }

  /**
   * Check if a discovered URL is within the intended scope.
   * For category scrapes, only follow links that are:
   *   - product pages, OR
   *   - pagination of the same category, OR
   *   - sub-paths of the original category path
   * For storefront, allow everything (original behaviour).
   */
  _isInScope(url) {
    if (this.scope.type === 'storefront') return true;

    const path = new URL(url).pathname;

    // Always allow product-like URLs
    if (/\/product[s]?\//i.test(path) || /\/item[s]?\//i.test(path) || /\/p\//i.test(path)) {
      return true;
    }

    // Allow pagination of the original category path
    if (this.scope.path && path.startsWith(this.scope.path)) return true;

    // Allow query-string pagination on the same base path
    if (path === new URL(this.job.url).pathname) return true;

    return false;
  }

  /**
   * Scrape a single page (used for single-product URLs).
   */
  async _scrapeSinglePage(url, products) {
    try {
      const response = await axios.get(url, {
        timeout: this.job.config.timeoutMs || 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
        },
        maxRedirects: 5,
        validateStatus: s => s < 400,
      });

      const $ = cheerio.load(response.data);
      this.stats.pagesCrawled = 1;
      const extracted = this._extractProduct($, url, response.data);
      if (extracted && extracted.name) {
        const product = this.normalizeProduct(extracted);
        products.push(product);
        this.stats.productsFound = 1;
        this.emit('product', { product });
      }
      this.emit('progress', { progress: 95, currentUrl: url, stats: { ...this.stats } });
    } catch (err) {
      this.stats.errors++;
      this.log('error', `Failed to scrape single page ${url}: ${err.message}`);
    }
    return products;
  }

  _urlPriority(url) {
    let score = 0;
    if (/\/product[s]?\//i.test(url)) score += 10;
    if (/\/shop\//i.test(url)) score += 5;
    if (/\/item[s]?\//i.test(url)) score += 8;
    if (/\/categor/i.test(url)) score += 3;
    if (/\?page=|&page=|\/page\//i.test(url)) score += 2;
    return score;
  }

  _normalizeUrl(url) {
    try {
      const u = new URL(url, this.baseUrl);
      u.hash = '';
      return u.href;
    } catch {
      return null;
    }
  }

  _isSameDomain(url) {
    try {
      return new URL(url).hostname === this.domain;
    } catch {
      return false;
    }
  }
}

module.exports = DomScraper;
