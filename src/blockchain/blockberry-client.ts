import { logger } from '../utils/logger';

export interface BlockberryRawTrade {
  [key: string]: any;
}

export interface BlockberryTradeResponse {
  data: BlockberryRawTrade[];
  cursor?: string | null;
  nextCursor?: string | null;
  next_page_token?: string | null;
  pageInfo?: {
    nextCursor?: string | null;
    endCursor?: string | null;
  } | null;
}

export interface FetchTradesOptions {
  limit?: number;
  cursor?: string | null;
  sortOrder?: 'asc' | 'desc';
}

const DEFAULT_BASE_URL = 'https://api.blockberry.one/v1/sui';
const DEFAULT_TRADES_PATH = 'defi/trades';
const DEFAULT_LIMIT = 100;
const DEFAULT_FILTER_PARAM = 'coinType';
const DEFAULT_ORDER_PARAM = 'order';
const DEFAULT_CURSOR_PARAM = 'cursor';

class BlockberryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tradesPath: string;
  private readonly filterParam: string;
  private readonly orderParam: string;
  private readonly cursorParam: string;

  constructor() {
    this.apiKey = process.env.BLOCKBERRY_API_KEY || '';
    this.baseUrl = (process.env.BLOCKBERRY_API_URL || DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.tradesPath = (process.env.BLOCKBERRY_TRADES_PATH || DEFAULT_TRADES_PATH).replace(/^\/+/, '');
    this.filterParam = process.env.BLOCKBERRY_TRADES_FILTER_PARAM || DEFAULT_FILTER_PARAM;
    this.orderParam = process.env.BLOCKBERRY_TRADES_ORDER_PARAM || DEFAULT_ORDER_PARAM;
    this.cursorParam = process.env.BLOCKBERRY_TRADES_CURSOR_PARAM || DEFAULT_CURSOR_PARAM;

    if (!this.apiKey) {
      logger.warn('BLOCKBERRY_API_KEY not configured; Blockberry client will remain inactive');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async fetchTrades(tokenAddress: string, options: FetchTradesOptions = {}): Promise<BlockberryTradeResponse> {
    if (!this.isConfigured()) {
      throw new Error('Blockberry client called without BLOCKBERRY_API_KEY');
    }

    const limit = options.limit ?? Number(process.env.BLOCKBERRY_POLL_LIMIT || DEFAULT_LIMIT);
    const params = new URLSearchParams();
    params.set(this.filterParam, tokenAddress);
    params.set('limit', String(limit));

    if (options.sortOrder) {
      params.set(this.orderParam, options.sortOrder);
    } else {
      params.set(this.orderParam, 'desc');
    }

    if (options.cursor) {
      params.set(this.cursorParam, options.cursor);
    }

    const url = `${this.baseUrl}/${this.tradesPath}?${params.toString()}`;

    try {
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'x-api-key': this.apiKey,
        },
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Blockberry responded with ${response.status}: ${body.slice(0, 500)}`);
      }

      const json = (await response.json()) as BlockberryTradeResponse | BlockberryRawTrade[];

      if (Array.isArray(json)) {
        return { data: json };
      }

      if (!Array.isArray(json.data)) {
        logger.warn('Blockberry trade response missing data array', json);
        return { data: [] };
      }

      return json;
    } catch (error) {
      logger.error('Failed to fetch trades from Blockberry', error);
      throw error;
    }
  }

  extractNextCursor(response: BlockberryTradeResponse): string | null {
    if (response.nextCursor) {
      return response.nextCursor;
    }

    if (response.cursor) {
      return response.cursor;
    }

    if (response.next_page_token) {
      return response.next_page_token;
    }

    const pageInfo = response.pageInfo;
    if (pageInfo?.nextCursor) {
      return pageInfo.nextCursor;
    }

    if (pageInfo?.endCursor) {
      return pageInfo.endCursor;
    }

    return null;
  }
}

let client: BlockberryClient | null = null;

export function getBlockberryClient(): BlockberryClient {
  if (!client) {
    client = new BlockberryClient();
  }
  return client;
}
