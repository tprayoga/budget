import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Browser } from 'puppeteer';
import { renderFundRequestHtml, type FrView } from './fund-request.template';
import { renderRealizationReportHtml, type RealizationReportData } from './realization-report.template';

/** Render HTML → PDF (A4 portrait) memakai Puppeteer. Browser dipakai ulang antar request. */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Promise<Browser> | null = null;

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      const puppeteer = await import('puppeteer');
      this.browser = puppeteer
        .launch({
          headless: true,
          executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
        })
        .catch((e) => {
          this.browser = null;
          throw e;
        });
    }
    const b = await this.browser;
    if (!b.connected) {
      this.browser = null;
      return this.getBrowser();
    }
    return b;
  }

  async htmlToPdf(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch((e) => this.logger.warn(`Gagal menutup halaman: ${e}`));
    }
  }

  fundRequestHtml(fr: FrView): string {
    return renderFundRequestHtml(fr);
  }

  fundRequestPdf(fr: FrView): Promise<Buffer> {
    return this.htmlToPdf(renderFundRequestHtml(fr));
  }

  realizationReportPdf(data: RealizationReportData): Promise<Buffer> {
    return this.htmlToPdf(renderRealizationReportHtml(data));
  }

  async onModuleDestroy() {
    if (this.browser) await (await this.browser).close().catch(() => undefined);
  }
}
