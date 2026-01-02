/**
 * Perplexity Sonar Chat Completions Template - TypeScript
 *
 * Search-augmented chat completion with citation handling.
 *
 * Placeholders:
 * - {{MODEL}} -> Model ID (sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro)
 * - {{SYSTEM_PROMPT}} -> System message content
 *
 * Usage:
 *   1. Copy this file to your project
 *   2. Replace placeholders with actual values
 *   3. Set PERPLEXITY_API_KEY environment variable
 *   4. Run with ts-node or compile with tsc
 */

import OpenAI from 'openai';

// Configuration - Replace placeholders
const MODEL = '{{MODEL}}';
const SYSTEM_PROMPT = '{{SYSTEM_PROMPT}}';

// Types
interface SearchResponse {
  content: string;
  citations: string[];
  model: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Create configured Perplexity client.
 */
function createClient(): OpenAI {
  const apiKey = process.env.PERPLEXITY_API_KEY || process.env.PPLX_API_KEY;

  if (!apiKey) {
    throw new Error(
      'PERPLEXITY_API_KEY or PPLX_API_KEY environment variable required'
    );
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://api.perplexity.ai',
  });
}

/**
 * Perform search-augmented chat completion.
 *
 * @param query - User's question or search query
 * @param options - Optional configuration
 * @returns SearchResponse with content and citations
 */
async function searchChat(
  query: string,
  options: {
    client?: OpenAI;
    systemPrompt?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<SearchResponse> {
  const {
    client = createClient(),
    systemPrompt = SYSTEM_PROMPT,
    model = MODEL,
    maxTokens = 2000,
    temperature = 0.2,
  } = options;

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: query },
    ],
    max_tokens: maxTokens,
    temperature,
  });

  const content = response.choices[0].message.content || '';

  // Extract citations if available (may be in response metadata)
  const citations: string[] = (response as any).citations || [];

  return {
    content,
    citations,
    model: response.model,
    usage: {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      totalTokens: response.usage?.total_tokens || 0,
    },
  };
}

/**
 * Multi-turn conversation manager with search context.
 *
 * @example
 * const chat = new PerplexityChat('You are a research assistant.');
 * const response = await chat.ask('What are recent AI developments?');
 * console.log(response.content);
 * const followUp = await chat.ask('Tell me more about the first one.');
 * console.log(chat.getAllCitations());
 */
class PerplexityChat {
  private client: OpenAI;
  private model: string;
  private maxTokens: number;
  private messages: Message[];
  private allCitations: string[];

  constructor(
    systemPrompt: string = SYSTEM_PROMPT,
    model: string = MODEL,
    maxTokens: number = 2000
  ) {
    this.client = createClient();
    this.model = model;
    this.maxTokens = maxTokens;
    this.messages = [{ role: 'system', content: systemPrompt }];
    this.allCitations = [];
  }

  /**
   * Send a query and get search-augmented response.
   *
   * @param query - User's question
   * @param temperature - Response randomness (lower = more focused)
   * @returns SearchResponse with content and citations
   */
  async ask(query: string, temperature: number = 0.2): Promise<SearchResponse> {
    this.messages.push({ role: 'user', content: query });

    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        max_tokens: this.maxTokens,
        temperature,
      });

      const content = response.choices[0].message.content || '';
      this.messages.push({ role: 'assistant', content });

      // Collect citations
      const citations: string[] = (response as any).citations || [];
      this.allCitations.push(...citations);

      return {
        content,
        citations,
        model: response.model,
        usage: {
          promptTokens: response.usage?.prompt_tokens || 0,
          completionTokens: response.usage?.completion_tokens || 0,
          totalTokens: response.usage?.total_tokens || 0,
        },
      };
    } catch (error) {
      // Remove failed message from history
      this.messages.pop();
      throw error;
    }
  }

  /**
   * Get all unique citations from the conversation.
   */
  getAllCitations(): string[] {
    return [...new Set(this.allCitations)];
  }

  /**
   * Clear conversation history, keep system prompt.
   */
  clearHistory(): void {
    this.messages = this.messages.slice(0, 1);
    this.allCitations = [];
  }

  /**
   * Get number of messages in conversation.
   */
  getMessageCount(): number {
    return this.messages.length;
  }
}

/**
 * Format response for display.
 *
 * @param response - SearchResponse object
 * @param includeCitations - Whether to include citation URLs
 * @returns Formatted string with content and optional citations
 */
function formatResponse(
  response: SearchResponse,
  includeCitations: boolean = true
): string {
  let output = response.content;

  if (includeCitations && response.citations.length > 0) {
    output += '\n\n---\n**Sources:**\n';
    response.citations.forEach((url, index) => {
      output += `${index + 1}. ${url}\n`;
    });
  }

  return output;
}

// Example usage
async function main() {
  console.log('=== Single Query ===');
  const result = await searchChat('What are the latest developments in AI?');
  console.log(formatResponse(result));

  console.log('\n=== Multi-turn Conversation ===');
  const chat = new PerplexityChat();

  const response1 = await chat.ask('What is quantum computing?');
  console.log(`Response 1: ${response1.content.slice(0, 200)}...`);

  const response2 = await chat.ask('What are its practical applications?');
  console.log(`Response 2: ${response2.content.slice(0, 200)}...`);

  console.log(`\nAll citations: ${chat.getAllCitations().join(', ')}`);
}

// Export for module usage
export { searchChat, PerplexityChat, formatResponse, createClient };
export type { SearchResponse, Message };

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}
