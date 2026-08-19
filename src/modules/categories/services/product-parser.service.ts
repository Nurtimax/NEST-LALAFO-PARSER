/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Injectable } from '@nestjs/common';
import { GetProductDto } from '../dto/get-product.dto';
import { Locator, Page } from 'playwright';
import { ParseStatusService } from './parse-status.service';

// Product cards vary (some have no seller, some have a single image, etc.),
// so a missing field is expected — and since the card has already fully
// rendered by the time we scan it (see the hydration wait below), a
// missing element will never appear no matter how long we wait. Keep this
// short: with several optional fields per card, even a couple seconds
// each compounds to minutes per scroll round on a full category parse.
const ELEMENT_TIMEOUT = 300;

@Injectable()
export class ProductParserService {
  constructor(private readonly parseStatus: ParseStatusService) {}

  async getProductParser(
    getProductDto: GetProductDto,
    page: Page,
    onBatch?: (products: any[]) => Promise<void>,
    onProgress?: (round: number, productsFound: number) => void,
  ) {
    console.log(`Navigating to product page: ${getProductDto.url}`); // Log the URL being navigated to

    await page.goto(getProductDto.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log(`Product page loaded: ${getProductDto.url}`);

    const products = await this.getProductList(page, onBatch, onProgress);

    return {
      products,
    };
  }

  // A full category can be thousands of listings and take hours to scroll
  // through, so onBatch (when given) is called with each round's newly
  // found products as they're discovered — the caller can start acting on
  // them (queueing to Telegram) immediately instead of waiting for the
  // whole scrape to finish. onProgress fires every round regardless, for
  // a status endpoint to report against.
  async getProductList(
    page: Page,
    onBatch?: (products: any[]) => Promise<void>,
    onProgress?: (round: number, productsFound: number) => void,
  ) {
    console.log(`Navigating to product list page: ${page.url()}`); // Log the URL of the page being parsed

    // The sidebar filters (condition, location, price, etc.) render with the
    // exact same ReactVirtualized classes and mount shortly after the page
    // does, so a bare ".first()" can start matching an empty filter widget
    // instead of the actual product grid. Scope to the one that has cards.
    const activePanel = page
      .locator(
        'div[class*="ReactVirtualized__Grid ReactVirtualized__List"]:has(article.LFAdTileHorizontal)',
      )
      .first();

    const grid = activePanel.locator(
      '.ReactVirtualized__Grid__innerScrollContainer',
    );
    await grid.waitFor({ state: 'visible' });
    // The grid container appears before its cards finish hydrating with
    // real data; give React a moment to fill them in before scanning.
    await grid
      .locator('article.LFAdTileHorizontal p[class*="LFSubHeading"]')
      .first()
      .waitFor({ state: 'visible' });

    // Reused across every product's phone-reveal visit instead of opening a
    // fresh browser per listing (that would be enormously wasteful over a
    // full category parse).
    const phonePage = await page.context().newPage();

    try {
      const products: any[] = [];
      const seenIds = new Set<string>();
      // A single scroll can land mid-transition and briefly show no new
      // cards even though there's more list left, so require several
      // consecutive empty rounds — not just one — before giving up.
      let staleRounds = 0;
      const maxStaleRounds = 5;
      // Not a real limit — thousands of listings would take thousands of
      // rounds, so this is only a sanity guard against a genuine infinite
      // loop (e.g. the page never reporting scrollHeight correctly).
      const maxSafetyRounds = 5000;
      let round = 0;

      console.log('Starting to parse product list...'); // Log the start of parsing

      while (
        staleRounds < maxStaleRounds &&
        round < maxSafetyRounds &&
        !this.parseStatus.isStopRequested()
      ) {
        // Get all product articles in the current view
        const productArticles = await grid
          .locator('article.LFAdTileHorizontal')
          .all();

        console.log(
          productArticles.length,
          '✅ Found product articles in view',
        );

        // Parse current visible products. seenIds is checked *inside*
        // parseProductCard too, before it bothers visiting the listing's
        // own page for the phone number — the same handful of cards tend
        // to reappear across consecutive rounds, and a phone-reveal visit
        // is real navigation, not worth repeating for an already-seen ad.
        const newThisRound: any[] = [];
        for (const article of productArticles) {
          const productData = await this.parseProductCard(
            article,
            phonePage,
            seenIds,
          );
          if (
            productData &&
            !this.isProductDuplicate(products, seenIds, productData)
          ) {
            products.push(productData);
            if (productData.id) seenIds.add(productData.id);
            newThisRound.push(productData);
          }
        }
        const addedThisRound = newThisRound.length;

        console.log(
          `Round ${round}: +${addedThisRound} new, ${products.length} total`,
        );

        if (addedThisRound > 0 && onBatch) {
          await onBatch(newThisRound);
        }
        onProgress?.(round, products.length);

        // Scroll to load more products
        const wasAlreadyAtBottom = await this.scrollPage(page);

        // Wait for new content to load
        await page.waitForTimeout(1500);

        round++;

        if (addedThisRound === 0) {
          staleRounds++;
          if (wasAlreadyAtBottom) {
            console.log('Reached the end of the list, stopping');
            break;
          }
        } else {
          staleRounds = 0;
        }
      }

      if (this.parseStatus.isStopRequested()) {
        console.log('Stopped by user request');
      }
      console.log(`Finished parsing: ${products.length} products total`);

      return products; // Return the list of products
    } finally {
      await phonePage.close().catch(() => undefined);
    }
  }

  private async parseProductCard(
    article: Locator,
    phonePage: Page,
    seenIds: Set<string>,
  ) {
    try {
      // Extract the link
      const link = await this.articleLocatorTextContent(
        article,
        'a.LFAdTileHorizontalImage_adTileHorizontalLink__eqEzn',
        'href',
      );

      console.log(`✅ Product link: ${link}`); // Log the product link

      // The same handful of cards can reappear across consecutive scroll
      // rounds (virtualization overlap) — bail before doing a real
      // phone-reveal page visit for something we already have.
      const idMatch = link?.match(/id-(\d+)/);
      const id = idMatch ? idMatch[1] : null;
      if (id && seenIds.has(id)) {
        return null;
      }

      // Get the title
      const title = await this.articleLocatorTextContent(
        article,
        '.LFAdTileHorizontalHeader_adTileHorizontalHeaderLinkTitle__wPIzg p',
      );

      console.log(`✅ Product title: ${title}`); // Log the product title

      // Get the category/description
      const category = await this.articleLocatorTextContent(
        article,
        '.LFAdTileHorizontalHeader_adTileHorizontalHeaderDescription__4T2WA',
      );

      console.log(`✅ Product category: ${category}`); // Log the product category

      // Get the price. It shares its classes with the title paragraph and
      // its wrapper markup isn't consistent across cards (some have an
      // extra nesting div, some don't), but it's reliably the *second*
      // element with these classes in the card, right after the title.
      const price = await article
        .locator('p[class*="LFSubHeading"]')
        .nth(1)
        .textContent({ timeout: ELEMENT_TIMEOUT })
        .catch(() => null);
      const priceText = price?.trim() || 'N/A';
      console.log(`✅ Product price: ${priceText}`);

      // Get the location
      const location = await this.articleLocatorTextContent(
        article,
        '.LFAdTileHorizontalFooter_adTileHorizontalFooterMetaInfoCityWrap__WbnQx span',
      );

      console.log(`✅ Product location: ${location}`); // Log the product location

      // Get the time
      const time = await this.articleLocatorTextContent(
        article,
        '.ad-meta-info-default__time',
      );

      console.log(`✅ Product time: ${time}`); // Log the product time

      // Get the seller name
      const seller = await this.articleLocatorTextContent(
        article,
        '.LFAdTileHorizontalHeader_adTileHorizontalHeaderLinkUser__1UDyj span',
      );

      console.log(`✅ Product seller: ${seller}`); // Log the product seller

      // Check if has speaker (premium)
      const hasSpeaker = await this.articleLocatorCount(
        article,
        '.LFIconSpeaker',
      );

      console.log(`✅ Product has speaker: ${hasSpeaker}`); // Log if the product has speaker

      // Get image count
      const imageCounter = article.locator(
        '.LFAdTileHorizontalSliderImage_sliderComponentSlideCounter__XXnrP',
      );
      const imageCountText = await imageCounter
        .textContent({ timeout: ELEMENT_TIMEOUT })
        .catch(() => null);
      const imageCount = imageCountText
        ? parseInt(imageCountText.split('/')[1])
        : 0;

      console.log(`✅ Product image count: ${imageCount}`); // Log the product image count

      // Get image URLs (first image)
      const firstImage = article
        .locator(
          '.LFAdTileHorizontalSliderImage_sliderComponentItem__lDpzx source',
        )
        .first();
      const imageUrl = await firstImage
        .getAttribute('srcset', { timeout: ELEMENT_TIMEOUT })
        .catch(() => null);

      console.log(`✅ Product first image URL: ${imageUrl}`); // Log the first image URL

      // Get all image URLs if needed
      const allImages = await article
        .locator(
          '.LFAdTileHorizontalSliderImage_sliderComponentItem__lDpzx source',
        )
        .all();

      console.log(`✅ Found ${allImages.length} images for product`);

      const imageUrls: string[] = [];
      for (const img of allImages) {
        const src = await img.getAttribute('srcset');
        if (src) imageUrls.push(src);
      }

      const fullLink = link ? `https://lalafo.kg${link}` : null;
      const phone = fullLink
        ? await this.getPhoneNumber(phonePage, fullLink)
        : null;
      console.log(`✅ Product phone: ${phone}`);

      return {
        id,
        title: title?.trim(),
        category: category?.trim(),
        price: priceText?.trim(),
        location: location?.trim(),
        time: time?.trim(),
        seller: seller?.trim(),
        hasSpeaker,
        imageCount,
        imageUrl,
        imageUrls,
        link: fullLink,
        phone,
      };
    } catch (error) {
      console.error('Error parsing product card:', error);
      return null;
    }
  }

  // Visits the listing's own page and clicks the "Показать" button lalafo
  // hides phone numbers behind, reusing the shared phonePage rather than
  // opening a new browser per listing. Best-effort: a missing/slow button
  // just means this product goes out with no phone, not a failed parse.
  private async getPhoneNumber(
    phonePage: Page,
    productUrl: string,
  ): Promise<string | null> {
    try {
      await phonePage.goto(productUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 15000,
      });

      const showButton = phonePage
        .locator('button[class*="ContactBlockDesktopPhone_showButton"]')
        .first();
      await showButton.click({ timeout: 5000 });

      const phoneLink = phonePage
        .locator('a[href^="tel:"][class*="ContactBlockDesktopPhone"]')
        .first();
      const href = await phoneLink.getAttribute('href', { timeout: 5000 });
      return href ? href.replace(/^tel:/, '') : null;
    } catch {
      return null;
    }
  }

  // The list's own container never actually overflows — react-virtualized
  // sizes it to fit all currently-loaded rows and relies on the *window*
  // scrolling (a WindowScroller) to trigger loading more. Scrolling the
  // grid element's own scrollTop (as this used to do) was a no-op, which
  // is why parsing always stopped after the first ~20 rendered cards.
  //
  // Returns whether the page was already scrolled to the bottom *before*
  // this call, i.e. there's nothing further to load.
  private async scrollPage(page: Page): Promise<boolean> {
    const { scrollY, innerHeight, bodyScrollHeight } = await page.evaluate(
      () => ({
        scrollY: window.scrollY,
        innerHeight: window.innerHeight,
        bodyScrollHeight: document.body.scrollHeight,
      }),
    );

    const wasAlreadyAtBottom = scrollY + innerHeight >= bodyScrollHeight - 50;

    await page.mouse.wheel(0, innerHeight * 0.9);

    return wasAlreadyAtBottom;
  }

  private isProductDuplicate(
    products: any[],
    seenIds: Set<string>,
    newProduct: any,
  ): boolean {
    // Check if product already exists in the list by ID
    if (newProduct.id) {
      return seenIds.has(newProduct.id);
    }
    // Fallback: check by title and price
    return products.some(
      (p) => p.title === newProduct.title && p.price === newProduct.price,
    );
  }

  private async articleLocatorTextContent(
    article: Locator,
    selector: string,
    attribute?: string,
    errorLog?: boolean,
  ) {
    try {
      const element = article.locator(selector);
      const textContent = attribute
        ? await element.getAttribute(attribute, { timeout: ELEMENT_TIMEOUT })
        : await element.textContent({ timeout: ELEMENT_TIMEOUT });

      return textContent;
    } catch (error) {
      if (errorLog) {
        console.error(`❌ Error finding text content for ${selector}:`, error);
      }
      return null;
    }
  }

  private async articleLocatorCount(article: Locator, selector: string) {
    try {
      const element = article.locator(selector);
      const count = await element.count();
      return count;
    } catch (error) {
      console.error(`❌ Error counting elements for ${selector}:`, error);
      return 0;
    }
  }
}
