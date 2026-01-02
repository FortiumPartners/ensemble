/**
 * Anthropic Messages API Template - TypeScript
 *
 * This template provides a production-ready message completion implementation
 * with proper error handling and TypeScript types.
 *
 * Placeholders:
 * - {{model}} - Model ID (e.g., "claude-sonnet-4-20250514")
 * - {{system_prompt}} - System message content
 *
 * Usage:
 *   npx ts-node messages.ts "What is Python?"
 */

import Anthropic from '@anthropic-ai/sdk';
import { Message, MessageParam } from '@anthropic-ai/sdk/resources/messages';

// Configuration
const MODEL = '{{model}}';
const SYSTEM_PROMPT = '{{system_prompt}}';
const MAX_TOKENS = 1024;
const TEMPERATURE = 0.7;

interface ChatHistory {
  role: 'user' | 'assistant';
  content: string;
}

class MessageClient {
  private client: Anthropic;
  private model: string;
  private systemPrompt: string;
  private maxTokens: number;
  private temperature: number;
  private messages: ChatHistory[];

  constructor(
    model: string = MODEL,
    systemPrompt: string = SYSTEM_PROMPT,
    maxTokens: number = MAX_TOKENS,
    temperature: number = TEMPERATURE
  ) {
    this.client = new Anthropic();
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.messages = [];
  }

  async chat(userMessage: string): Promise<string> {
    // Add user message to history
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    try {
      console.log(`Sending request to ${this.model}`);

      const response: Message = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.systemPrompt || undefined,
        messages: this.messages as MessageParam[],
        temperature: this.temperature,
      });

      // Extract response content
      const contentBlock = response.content[0];
      if (contentBlock.type !== 'text') {
        throw new Error('Unexpected content block type');
      }
      const assistantMessage = contentBlock.text;

      // Add to history
      this.messages.push({
        role: 'assistant',
        content: assistantMessage,
      });

      // Log usage
      console.log(
        `Tokens used - Input: ${response.usage.input_tokens}, ` +
          `Output: ${response.usage.output_tokens}`
      );

      return assistantMessage;
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError) {
        console.error('Authentication failed - check your API key');
        throw error;
      }

      if (error instanceof Anthropic.RateLimitError) {
        console.error('Rate limit exceeded - implement backoff');
        throw error;
      }

      if (error instanceof Anthropic.APIError) {
        console.error(`API error: ${error.message}`);
        throw error;
      }

      throw error;
    }
  }

  clearHistory(): void {
    this.messages = [];
  }

  getHistory(): ChatHistory[] {
    return [...this.messages];
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log('Usage: npx ts-node messages.ts <message>');
    process.exit(1);
  }

  const userInput = args.join(' ');

  try {
    const client = new MessageClient();
    const response = await client.chat(userInput);
    console.log(response);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      console.error(
        'Error: Invalid API key. Set ANTHROPIC_API_KEY environment variable.'
      );
      process.exit(1);
    }

    if (error instanceof Anthropic.RateLimitError) {
      console.error('Error: Rate limit exceeded. Please try again later.');
      process.exit(1);
    }

    if (error instanceof Anthropic.APIError) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }

    throw error;
  }
}

main();
