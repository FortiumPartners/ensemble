/**
 * OpenAI Chat Completions Template (TypeScript)
 *
 * This template provides a type-safe chat completion implementation
 * with proper error handling.
 *
 * Placeholders:
 * - {{model}} - Model ID (e.g., "gpt-5")
 * - {{system_prompt}} - System message content
 *
 * Usage:
 *   npx ts-node chat-completion.ts "What is TypeScript?"
 */

import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

// Configuration
const MODEL = '{{model}}';
const SYSTEM_PROMPT = '{{system_prompt}}';
const MAX_TOKENS = 1000;
const TEMPERATURE = 0.7;

/**
 * Chat response with usage information
 */
interface ChatResponse {
  content: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * OpenAI Chat Completions client with TypeScript typing
 */
class ChatClient {
  private client: OpenAI;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;
  private temperature: number;
  private messages: ChatCompletionMessageParam[];

  constructor(options: {
    model?: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}) {
    this.client = new OpenAI();
    this.model = options.model ?? MODEL;
    this.systemPrompt = options.systemPrompt ?? SYSTEM_PROMPT;
    this.maxTokens = options.maxTokens ?? MAX_TOKENS;
    this.temperature = options.temperature ?? TEMPERATURE;
    this.messages = [];

    // Initialize with system prompt
    if (this.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: this.systemPrompt
      });
    }
  }

  /**
   * Send a message and get a response
   */
  async chat(userMessage: string): Promise<ChatResponse> {
    // Add user message to history
    this.messages.push({
      role: 'user',
      content: userMessage
    });

    try {
      console.log(`Sending request to ${this.model}`);

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: this.messages,
        max_tokens: this.maxTokens,
        temperature: this.temperature
      });

      const assistantMessage = response.choices[0].message.content ?? '';

      // Add to history
      this.messages.push({
        role: 'assistant',
        content: assistantMessage
      });

      // Log usage
      console.log(
        `Tokens used - Prompt: ${response.usage?.prompt_tokens}, ` +
        `Completion: ${response.usage?.completion_tokens}`
      );

      return {
        content: assistantMessage,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0
        }
      };

    } catch (error) {
      if (error instanceof OpenAI.AuthenticationError) {
        console.error('Authentication failed - check your API key');
        throw error;
      }

      if (error instanceof OpenAI.RateLimitError) {
        console.error('Rate limit exceeded - implement backoff');
        throw error;
      }

      if (error instanceof OpenAI.APIError) {
        console.error(`API error: ${error.message}`);
        throw error;
      }

      throw error;
    }
  }

  /**
   * Clear conversation history, keeping system prompt
   */
  clearHistory(): void {
    this.messages = [];
    if (this.systemPrompt) {
      this.messages.push({
        role: 'system',
        content: this.systemPrompt
      });
    }
  }

  /**
   * Get the current conversation history
   */
  getHistory(): ChatCompletionMessageParam[] {
    return [...this.messages];
  }
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const userInput = process.argv.slice(2).join(' ');

  if (!userInput) {
    console.log('Usage: npx ts-node chat-completion.ts <message>');
    process.exit(1);
  }

  try {
    const client = new ChatClient();
    const response = await client.chat(userInput);
    console.log(response.content);

  } catch (error) {
    if (error instanceof OpenAI.AuthenticationError) {
      console.error('Error: Invalid API key. Set OPENAI_API_KEY environment variable.');
      process.exit(1);
    }

    if (error instanceof OpenAI.RateLimitError) {
      console.error('Error: Rate limit exceeded. Please try again later.');
      process.exit(1);
    }

    console.error(`Error: ${error}`);
    process.exit(1);
  }
}

main();

export { ChatClient, ChatResponse };
