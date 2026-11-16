import OpenAI from 'openai';
import { loadConfig } from './config';

/** The client the desk's summary tool uses. */
export function createSummaryClient(): OpenAI {
  return new OpenAI();
}

/** Shortens a text to two sentences with a single Chat Completions call. */
export async function summarize(client: OpenAI, text: string): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.summaryModel) throw new Error('SUMMARY_MODEL is not set');
  const completion = await client.chat.completions.create({
    model: cfg.summaryModel,
    messages: [
      { role: 'system', content: 'Summarize the text in two plain sentences.' },
      { role: 'user', content: text },
    ],
  });
  return completion.choices[0]?.message?.content ?? '';
}
