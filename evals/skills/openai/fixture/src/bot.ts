import OpenAI from 'openai';
import { loadConfig } from './config';

/** Answers one plain question with a single Chat Completions call. */
export async function answerQuestion(client: OpenAI, question: string): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.model) throw new Error('BOT_MODEL is not set');
  const completion = await client.chat.completions.create({
    model: cfg.model,
    messages: [
      { role: 'system', content: 'You answer questions for the customers of a web shop. Keep it short and polite.' },
      { role: 'user', content: question },
    ],
  });
  return completion.choices[0]?.message?.content ?? '';
}
