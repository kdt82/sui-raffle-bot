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
  number?: number | null;
  last?: boolean;
  pageable?: {
    pageNumber?: number;
    pageSize?: number;
    offset?: number;
  } | null;
}

export interface FetchTradesOptions {
  limit?: number;
  cursor?: string | null;
  sortOrder?: 'asc' | 'desc';
}

const DEFAULT_BASE_URL = 'https://api.blockberry.one/sui';
const DEFAULT_TRADES_PATH = 'v1/coins';
const DEFAULT_LIMIT = 100;
const DEFAULT_PAGE_PARAM = 'page';
const DEFAULT_SIZE_PARAM = 'size';
const DEFAULT_ORDER_PARAM = 'orderBy';
const DEFAULT_SORT_PARAM = 'sortBy';
const DEFAULT_SORT_VALUE = 'AGE';

class BlockberryClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly tradesPath: string;
  private readonly pageParam: string;
  private readonly sizeParam: string;
  private readonly orderParam: string;
  private readonly sortParam: string;
  private readonly sortValue: string;

  constructor() {
    this.apiKey = process.env.BLOCKBERRY_API_KEY || '';
    this.baseUrl = (process.env.BLOCKBERRY_API_URL || DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.tradesPath = (process.env.BLOCKBERRY_TRADES_PATH || DEFAULT_TRADES_PATH).replace(/^\/+/, '');
    this.pageParam = process.env.BLOCKBERRY_TRADES_PAGE_PARAM || DEFAULT_PAGE_PARAM;
    this.sizeParam = process.env.BLOCKBERRY_TRADES_SIZE_PARAM || DEFAULT_SIZE_PARAM;
    this.orderParam = process.env.BLOCKBERRY_TRADES_ORDER_PARAM || DEFAULT_ORDER_PARAM;
    this.sortParam = process.env.BLOCKBERRY_TRADES_SORT_PARAM || DEFAULT_SORT_PARAM;
    this.sortValue = process.env.BLOCKBERRY_TRADES_SORT_VALUE || DEFAULT_SORT_VALUE;

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

    const rawLimit = process.env.BLOCKBERRY_POLL_LIMIT || String(DEFAULT_LIMIT);
    const limit = options.limit ?? parseInt(rawLimit, 10);
    
    if (isNaN(limit) || limit <= 0) {
      throw new Error(`Invalid BLOCKBERRY_POLL_LIMIT: ${rawLimit}`);
    }

    const params = new URLSearchParams();
    params.set(this.pageParam, '0');
    params.set(this.sizeParam, String(limit));
    params.set(this.orderParam, options.sortOrder === 'asc' ? 'ASC' : 'DESC');
    params.set(this.sortParam, this.sortValue);

    const encodedCoinType = encodeURIComponent(tokenAddress);
    const url = `${this.baseUrl}/${this.tradesPath}/${encodedCoinType}/transactions?${params.toString()}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-KEY': this.apiKey,
        },
        body: '{}',
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug('Blockberry returned 404 (likely no data yet)');
          return { data: [] };
        }

        const body = await response.text();
        throw new Error(`Blockberry responded with ${response.status}: ${body.slice(0, 500)}`);
      }

      const json = (await response.json()) as Record<string, any> | BlockberryRawTrade[];

      if (Array.isArray(json)) {
        return { data: json };
      }

      const data = Array.isArray(json.data)
        ? json.data
        : Array.isArray(json.content)
          ? (json.content as BlockberryRawTrade[])
          : [];

      if (!Array.isArray(data)) {
        logger.warn('Blockberry trade response missing data array', json);
        return { data: [] };
      }

      return {
        data,
        cursor: json.cursor ?? null,
        nextCursor: json.nextCursor ?? null,
        pageInfo: json.pageInfo ?? null,
        number: typeof json.number === 'number' ? json.number : json.pageable?.pageNumber,
        last: typeof json.last === 'boolean' ? json.last : undefined,
        pageable: json.pageable ?? null,
      };
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
