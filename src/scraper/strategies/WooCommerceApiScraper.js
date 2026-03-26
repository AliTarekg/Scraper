const axios = require('axios');
const cheerio = require('cheerio');
const BaseScraper = require('./BaseScraper');

/**
 * Scrapes WooCommerce stores.
 * - Category URL  → paginates through the category HTML pages and extracts
 *                   products from the product grid (works with any language /
 *                   percent-encoded URL paths — no category-ID resolution needed).
 * - Product URL   → WC Store API slug lookup.
 * - Storefront    → WC Store API full paginated scan.
 */
class WooCommerceApiScraper extends BaseScraper {
  async scrape() {
    const scope = this.parseInputUrl();
    this.log('info', `WooCommerce scope: ${scope.type}${scope.slug ? ` (${scope.slug})` : ''}`);

    if (scope.type === 'product') return this._scrapeSingleProduct(scope.slug);
    if (scope.type === 'category') return this._scrapeCategoryByHtml();
    return this._scrapeProductList('');
  }

  /* ── Category: paginate the HTML pages directly ─────────────────────────── */
  async _scrapeCategoryByHtml() {
    const products = [];
    const maxProducts = this.job.config.maxPages || 500;
    const delay = this.job.config.delayMs || 500;
    let totalPages = 1;

    this.log('info', `Scraping category pages directly from: ${this.job.url}`);

    for (let page = 1; page <= totalPages && !this.aborted && products.length < maxProducts; page++) {
      const pageUrl = this._buildCategoryPageUrl(page);
      this.log('debug', `Fetching category page ${page}/${totalPages}: ${pageUrl}`);

      try {
        const res = await axios.get(pageUrl, {
          timeout: this.job.config.timeoutMs || 30000,
          headers: { ...this._headers(), Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
          maxRedirects: 5,
        });

        const $ = cheerio.load(res.data);
        this.stats.pagesCrawled++;

        // Detect total pages from WooCommerce pagination (only needed once)
        if (page === 1) {
          totalPages = this._detectTotalPages($);
          this.log('info', `Category has ${totalPages} page(s)`);
        }

        const pageProducts = this._extractProductsFromListing($);
        if (pageProducts.length === 0 && page === 1) {
          this.log('warn', 'No products found on listing page — site structure may differ');
        }

        for (const p of pageProducts) {
          if (products.length >= maxProducts) break;
          // Dedup by fingerprint
          if (!products.some(x => x.fingerprint === p.fingerprint)) {
            products.push(p);
            this.stats.productsFound++;
            this.emit('product', { product: p });
          }
        }

        this.emit('progress', {
          progress: Math.min(95, Math.round((page / totalPages) * 100)),
          currentUrl: pageUrl,
          stats: { ...this.stats },
        });

        if (page < totalPages) await this.sleep(delay);
      } catch (err) {
        this.stats.errors++;
        this.log('error', `Failed to fetch category page ${page}: ${err.message}`);
        break;
      }
    }

    this.log('info', `Category scrape done. Found ${products.length} products.`);

    // Enrich products with descriptions by visiting each product page
    if (products.length > 0) {
      this.log('info', `Enriching ${products.length} products with descriptions...`);
      await this._enrichWithDescriptions(products);
    }

    return products;
  }

  /**
   * Visit each product's individual page to extract its description.
   * WooCommerce listing pages don't include descriptions.
   */
  async _enrichWithDescriptions(products) {
    const delay = this.job.config.delayMs || 500;

    for (let i = 0; i < products.length && !this.aborted; i++) {
      const product = products[i];
      if (!product.sourceUrl) continue;

      try {
        const res = await axios.get(product.sourceUrl, {
          timeout: this.job.config.timeoutMs || 30000,
          headers: { ...this._headers(), Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
          maxRedirects: 5,
        });

        const $ = cheerio.load(res.data);

        // Extract description from common WooCommerce selectors
        const desc = this._extractDescription($);
        if (desc) {
          product.description = desc;
        }

        // Also grab additional images from the product page gallery
        const galleryImages = this._extractGalleryImages($);
        if (galleryImages.length > 0) {
          const existingSet = new Set(product.images);
          for (const img of galleryImages) {
            if (!existingSet.has(img)) {
              product.images.push(img);
              existingSet.add(img);
            }
          }
        }

        // Emit enriched product → triggers DB update in JobProcessor
        this.emit('product:enriched', { product });

        this.emit('progress', {
          progress: Math.min(95, Math.round(((i + 1) / products.length) * 100)),
          currentUrl: product.sourceUrl,
          stats: { ...this.stats },
        });

        if (i < products.length - 1) await this.sleep(delay);
      } catch (err) {
        this.log('debug', `Could not enrich ${product.name}: ${err.message}`);
      }
    }
  }

  /**
   * Extract description from a WooCommerce single-product page.
   * Handles Arabic and any language — just reads the DOM text.
   */
  _extractDescription($) {
    // 1. WooCommerce tabs: the "Description" tab content
    const tabDesc = $('.woocommerce-Tabs-panel--description, #tab-description').first();
    if (tabDesc.length) {
      const text = tabDesc.text().replace(/\s+/g, ' ').trim();
      if (text) return text;
    }

    // 2. Short description (shown above add-to-cart)
    const shortDesc = $('.woocommerce-product-details__short-description, .product-short-description, .summary .description').first();
    if (shortDesc.length) {
      const text = shortDesc.text().replace(/\s+/g, ' ').trim();
      if (text) return text;
    }

    // 3. Itemprop description (structured data in HTML)
    const itemprop = $('[itemprop="description"]').first();
    if (itemprop.length) {
      const text = itemprop.text().replace(/\s+/g, ' ').trim();
      if (text) return text;
    }

    // 4. Meta description tag
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc && metaDesc.trim()) return metaDesc.trim();

    // 5. OG description
    const ogDesc = $('meta[property="og:description"]').attr('content');
    if (ogDesc && ogDesc.trim()) return ogDesc.trim();

    return '';
  }

  /** Extract gallery images from a single product page. */
  _extractGalleryImages($) {
    const imgs = [];
    const seen = new Set();
    $('.woocommerce-product-gallery img, .product-gallery img, .wp-post-image, .flex-control-thumbs img, figure.woocommerce-product-gallery__image img').each((_, el) => {
      const $img = $(el);
      const src = this._pickRealImageSrc($img);
      if (src && !src.startsWith('data:')) {
        const abs = this._absoluteUrl(src);
        if (abs && !seen.has(abs)) {
          seen.add(abs);
          imgs.push(abs);
        }
      }
    });
    return imgs;
  }

  /**
   * Build the URL for page N of the category.
   * WooCommerce uses /page/N/ path segments for pagination.
   * We keep the original URL encoding intact (Arabic percent-encoded paths, etc.)
   */
  _buildCategoryPageUrl(page) {
    if (page === 1) return this.job.url;
    const u = new URL(this.job.url);
    // Strip any existing /page/N/ suffix, then re-add
    const basePath = u.pathname.replace(/\/page\/\d+\/?$/, '').replace(/\/$/, '');
    return `${u.origin}${basePath}/page/${page}/`;
  }

  /** Read WooCommerce pagination to find highest page number. */
  _detectTotalPages($) {
    const nums = [];
    $('.woocommerce-pagination .page-numbers, nav.woocommerce-pagination a, .page-numbers').each((_, el) => {
      const n = parseInt($(el).text().trim(), 10);
      if (!isNaN(n) && n > 0) nums.push(n);
    });
    return nums.length ? Math.max(...nums) : 1;
  }

  /**
   * Extract product cards from a WooCommerce category/shop listing page.
   * Works with classic themes and most block themes.
   */
  _extractProductsFromListing($) {
    const products = [];

    // Broad selector covering classic WC theme, Storefront, and most child themes
    const $items = $('ul.products li.product, .woocommerce .products .product, li[class*="product-type-"], .products-grid .product');

    $items.each((_, el) => {
      const $el = $(el);

      /* Name */
      const name = $el.find('.woocommerce-loop-product__title, .product-title, h2, h3')
        .first().text().trim();
      if (!name) return;

      /* Source URL */
      const rawHref = $el.find('a.woocommerce-LoopProduct-link, a').first().attr('href');
      const sourceUrl = this._absoluteUrl(rawHref) || null;

      /* Price — prefer sale price (inside <ins>), fall back to first amount */
      const $price = $el.find('.price');
      const insText = $price.find('ins bdi, ins .amount').first().text().trim();
      const plainText = $price.find('> span.amount, > bdi, > .amount').first().text().trim();
      const priceText = insText || plainText || $price.text().trim();
      const price = this._parsePrice(priceText);

      /* Regular price (struck through) */
      const regularText = $price.find('del bdi, del .amount').first().text().trim();
      const regularPrice = regularText ? this._parsePrice(regularText) : null;

      /* Currency */
      const currency = this._detectCurrency($price.html() || '');

      /* Main image — honour lazy-load attributes (check real URLs before src,
         which is often a base64 SVG placeholder on lazy-loaded sites) */
      const $img = $el.find('.attachment-woocommerce_thumbnail, img.wp-post-image, img').first();
      const imgSrc = this._pickRealImageSrc($img);

      /* WooCommerce product ID (data attribute present on most themes) */
      const productId = $el.attr('data-product_id')
        || $el.find('[data-product_id]').first().attr('data-product_id')
        || null;

      /* On-sale badge */
      const onSale = $el.find('.onsale').length > 0
        || (!!(regularPrice && price && regularPrice > price));

      products.push(this.normalizeProduct({
        name,
        price,
        currency,
        description: '',
        images: imgSrc ? [this._absoluteUrl(imgSrc)] : [],
        sourceUrl,
        metadata: {
          regularPrice: regularPrice || undefined,
          onSale,
          productId: productId ? parseInt(productId, 10) : undefined,
        },
      }));
    });

    return products;
  }

  /* ── Single product (unchanged) ────────────────────────────────────────── */
  async _scrapeSingleProduct(slug) {
    this.log('info', `Fetching single product: ${slug}`);
    try {
      const url = `${this.baseUrl}/wp-json/wc/store/v1/products?slug=${encodeURIComponent(slug)}&per_page=1`;
      const res = await axios.get(url, { timeout: 30000, headers: this._headers() });
      const data = Array.isArray(res.data) ? res.data : [];
      if (!data.length) { this.log('warn', 'Product not found via API slug filter'); return []; }
      const product = this._mapProduct(data[0]);
      this.stats.productsFound = 1;
      this.stats.pagesCrawled = 1;
      this.emit('product', { product });
      this.emit('progress', { progress: 95, currentUrl: slug, stats: { ...this.stats } });
      return [product];
    } catch (err) {
      this.stats.errors++;
      this.log('error', `Single product fetch failed: ${err.message}`);
      return [];
    }
  }

  /* ── Storefront: full REST API scan ─────────────────────────────────────── */
  async _scrapeProductList(extraQuery) {
    const products = [];
    let page = 1;
    const perPage = 100;
    const maxProducts = this.job.config.maxPages || 200;

    this.log('info', 'Starting WooCommerce Store API full scan');

    while (!this.aborted) {
      try {
        const url = `${this.baseUrl}/wp-json/wc/store/v1/products?per_page=${perPage}&page=${page}${extraQuery}`;
        this.log('debug', `Fetching ${url}`);

        const response = await axios.get(url, {
          timeout: this.job.config.timeoutMs || 30000,
          headers: this._headers(),
        });

        const data = response.data;
        if (!Array.isArray(data) || data.length === 0) break;

        for (const p of data) {
          const product = this._mapProduct(p);
          products.push(product);
          this.stats.productsFound++;
          this.emit('product', { product });
          if (products.length >= maxProducts) break;
        }
        if (products.length >= maxProducts) break;

        this.stats.pagesCrawled++;
        const totalPages = parseInt(response.headers['x-wp-totalpages'] || '1', 10);
        this.emit('progress', {
          progress: Math.min(95, Math.round((page / totalPages) * 100)),
          currentUrl: `WC API page ${page}/${totalPages}`,
          stats: { ...this.stats },
        });
        if (page >= totalPages) break;
        page++;
        await this.sleep(this.job.config.delayMs || 500);
      } catch (err) {
        this.stats.errors++;
        this.log('error', `WC API failed at page ${page}: ${err.message}`);
        break;
      }
    }

    this.log('info', `WooCommerce scrape complete. Found ${products.length} products.`);
    return products;
  }

  /* ── Map WC Store API JSON → our product format ─────────────────────────── */
  _mapProduct(p) {
    const prices = p.prices || {};
    const minorUnit = prices.currency_minor_unit ?? 2;
    const divisor = Math.pow(10, minorUnit);
    const toDecimal = raw => (raw && raw !== '0' ? parseFloat(raw) / divisor : null);

    const priceVal        = toDecimal(prices.price);
    const regularPriceVal = toDecimal(prices.regular_price);
    const salePriceVal    = toDecimal(prices.sale_price);

    const attributes = (p.attributes || []).map(attr => ({
      name: attr.name,
      options: (attr.terms || []).map(t => t.name).filter(Boolean),
    })).filter(a => a.options.length);

    return this.normalizeProduct({
      name: p.name,
      price: priceVal,
      currency: prices.currency_code || null,
      description: this._stripHtml(p.description || p.short_description || ''),
      images: (p.images || []).map(img => img.src),
      sourceUrl: p.permalink || null,
      metadata: {
        sku: p.sku,
        onSale: p.on_sale,
        regularPrice: regularPriceVal,
        salePrice: (p.on_sale && salePriceVal !== priceVal) ? salePriceVal : null,
        stockStatus: p.stock_status,
        categories: (p.categories || []).map(c => c.name),
        averageRating: p.average_rating,
        productType: p.type || null,
        attributes: attributes.length ? attributes : undefined,
      },
    });
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  /**
   * Pick the real image URL from an <img> element, skipping base64/SVG
   * placeholders that lazy-loading plugins put in `src`.
   */
  _pickRealImageSrc($img) {
    if (!$img || !$img.length) return null;

    // All attributes that commonly hold the real image URL
    const lazyAttrs = [
      'data-src', 'data-lazy-src', 'data-original', 'data-srcset',
      'data-lazy', 'data-bg', 'data-image', 'data-full-url',
    ];

    // Check lazy-load attributes first
    for (const attr of lazyAttrs) {
      const val = ($img.attr(attr) || '').trim();
      if (val && !val.startsWith('data:')) {
        // data-srcset may contain multiple URLs — take the first one
        return val.split(/[,\s]/)[0];
      }
    }

    // Check srcset (native) — first entry
    const srcset = ($img.attr('srcset') || '').trim();
    if (srcset && !srcset.startsWith('data:')) {
      return srcset.split(/[,\s]/)[0];
    }

    // Fallback to src, but only if it's a real URL (not base64)
    const src = ($img.attr('src') || '').trim();
    if (src && !src.startsWith('data:')) return src;

    return null;
  }

  _detectCurrency(html) {
    if (!html) return null;
    if (/EGP|ج\.م|جنيه/.test(html))   return 'EGP';
    if (/SAR|ر\.س|ريال/.test(html))    return 'SAR';
    if (/AED|د\.إ/.test(html))         return 'AED';
    if (/\$|USD/.test(html))           return 'USD';
    if (/€|EUR/.test(html))            return 'EUR';
    if (/£|GBP/.test(html))            return 'GBP';
    const m = html.match(/\b([A-Z]{3})\b/);
    return m ? m[1] : null;
  }

  _headers() {
    return {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'ar,en;q=0.9',
    };
  }

  _stripHtml(html) {
    return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  }
}

module.exports = WooCommerceApiScraper;

